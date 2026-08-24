use crate::{codex_limits, credit_analytics, date, types::ServerCreditAnalyticsResponse};
use reqwest::blocking::{Client, RequestBuilder};
use serde::Deserialize;
use serde_json::Value;
use std::time::Duration;

const DAILY_WORKSPACE_USAGE_COUNTS_URL: &str =
    "https://chatgpt.com/backend-api/wham/usage/daily-workspace-usage-counts";
const DAILY_TOKEN_USAGE_BREAKDOWN_URL: &str =
    "https://chatgpt.com/backend-api/wham/usage/daily-token-usage-breakdown";
const REQUEST_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceUsageCountsDay {
    pub date: String,
    #[serde(
        rename = "uncachedTextInputTokens",
        alias = "uncached_text_input_tokens"
    )]
    pub uncached_text_input_tokens: i64,
    #[serde(rename = "cachedTextInputTokens", alias = "cached_text_input_tokens")]
    pub cached_text_input_tokens: i64,
    #[serde(rename = "textOutputTokens", alias = "text_output_tokens")]
    pub text_output_tokens: i64,
    #[serde(rename = "textTotalTokens", alias = "text_total_tokens")]
    pub text_total_tokens: i64,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TokenUsageBreakdownDay {
    pub date: String,
    pub units: String,
    pub models: Vec<TokenUsageBreakdownModel>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TokenUsageBreakdownModel {
    pub model: String,
    pub speed: String,
    pub credits: f64,
}

pub fn fetch_server_credit_analytics() -> Result<ServerCreditAnalyticsResponse, String> {
    let timezone = date::resolve_app_timezone();
    let today = date::date_key_in_timezone(chrono::Utc::now(), &timezone);
    let start_date = date::shift_date_key(&today, -29)?;

    let counts = fetch_workspace_usage_counts(&start_date, &today)?;
    let breakdowns = fetch_token_usage_breakdown(&start_date, &today)?;

    Ok(credit_analytics::build_server_credit_analytics(
        counts,
        breakdowns,
        &today,
        &start_date,
        &today,
    ))
}

pub(crate) fn fetch_workspace_usage_counts(
    start_date: &str,
    end_date: &str,
) -> Result<Vec<WorkspaceUsageCountsDay>, String> {
    let client = build_client()?;
    let body = send_authenticated_get(
        &client,
        DAILY_WORKSPACE_USAGE_COUNTS_URL,
        start_date,
        end_date,
    )?;
    parse_workspace_counts(&body)
}

pub(crate) fn fetch_token_usage_breakdown(
    start_date: &str,
    end_date: &str,
) -> Result<Vec<TokenUsageBreakdownDay>, String> {
    let client = build_client()?;
    let body = send_authenticated_get(
        &client,
        DAILY_TOKEN_USAGE_BREAKDOWN_URL,
        start_date,
        end_date,
    )?;
    parse_token_usage_breakdown(&body)
}

fn status_error_message(status: reqwest::StatusCode) -> String {
    format!("Server analytics endpoint returned status {status}")
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("Failed to create server analytics HTTP client: {error}"))
}

fn send_authenticated_get(
    client: &Client,
    url: &str,
    start_date: &str,
    end_date: &str,
) -> Result<String, String> {
    let auth = codex_limits::load_codex_auth()?;
    let request = build_request(client, url, start_date, end_date, &auth)?;
    let response = request
        .send()
        .map_err(|error| format!("Server analytics request failed: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(status_error_message(status));
    }

    response
        .text()
        .map_err(|error| format!("Failed to read server analytics response: {error}"))
}

fn build_request(
    client: &Client,
    url: &str,
    start_date: &str,
    end_date: &str,
    auth: &codex_limits::CodexAuth,
) -> Result<RequestBuilder, String> {
    let mut request = client
        .get(url)
        .query(&[
            ("start_date", start_date),
            ("end_date", end_date),
            ("group_by", "day"),
        ])
        .bearer_auth(&auth.access_token)
        .header("Accept", "application/json")
        .header("Origin", "https://chatgpt.com")
        .header("Referer", "https://chatgpt.com/")
        .header(
            "User-Agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        );

    if let Some(account_id) = &auth.account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }

    Ok(request)
}

fn parse_workspace_counts(body: &str) -> Result<Vec<WorkspaceUsageCountsDay>, String> {
    let value: Value = serde_json::from_str(body)
        .map_err(|error| format!("Failed to parse workspace counts JSON: {error}"))?;
    let items = value
        .as_array()
        .cloned()
        .or_else(|| value.get("data").and_then(Value::as_array).cloned())
        .or_else(|| value.get("days").and_then(Value::as_array).cloned())
        .ok_or_else(|| {
            "Workspace counts response did not contain an array, data array, or days array."
                .to_string()
        })?;
    serde_json::from_value(Value::Array(items))
        .map_err(|error| format!("Failed to parse workspace counts array: {error}"))
}

fn parse_token_usage_breakdown(body: &str) -> Result<Vec<TokenUsageBreakdownDay>, String> {
    let value: Value = serde_json::from_str(body)
        .map_err(|error| format!("Failed to parse token usage breakdown JSON: {error}"))?;
    let items = value
        .as_array()
        .cloned()
        .or_else(|| value.get("data").and_then(Value::as_array).cloned())
        .or_else(|| value.get("days").and_then(Value::as_array).cloned())
        .ok_or_else(|| {
            "Token usage breakdown response did not contain an array, data array, or days array."
                .to_string()
        })?;
    serde_json::from_value(Value::Array(items))
        .map_err(|error| format!("Failed to parse token usage breakdown array: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_7d_workspace_counts_fixture() {
        let body = include_str!("../tests/fixtures/fixture_7d_counts.json");
        let parsed = parse_workspace_counts(body).expect("fixture should parse");
        assert!(!parsed.is_empty());
        assert!(parsed.iter().all(|day| !day.date.is_empty()));
    }

    #[test]
    fn parses_7d_breakdown_fixture() {
        let body = include_str!("../tests/fixtures/fixture_7d_breakdown.json");
        let parsed = parse_token_usage_breakdown(body).expect("fixture should parse");
        assert!(!parsed.is_empty());
        assert!(parsed
            .iter()
            .all(|day| !day.date.is_empty() && !day.units.is_empty()));
    }

    #[test]
    fn parses_30d_workspace_counts_fixture() {
        let body = include_str!("../tests/fixtures/fixture_30d_counts.json");
        let parsed = parse_workspace_counts(body).expect("fixture should parse");
        assert!(!parsed.is_empty());
        assert!(parsed.iter().all(|day| !day.date.is_empty()));
    }

    #[test]
    fn parses_30d_breakdown_fixture() {
        let body = include_str!("../tests/fixtures/fixture_30d_breakdown.json");
        let parsed = parse_token_usage_breakdown(body).expect("fixture should parse");
        assert!(!parsed.is_empty());
        assert!(parsed
            .iter()
            .all(|day| !day.date.is_empty() && !day.units.is_empty()));
    }

    #[test]
    fn parses_wrapped_response_arrays() {
        let body = r#"{"data":[{"date":"2026-08-01","uncached_text_input_tokens":1000,"cached_text_input_tokens":2000,"text_output_tokens":3000,"text_total_tokens":6000}]}"#;
        let parsed = parse_workspace_counts(body).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].date, "2026-08-01");
    }

    #[test]
    fn rejects_non_array_workspace_counts() {
        let error = parse_workspace_counts(r#"{"message":"nope"}"#).unwrap_err();
        assert!(error.contains("did not contain"));
    }

    #[test]
    fn calibrates_same_credits_across_7d_and_30d_fixtures() {
        let counts_7d =
            parse_workspace_counts(include_str!("../tests/fixtures/fixture_7d_counts.json"))
                .unwrap();
        let breakdowns_7d = parse_token_usage_breakdown(include_str!(
            "../tests/fixtures/fixture_7d_breakdown.json"
        ))
        .unwrap();
        let counts_30d =
            parse_workspace_counts(include_str!("../tests/fixtures/fixture_30d_counts.json"))
                .unwrap();
        let breakdowns_30d = parse_token_usage_breakdown(include_str!(
            "../tests/fixtures/fixture_30d_breakdown.json"
        ))
        .unwrap();

        let response_7d = credit_analytics::build_server_credit_analytics(
            counts_7d,
            breakdowns_7d,
            "2026-08-21",
            "2026-08-15",
            "2026-08-21",
        );
        let response_30d = credit_analytics::build_server_credit_analytics(
            counts_30d,
            breakdowns_30d,
            "2026-08-21",
            "2026-07-23",
            "2026-08-21",
        );

        for date in [
            "2026-08-15",
            "2026-08-16",
            "2026-08-17",
            "2026-08-18",
            "2026-08-19",
            "2026-08-20",
        ] {
            let day_7d = response_7d
                .daily
                .iter()
                .find(|day| day.date == date)
                .unwrap()
                .credits
                .unwrap();
            let day_30d = response_30d
                .daily
                .iter()
                .find(|day| day.date == date)
                .unwrap()
                .credits
                .unwrap();
            assert!(
                (day_7d - day_30d).abs() < 1e-6,
                "{date}: 7d {day_7d} != 30d {day_30d}"
            );
        }
    }

    #[test]
    fn does_not_expose_auth_in_error() {
        let message = status_error_message(reqwest::StatusCode::UNAUTHORIZED);
        assert!(!message.contains("token"));
        assert!(!message.contains("Authorization"));
        assert!(!message.contains("Bearer"));
    }
}

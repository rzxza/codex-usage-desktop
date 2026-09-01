use crate::{codex_limits, credit_analytics, date, types::ServerCreditAnalyticsResponse};
use reqwest::blocking::{Client, RequestBuilder};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const DAILY_WORKSPACE_USAGE_COUNTS_URL: &str =
    "https://chatgpt.com/backend-api/wham/analytics/daily-workspace-usage-counts";
const DAILY_TOKEN_USAGE_BREAKDOWN_URL: &str =
    "https://chatgpt.com/backend-api/wham/usage/daily-token-usage-breakdown";
const REQUEST_TIMEOUT_SECS: u64 = 30;
/// Fetch at least 45 calendar days so a 30-complete-day window plus the
/// previous 7-complete-day window remain available even when the latest
/// complete date is a few days behind today.
const FETCH_HORIZON_DAYS: i64 = 45;

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub(crate) struct WorkspaceUsageCountsDay {
    pub date: String,
    pub totals: WorkspaceUsageCountsTotals,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub(crate) struct WorkspaceUsageCountsTotals {
    #[serde(alias = "uncachedTextInputTokens")]
    pub uncached_text_input_tokens: i64,
    #[serde(alias = "cachedTextInputTokens")]
    pub cached_text_input_tokens: i64,
    #[serde(alias = "textOutputTokens")]
    pub text_output_tokens: i64,
    #[serde(alias = "textTotalTokens")]
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

/// In-process account-keyed TTL cache so the main window and the compact
/// window share one WHAM analytics result without one account receiving
/// another account's cached data. Single-flight is per account key.
const ANALYTICS_TTL: Duration = Duration::from_secs(240);

#[derive(Clone)]
struct AnalyticsCacheEntry {
    stored_at: Instant,
    value: ServerCreditAnalyticsResponse,
}

struct AnalyticsCacheStore {
    cache: Mutex<HashMap<String, AnalyticsCacheEntry>>,
    flights: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl AnalyticsCacheStore {
    fn new() -> Self {
        Self {
            cache: Mutex::new(HashMap::new()),
            flights: Mutex::new(HashMap::new()),
        }
    }

    fn flight(&self, key: &str) -> Arc<Mutex<()>> {
        let mut flights = self.flights.lock().unwrap_or_else(|e| e.into_inner());
        flights
            .entry(key.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    fn get_fresh(&self, key: &str) -> Option<ServerCreditAnalyticsResponse> {
        let cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        cache
            .get(key)
            .filter(|entry| entry.stored_at.elapsed() < ANALYTICS_TTL)
            .map(|entry| entry.value.clone())
    }

    fn get_after_wait(
        &self,
        key: &str,
        force_refresh: bool,
        wait_started: Instant,
    ) -> Option<ServerCreditAnalyticsResponse> {
        let cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        cache.get(key).and_then(|entry| {
            let fresh_enough = !force_refresh && entry.stored_at.elapsed() < ANALYTICS_TTL;
            let concurrent_force = force_refresh && entry.stored_at >= wait_started;
            if fresh_enough || concurrent_force {
                Some(entry.value.clone())
            } else {
                None
            }
        })
    }

    fn store(&self, key: &str, value: ServerCreditAnalyticsResponse) {
        let mut cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        cache.insert(
            key.to_string(),
            AnalyticsCacheEntry {
                stored_at: Instant::now(),
                value,
            },
        );
    }

    fn fetch<F>(
        &self,
        key: &str,
        force_refresh: bool,
        load: F,
    ) -> Result<ServerCreditAnalyticsResponse, String>
    where
        F: FnOnce() -> Result<ServerCreditAnalyticsResponse, String>,
    {
        if !force_refresh {
            if let Some(value) = self.get_fresh(key) {
                return Ok(value);
            }
        }

        let wait_started = Instant::now();
        let flight = self.flight(key);
        let _guard = flight.lock().unwrap_or_else(|e| e.into_inner());

        if let Some(value) = self.get_after_wait(key, force_refresh, wait_started) {
            return Ok(value);
        }

        let value = load()?;
        self.store(key, value.clone());
        Ok(value)
    }
}

static ANALYTICS_STORE: OnceLock<AnalyticsCacheStore> = OnceLock::new();

fn analytics_cache_store() -> &'static AnalyticsCacheStore {
    ANALYTICS_STORE.get_or_init(AnalyticsCacheStore::new)
}

fn token_fingerprint(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let digest = hasher.finalize();
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn analytics_cache_key(auth: &codex_limits::CodexAuth) -> String {
    if let Some(account_id) = &auth.account_id {
        return format!("account:{account_id}");
    }
    format!("token:{}", token_fingerprint(&auth.access_token))
}

pub fn fetch_server_credit_analytics(
    force_refresh: bool,
) -> Result<ServerCreditAnalyticsResponse, String> {
    let auth = codex_limits::load_codex_auth()?;
    let key = analytics_cache_key(&auth);
    analytics_cache_store().fetch(&key, force_refresh, || {
        fetch_server_credit_analytics_uncached(&auth)
    })
}

fn fetch_server_credit_analytics_uncached(
    auth: &codex_limits::CodexAuth,
) -> Result<ServerCreditAnalyticsResponse, String> {
    let timezone = date::resolve_app_timezone();
    let today = date::date_key_in_timezone(chrono::Utc::now(), &timezone);
    // Fetch at least 45 calendar days (today - 44 through tomorrow exclusive).
    let start_date = date::shift_date_key(&today, -(FETCH_HORIZON_DAYS - 1))?;
    // WHAM date windows are requested with an exclusive end boundary (tomorrow)
    // so today's partial row is always covered regardless of server convention;
    // rows beyond today are clamped client-side before analysis.
    let request_end_date = date::shift_date_key(&today, 1)?;

    let mut counts = fetch_workspace_usage_counts(auth, &start_date, &request_end_date)?;
    let mut breakdowns = fetch_token_usage_breakdown(auth, &start_date, &request_end_date)?;
    retain_dates_up_to_today(&mut counts, &today, |day| &day.date);
    retain_dates_up_to_today(&mut breakdowns, &today, |day| &day.date);

    Ok(credit_analytics::build_server_credit_analytics(
        counts,
        breakdowns,
        &today,
        &start_date,
        &today,
    ))
}

fn retain_dates_up_to_today<T>(rows: &mut Vec<T>, today: &str, date_of: impl Fn(&T) -> &str) {
    rows.retain(|row| date_of(row) <= today);
}

pub(crate) fn fetch_workspace_usage_counts(
    auth: &codex_limits::CodexAuth,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<WorkspaceUsageCountsDay>, String> {
    let client = build_client()?;
    let body = send_authenticated_get(
        &client,
        DAILY_WORKSPACE_USAGE_COUNTS_URL,
        start_date,
        end_date,
        auth,
        &[("workspace_user", "true")],
    )?;
    parse_workspace_counts(&body)
}

pub(crate) fn fetch_token_usage_breakdown(
    auth: &codex_limits::CodexAuth,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<TokenUsageBreakdownDay>, String> {
    let client = build_client()?;
    let body = send_authenticated_get(
        &client,
        DAILY_TOKEN_USAGE_BREAKDOWN_URL,
        start_date,
        end_date,
        auth,
        &[],
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
    auth: &codex_limits::CodexAuth,
    extra_query: &[(&str, &str)],
) -> Result<String, String> {
    let request = build_request(client, url, start_date, end_date, auth, extra_query)?;
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
    extra_query: &[(&str, &str)],
) -> Result<RequestBuilder, String> {
    let mut query = vec![
        ("start_date", start_date),
        ("end_date", end_date),
        ("group_by", "day"),
    ];
    query.extend(extra_query.iter().copied());

    let mut request = client
        .get(url)
        .query(&query)
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
    // The WHAM API reports `units` at the wrapper level; inject it into each day
    // so downstream percent checks keep failing closed when units are missing.
    let wrapper_units = value
        .get("units")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let items: Vec<Value> = items
        .into_iter()
        .map(|mut day| {
            if day.get("units").is_none() {
                day["units"] = Value::String(wrapper_units.clone());
            }
            day
        })
        .collect();
    serde_json::from_value(Value::Array(items))
        .map_err(|error| format!("Failed to parse token usage breakdown array: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    struct TtlCache<T> {
        cell: std::sync::Mutex<Option<(std::time::Instant, T)>>,
    }

    impl<T: Clone> TtlCache<T> {
        fn new() -> Self {
            Self {
                cell: std::sync::Mutex::new(None),
            }
        }

        fn get(&self, ttl: Duration) -> Option<T> {
            let guard = self.cell.lock().unwrap_or_else(|e| e.into_inner());
            guard
                .as_ref()
                .filter(|(at, _)| at.elapsed() < ttl)
                .map(|(_, value)| value.clone())
        }

        fn store(&self, value: T) {
            let mut guard = self.cell.lock().unwrap_or_else(|e| e.into_inner());
            *guard = Some((std::time::Instant::now(), value));
        }
    }

    fn cached_lookup<T, F>(
        cache: &TtlCache<T>,
        flight: &std::sync::Mutex<()>,
        ttl: Duration,
        load: F,
    ) -> Result<T, String>
    where
        T: Clone,
        F: FnOnce() -> Result<T, String>,
    {
        if let Some(value) = cache.get(ttl) {
            return Ok(value);
        }
        let _in_flight = flight.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(value) = cache.get(ttl) {
            return Ok(value);
        }
        let value = load()?;
        cache.store(value.clone());
        Ok(value)
    }

    #[test]
    fn serves_fresh_value_without_invoking_loader() {
        let cache = TtlCache::new();
        cache.store("fresh".to_string());
        let calls = AtomicUsize::new(0);
        let value = cached_lookup(&cache, &Default::default(), Duration::from_secs(60), || {
            calls.fetch_add(1, Ordering::SeqCst);
            Err("must not be called".to_string())
        })
        .unwrap();
        assert_eq!(value, "fresh");
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn expired_value_triggers_single_reload_under_concurrency() {
        let cache: Arc<TtlCache<String>> = Arc::new(TtlCache::new());
        let flight: Arc<std::sync::Mutex<()>> = Arc::new(std::sync::Mutex::new(()));
        let calls = Arc::new(AtomicUsize::new(0));
        let mut handles = Vec::new();
        for _ in 0..4 {
            let cache = Arc::clone(&cache);
            let flight = Arc::clone(&flight);
            let calls = Arc::clone(&calls);
            handles.push(std::thread::spawn(move || {
                cached_lookup(&cache, &flight, Duration::from_millis(50), || {
                    calls.fetch_add(1, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(80)); // widen the race
                    Ok("loaded".to_string())
                })
            }));
        }
        for handle in handles {
            assert_eq!(handle.join().unwrap().unwrap(), "loaded");
        }
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "single-flight must collapse concurrent misses into one load"
        );
    }

    #[test]
    fn reloads_once_ttl_has_elapsed() {
        let cache = TtlCache::new();
        let flight = std::sync::Mutex::new(());
        let calls = AtomicUsize::new(0);
        cache.store("v1".to_string());
        std::thread::sleep(Duration::from_millis(80)); // outlive the 50ms ttl
        let value = cached_lookup(&cache, &flight, Duration::from_millis(50), || {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok("v2".to_string())
        })
        .unwrap();
        assert_eq!(value, "v2");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        // Now fresh again - the loader must stay idle.
        cached_lookup(&cache, &flight, Duration::from_millis(50), || {
            calls.fetch_add(1, Ordering::SeqCst);
            Err("must not be called".to_string())
        })
        .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn production_cache_serves_same_account_ttl_without_loader() {
        let store = AnalyticsCacheStore::new();
        let key = "account:alice".to_string();
        let mut expected = sample_response();
        expected.fetched_at = "2026-08-24T01:00:00.000Z".to_string();
        store.store(&key, expected);
        let calls = AtomicUsize::new(0);
        let value = store
            .fetch(&key, false, || {
                calls.fetch_add(1, Ordering::SeqCst);
                Err("loader must not run".to_string())
            })
            .unwrap();
        assert_eq!(value.fetched_at, "2026-08-24T01:00:00.000Z");
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn production_cache_isolates_accounts() {
        let store = AnalyticsCacheStore::new();
        let key_a = "account:alice".to_string();
        let key_b = "account:bob".to_string();
        let mut value_a = sample_response();
        value_a.fetched_at = "2026-08-24T01:00:00.000Z".to_string();
        let mut value_b = sample_response();
        value_b.fetched_at = "2026-08-24T02:00:00.000Z".to_string();
        store.store(&key_a, value_a.clone());
        store.store(&key_b, value_b.clone());

        let calls = AtomicUsize::new(0);
        let got_a = store
            .fetch(&key_a, false, || {
                calls.fetch_add(1, Ordering::SeqCst);
                Err("loader must not run".to_string())
            })
            .unwrap();
        let got_b = store
            .fetch(&key_b, false, || {
                calls.fetch_add(1, Ordering::SeqCst);
                Err("loader must not run".to_string())
            })
            .unwrap();
        assert_eq!(got_a.fetched_at, value_a.fetched_at);
        assert_eq!(got_b.fetched_at, value_b.fetched_at);
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn production_cache_force_bypasses_ttl() {
        let store = AnalyticsCacheStore::new();
        let key = "account:alice".to_string();
        let mut cached = sample_response();
        cached.fetched_at = "2026-08-24T01:00:00.000Z".to_string();
        store.store(&key, cached);

        let mut loaded = sample_response();
        loaded.fetched_at = "2026-08-24T03:00:00.000Z".to_string();
        let calls = AtomicUsize::new(0);
        let value = store
            .fetch(&key, true, || {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok(loaded.clone())
            })
            .unwrap();
        assert_eq!(value.fetched_at, loaded.fetched_at);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn production_cache_reloads_after_same_account_ttl_expiry() {
        let store = AnalyticsCacheStore::new();
        let key = "account:alice".to_string();
        let mut cached = sample_response();
        cached.fetched_at = "2026-08-24T01:00:00.000Z".to_string();
        store.store(&key, cached);
        {
            let mut cache = store.cache.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(entry) = cache.get_mut(&key) {
                entry.stored_at = Instant::now() - ANALYTICS_TTL - Duration::from_secs(1);
            }
        }

        let mut loaded = sample_response();
        loaded.fetched_at = "2026-08-24T03:00:00.000Z".to_string();
        let calls = AtomicUsize::new(0);
        let value = store
            .fetch(&key, false, || {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok(loaded.clone())
            })
            .unwrap();
        assert_eq!(value.fetched_at, loaded.fetched_at);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn production_cache_concurrent_force_uses_single_flight() {
        let store = Arc::new(AnalyticsCacheStore::new());
        let key = "account:concurrent".to_string();
        let mut seeded = sample_response();
        seeded.fetched_at = "2026-08-24T01:00:00.000Z".to_string();
        store.store(&key, seeded);

        let barrier = Arc::new(std::sync::Barrier::new(4));
        let calls = Arc::new(AtomicUsize::new(0));
        let mut handles = Vec::new();
        for _ in 0..4 {
            let store = Arc::clone(&store);
            let barrier = Arc::clone(&barrier);
            let calls = Arc::clone(&calls);
            let key = key.clone();
            handles.push(std::thread::spawn(move || {
                barrier.wait();
                let mut loaded = sample_response();
                loaded.fetched_at = "2026-08-24T03:00:00.000Z".to_string();
                store.fetch(&key, true, || {
                    calls.fetch_add(1, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(80)); // widen the race
                    Ok(loaded)
                })
            }));
        }

        for handle in handles {
            let value = handle.join().unwrap().unwrap();
            assert_eq!(value.fetched_at, "2026-08-24T03:00:00.000Z");
        }
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "concurrent force refreshes must collapse into one upstream load"
        );
    }

    #[test]
    fn token_fallback_key_is_irreversible_sha256_fingerprint() {
        let auth = codex_limits::CodexAuth {
            access_token: "super-secret-token".to_string(),
            account_id: None,
        };
        let key = analytics_cache_key(&auth);
        assert!(key.starts_with("token:"));
        assert!(!key.contains("super-secret-token"));
        assert_eq!(key.len(), "token:".len() + 64);

        let other = codex_limits::CodexAuth {
            access_token: "another-secret-token".to_string(),
            account_id: None,
        };
        assert_ne!(key, analytics_cache_key(&other));

        let account_auth = codex_limits::CodexAuth {
            access_token: "super-secret-token".to_string(),
            account_id: Some("acct_123".to_string()),
        };
        assert_eq!(analytics_cache_key(&account_auth), "account:acct_123");
    }

    fn counts_day(date: &str) -> WorkspaceUsageCountsDay {
        WorkspaceUsageCountsDay {
            date: date.to_string(),
            totals: WorkspaceUsageCountsTotals {
                uncached_text_input_tokens: 100,
                cached_text_input_tokens: 200,
                text_output_tokens: 300,
                text_total_tokens: 600,
            },
        }
    }

    fn breakdown_day(date: &str) -> TokenUsageBreakdownDay {
        TokenUsageBreakdownDay {
            date: date.to_string(),
            units: "percent".to_string(),
            models: Vec::new(),
        }
    }

    fn sample_response() -> ServerCreditAnalyticsResponse {
        credit_analytics::build_server_credit_analytics(
            vec![counts_day("2026-08-24")],
            vec![breakdown_day("2026-08-24")],
            "2026-08-25",
            "2026-08-01",
            "2026-08-25",
        )
    }

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
        let body = r#"{"data":[{"date":"2026-08-01","totals":{"uncached_text_input_tokens":1000,"cached_text_input_tokens":2000,"text_output_tokens":3000,"text_total_tokens":6000}}]}"#;
        let parsed = parse_workspace_counts(body).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].date, "2026-08-01");
        assert_eq!(parsed[0].totals.uncached_text_input_tokens, 1000);
    }

    #[test]
    fn rejects_counts_without_totals_block() {
        let error = parse_workspace_counts(r#"{"data":[{"date":"2026-08-01"}]}"#).unwrap_err();
        assert!(error.contains("Failed to parse workspace counts array"));
    }

    #[test]
    fn injects_wrapper_units_into_days() {
        let body =
            r#"{"data":[{"date":"2026-08-01","models":[]}],"units":"percent","group_by":"day"}"#;
        let parsed = parse_token_usage_breakdown(body).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].units, "percent");
    }

    #[test]
    fn missing_wrapper_units_fails_closed_per_day() {
        let body = r#"{"data":[{"date":"2026-08-01","models":[]}]}"#;
        let parsed = parse_token_usage_breakdown(body).unwrap();
        assert_eq!(parsed[0].units, "");
    }

    #[test]
    fn retains_only_rows_up_to_today() {
        let mut counts = vec![
            counts_day("2026-08-22"),
            counts_day("2026-08-24"),
            counts_day("2026-08-25"),
        ];
        retain_dates_up_to_today(&mut counts, "2026-08-24", |day| &day.date);
        let dates: Vec<&str> = counts.iter().map(|day| day.date.as_str()).collect();
        assert_eq!(dates, vec!["2026-08-22", "2026-08-24"]);

        let mut breakdowns = vec![breakdown_day("2026-08-23"), breakdown_day("2026-08-25")];
        retain_dates_up_to_today(&mut breakdowns, "2026-08-24", |day| &day.date);
        let dates: Vec<&str> = breakdowns.iter().map(|day| day.date.as_str()).collect();
        assert_eq!(dates, vec!["2026-08-23"]);
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

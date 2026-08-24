use crate::{
    credit_rates,
    server_analytics::{TokenUsageBreakdownDay, TokenUsageBreakdownModel, WorkspaceUsageCountsDay},
    types::{
        CalibrationStatus, CalibrationSummary, CreditAggregate, DailyCreditUsage, ModelCreditUsage,
        ServerCreditAnalyticsResponse, ServerCreditAnalyticsStatus,
    },
};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

const LUNA_INPUT_PER_MILLION: f64 = 5.0;
const LUNA_CACHED_INPUT_PER_MILLION: f64 = 0.5;
const LUNA_OUTPUT_PER_MILLION: f64 = 30.0;
const MILLION: f64 = 1_000_000.0;

pub fn build_server_credit_analytics(
    counts: Vec<WorkspaceUsageCountsDay>,
    breakdowns: Vec<TokenUsageBreakdownDay>,
    today: &str,
    start_date: &str,
    end_date: &str,
) -> ServerCreditAnalyticsResponse {
    let counts_by_date: BTreeMap<String, WorkspaceUsageCountsDay> = counts
        .into_iter()
        .map(|day| (day.date.clone(), day))
        .collect();
    let breakdowns_by_date: BTreeMap<String, TokenUsageBreakdownDay> = breakdowns
        .into_iter()
        .map(|day| (day.date.clone(), day))
        .collect();

    let mut all_dates = BTreeSet::new();
    all_dates.extend(counts_by_date.keys().cloned());
    all_dates.extend(breakdowns_by_date.keys().cloned());

    let mut k_values = Vec::new();
    for date in &all_dates {
        let counts_day = counts_by_date.get(date);
        let breakdown_day = breakdowns_by_date.get(date);
        if let (Some(counts_day), Some(breakdown_day)) = (counts_day, breakdown_day) {
            if is_eligible_for_calibration(
                date,
                today,
                token_total(counts_day),
                Some(breakdown_day),
            ) {
                if let Some(k_day) = compute_k_day(counts_day, breakdown_day) {
                    k_values.push(k_day);
                }
            }
        }
    }

    let median_k = median(&k_values);
    let deviation = median_k
        .map(|median_k| median_abs_percent_deviation(&k_values, median_k))
        .unwrap_or(f64::INFINITY);
    let max_deviation = median_k
        .map(|median_k| max_abs_percent_deviation(&k_values, median_k))
        .unwrap_or(f64::INFINITY);
    let status = calibration_status(k_values.len(), deviation);
    let k = if status == CalibrationStatus::Invalid {
        None
    } else {
        median_k
    };

    let calibration = CalibrationSummary {
        k,
        sample_count: k_values.len(),
        deviation: if k.is_some() { Some(deviation) } else { None },
        max_deviation: if k.is_some() {
            Some(max_deviation)
        } else {
            None
        },
        status,
    };

    let daily = build_daily_usage(&counts_by_date, &breakdowns_by_date, today, k);

    let today_entry = daily.iter().find(|day| day.date == today);
    let top_status = if k.is_none() {
        ServerCreditAnalyticsStatus::Invalid
    } else if today_entry.is_some_and(|day| day.is_pending) {
        ServerCreditAnalyticsStatus::Pending
    } else if today_entry.is_some_and(|day| day.is_partial) {
        ServerCreditAnalyticsStatus::Partial
    } else {
        ServerCreditAnalyticsStatus::Ready
    };

    let last_7_start = crate::date::shift_date_key(today, -6).unwrap_or_else(|_| today.to_string());
    let all_dates_vec: Vec<String> = all_dates.into_iter().collect();
    let last_7_dates: Vec<String> = all_dates_vec
        .iter()
        .filter(|date| date.as_str() >= last_7_start.as_str() && date.as_str() <= today)
        .cloned()
        .collect();
    let last_30_dates: Vec<String> = all_dates_vec
        .iter()
        .filter(|date| date.as_str() >= start_date && date.as_str() <= end_date)
        .cloned()
        .collect();

    let models = aggregate_credits(&daily, &all_dates_vec).models;

    ServerCreditAnalyticsResponse {
        fetched_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        start_date: start_date.to_string(),
        end_date: end_date.to_string(),
        status: top_status,
        calibration,
        today: today_entry.cloned(),
        last_7_days: aggregate_credits(&daily, &last_7_dates),
        last_30_days: aggregate_credits(&daily, &last_30_dates),
        daily,
        models,
    }
}

fn token_total(day: &WorkspaceUsageCountsDay) -> i64 {
    day.totals.uncached_text_input_tokens
        + day.totals.cached_text_input_tokens
        + day.totals.text_output_tokens
}

fn base_credits(day: &WorkspaceUsageCountsDay) -> f64 {
    (LUNA_INPUT_PER_MILLION * day.totals.uncached_text_input_tokens as f64
        + LUNA_CACHED_INPUT_PER_MILLION * day.totals.cached_text_input_tokens as f64
        + LUNA_OUTPUT_PER_MILLION * day.totals.text_output_tokens as f64)
        / MILLION
}

/// Percentage-point share below which unsupported model/speed entries in a
/// breakdown are considered legacy residue (e.g. `gpt-5.5: 0.0`) and ignored.
/// Anything above this threshold makes the whole day ineligible so unknown
/// rates are never guessed (fail closed).
const NEGLIGIBLE_MODEL_PERCENT: f64 = 0.05;

/// Splits a breakdown into rate-table models on standard speed and the combined
/// percentage share of everything else. Returns `None` when no usable models
/// remain or the ignored share is material, meaning the day must be rejected.
fn usable_models(
    models: &[TokenUsageBreakdownModel],
) -> Option<(Vec<&TokenUsageBreakdownModel>, f64)> {
    let mut known = Vec::new();
    let mut ignored_percent = 0.0;
    for model in models {
        if credit_rates::is_supported_rate_model(&model.model)
            && credit_rates::is_standard_speed(&model.speed)
        {
            known.push(model);
        } else {
            ignored_percent += model.credits;
        }
    }
    if known.is_empty() || ignored_percent > NEGLIGIBLE_MODEL_PERCENT {
        return None;
    }
    Some((known, ignored_percent))
}

fn is_eligible_for_calibration(
    date: &str,
    today: &str,
    token_total: i64,
    breakdown: Option<&TokenUsageBreakdownDay>,
) -> bool {
    if date == today || token_total <= 0 {
        return false;
    }
    let Some(breakdown) = breakdown else {
        return false;
    };
    if breakdown.units != "percent" || breakdown.models.is_empty() {
        return false;
    }
    let Some((known, _)) = usable_models(&breakdown.models) else {
        return false;
    };
    let total_percent: f64 = known.iter().map(|model| model.credits).sum();
    if total_percent <= 0.0 {
        return false;
    }
    weighted_percent_sum_known(&known) > 0.0
}

fn compute_k_day(
    counts_day: &WorkspaceUsageCountsDay,
    breakdown: &TokenUsageBreakdownDay,
) -> Option<f64> {
    let total_tokens = token_total(counts_day);
    if total_tokens <= 0 || breakdown.units != "percent" || breakdown.models.is_empty() {
        return None;
    }
    let (known, _) = usable_models(&breakdown.models)?;
    let total_percent: f64 = known.iter().map(|model| model.credits).sum();
    if total_percent <= 0.0 {
        return None;
    }
    let weighted = weighted_percent_sum_known(&known);
    if weighted <= 0.0 {
        return None;
    }
    Some(base_credits(counts_day) / weighted)
}

fn weighted_percent_sum_known(models: &[&TokenUsageBreakdownModel]) -> f64 {
    models
        .iter()
        .filter_map(|model| {
            credit_rates::lookup_model_rate(&model.model)
                .map(|rate| model.credits / f64::from(rate.base_multiplier))
        })
        .sum()
}

fn median(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
    let len = sorted.len();
    Some(if len % 2 == 1 {
        sorted[len / 2]
    } else {
        (sorted[len / 2 - 1] + sorted[len / 2]) / 2.0
    })
}

fn median_abs_percent_deviation(values: &[f64], median_k: f64) -> f64 {
    if values.is_empty() || median_k == 0.0 {
        return f64::INFINITY;
    }
    let deviations: Vec<f64> = values
        .iter()
        .map(|value| (value - median_k).abs() / median_k * 100.0)
        .collect();
    median(&deviations).unwrap_or(f64::INFINITY)
}

fn max_abs_percent_deviation(values: &[f64], median_k: f64) -> f64 {
    if values.is_empty() || median_k == 0.0 {
        return f64::INFINITY;
    }
    values
        .iter()
        .map(|value| (value - median_k).abs() / median_k * 100.0)
        .fold(0.0, f64::max)
}

fn calibration_status(sample_count: usize, deviation: f64) -> CalibrationStatus {
    match sample_count {
        0 | 1 => CalibrationStatus::Invalid,
        2 => {
            if deviation <= 2.0 {
                CalibrationStatus::Warning
            } else {
                CalibrationStatus::Invalid
            }
        }
        _ => {
            if deviation <= 0.5 {
                CalibrationStatus::Excellent
            } else if deviation <= 1.0 {
                CalibrationStatus::Good
            } else if deviation <= 2.0 {
                CalibrationStatus::Warning
            } else {
                CalibrationStatus::Invalid
            }
        }
    }
}

fn build_daily_usage(
    counts_by_date: &BTreeMap<String, WorkspaceUsageCountsDay>,
    breakdowns_by_date: &BTreeMap<String, TokenUsageBreakdownDay>,
    today: &str,
    k: Option<f64>,
) -> Vec<DailyCreditUsage> {
    let mut all_dates = BTreeSet::new();
    all_dates.extend(counts_by_date.keys().cloned());
    all_dates.extend(breakdowns_by_date.keys().cloned());

    let mut daily = Vec::new();
    for date in all_dates {
        let counts_day = counts_by_date.get(&date);
        let breakdown_day = breakdowns_by_date.get(&date);
        let total_tokens = counts_day.map(token_total).unwrap_or(0);
        let models = breakdown_day
            .map(|breakdown| breakdown.models.clone())
            .unwrap_or_default();
        let total_percent: f64 = models.iter().map(|model| model.credits).sum();
        let is_pending =
            date == today && total_tokens > 0 && (breakdown_day.is_none() || total_percent <= 0.0);
        let is_partial = date == today;

        let (credits, model_credits) =
            build_day_credits(counts_day, breakdown_day, total_tokens, &models, k);

        daily.push(DailyCreditUsage {
            date,
            credits,
            is_partial: is_partial && credits.is_some(),
            is_pending,
            models: model_credits,
        });
    }
    daily
}

fn build_day_credits(
    counts_day: Option<&WorkspaceUsageCountsDay>,
    breakdown_day: Option<&TokenUsageBreakdownDay>,
    total_tokens: i64,
    models: &[TokenUsageBreakdownModel],
    k: Option<f64>,
) -> (Option<f64>, Vec<ModelCreditUsage>) {
    let Some(k) = k else {
        return (None, Vec::new());
    };
    if counts_day.is_none() {
        return (None, Vec::new());
    }
    if total_tokens == 0 {
        return (Some(0.0), Vec::new());
    }
    let Some(breakdown) = breakdown_day else {
        return (None, Vec::new());
    };
    if breakdown.units != "percent" {
        return (None, Vec::new());
    }
    let Some((known, _)) = usable_models(models) else {
        return (None, Vec::new());
    };
    let total_percent: f64 = known.iter().map(|model| model.credits).sum();
    if total_percent <= 0.0 {
        return (None, Vec::new());
    }
    let model_credits = known
        .iter()
        .filter_map(|model| {
            credit_rates::lookup_model_rate(&model.model).map(|_| ModelCreditUsage {
                model: model.model.clone(),
                credits: k * model.credits,
                percent: if total_percent > 0.0 {
                    model.credits / total_percent * 100.0
                } else {
                    0.0
                },
            })
        })
        .collect();

    (Some(k * total_percent), model_credits)
}

fn aggregate_credits(daily: &[DailyCreditUsage], dates: &[String]) -> CreditAggregate {
    let mut credits_sum = 0.0;
    let mut has_credits = false;
    let mut by_model: BTreeMap<String, f64> = BTreeMap::new();

    for day in daily {
        if !dates.iter().any(|date| date == &day.date) {
            continue;
        }
        if let Some(credits) = day.credits {
            has_credits = true;
            credits_sum += credits;
            for model in &day.models {
                *by_model.entry(model.model.clone()).or_insert(0.0) += model.credits;
            }
        }
    }

    let models = if has_credits {
        by_model
            .into_iter()
            .map(|(model, credits)| ModelCreditUsage {
                percent: if credits_sum > 0.0 {
                    credits / credits_sum * 100.0
                } else {
                    0.0
                },
                credits,
                model,
            })
            .collect()
    } else {
        Vec::new()
    };

    CreditAggregate {
        credits: if has_credits { Some(credits_sum) } else { None },
        models,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server_analytics::{
        TokenUsageBreakdownDay, TokenUsageBreakdownModel, WorkspaceUsageCountsDay,
        WorkspaceUsageCountsTotals,
    };

    fn counts(
        date: &str,
        uncached: i64,
        cached: i64,
        output: i64,
        total: i64,
    ) -> WorkspaceUsageCountsDay {
        WorkspaceUsageCountsDay {
            date: date.to_string(),
            totals: WorkspaceUsageCountsTotals {
                uncached_text_input_tokens: uncached,
                cached_text_input_tokens: cached,
                text_output_tokens: output,
                text_total_tokens: total,
            },
        }
    }

    fn breakdown(
        date: &str,
        units: &str,
        models: Vec<(&str, &str, f64)>,
    ) -> TokenUsageBreakdownDay {
        TokenUsageBreakdownDay {
            date: date.to_string(),
            units: units.to_string(),
            models: models
                .into_iter()
                .map(|(model, speed, credits)| TokenUsageBreakdownModel {
                    model: model.to_string(),
                    speed: speed.to_string(),
                    credits,
                })
                .collect(),
        }
    }

    #[test]
    fn does_not_treat_100_percent_as_100_credits() {
        let counts = vec![counts("2026-08-20", 1_000_000, 0, 1_000_000, 2_000_000)];
        let breakdowns = vec![breakdown(
            "2026-08-20",
            "percent",
            vec![("gpt-5.6-luna", "standard", 100.0)],
        )];
        let response = build_server_credit_analytics(
            counts,
            breakdowns,
            "2026-08-21",
            "2026-08-01",
            "2026-08-21",
        );
        assert_eq!(response.calibration.sample_count, 1);
        assert_eq!(response.calibration.status, CalibrationStatus::Invalid);
        let day = response
            .daily
            .iter()
            .find(|day| day.date == "2026-08-20")
            .unwrap();
        assert_eq!(day.credits, None);
        assert_ne!(day.credits, Some(100.0));
    }

    #[test]
    fn uses_median_calibration() {
        assert_eq!(median(&[1.0, 2.0, 3.0]), Some(2.0));
        assert_eq!(median(&[1.0, 2.0, 3.0, 4.0]), Some(2.5));
        assert_eq!(median(&[]), None);
    }

    #[test]
    fn excludes_current_day_from_calibration() {
        let counts = vec![
            counts("2026-08-20", 100_000, 0, 100_000, 200_000),
            counts("2026-08-21", 100_000, 0, 100_000, 200_000),
        ];
        let breakdowns = vec![
            breakdown(
                "2026-08-20",
                "percent",
                vec![("gpt-5.6-luna", "standard", 100.0)],
            ),
            breakdown(
                "2026-08-21",
                "percent",
                vec![("gpt-5.6-luna", "standard", 100.0)],
            ),
        ];
        let response = build_server_credit_analytics(
            counts,
            breakdowns,
            "2026-08-21",
            "2026-08-01",
            "2026-08-21",
        );
        assert_eq!(response.calibration.sample_count, 1);
        assert_eq!(response.calibration.status, CalibrationStatus::Invalid);
    }

    #[test]
    fn skips_unknown_model_calibration_day() {
        let counts = vec![
            counts("2026-08-20", 100_000, 0, 100_000, 200_000),
            counts("2026-08-19", 100_000, 0, 100_000, 200_000),
        ];
        let breakdowns = vec![
            breakdown(
                "2026-08-20",
                "percent",
                vec![("gpt-5.6-unknown", "standard", 100.0)],
            ),
            breakdown(
                "2026-08-19",
                "percent",
                vec![("gpt-5.6-luna", "standard", 100.0)],
            ),
        ];
        let response = build_server_credit_analytics(
            counts,
            breakdowns,
            "2026-08-21",
            "2026-08-01",
            "2026-08-21",
        );
        assert_eq!(response.calibration.sample_count, 1);
        assert_eq!(response.calibration.status, CalibrationStatus::Invalid);
        assert_eq!(
            response
                .daily
                .iter()
                .find(|day| day.date == "2026-08-20")
                .unwrap()
                .credits,
            None
        );
    }

    #[test]
    fn ignores_zero_percent_unknown_legacy_models() {
        // Real WHAM breakdowns keep listing retired models (e.g. gpt-5.5) with a
        // zero percent share; such residue must not invalidate the whole day.
        let counts = vec![
            counts("2026-08-20", 100_000, 0, 100_000, 200_000),
            counts("2026-08-19", 100_000, 0, 100_000, 200_000),
        ];
        let breakdowns = vec![
            breakdown(
                "2026-08-20",
                "percent",
                vec![
                    ("gpt-5.6-sol", "standard", 50.0),
                    ("gpt-5.5", "standard", 0.0),
                ],
            ),
            breakdown(
                "2026-08-19",
                "percent",
                vec![
                    ("gpt-5.6-sol", "standard", 50.0),
                    ("gpt-5.5", "standard", 0.0),
                ],
            ),
        ];
        let response = build_server_credit_analytics(
            counts,
            breakdowns,
            "2026-08-21",
            "2026-08-01",
            "2026-08-21",
        );
        assert_eq!(response.calibration.sample_count, 2);
        // Two agreeing samples cap at Warning; Excellent requires >= 3 samples.
        assert_eq!(response.calibration.status, CalibrationStatus::Warning);
    }

    #[test]
    fn rejects_day_when_unknown_model_share_is_material() {
        let counts = vec![
            counts("2026-08-20", 100_000, 0, 100_000, 200_000),
            counts("2026-08-19", 100_000, 0, 100_000, 200_000),
        ];
        let breakdowns = vec![
            breakdown(
                "2026-08-20",
                "percent",
                vec![
                    ("gpt-5.6-sol", "standard", 50.0),
                    ("gpt-5.5", "standard", 6.9),
                ],
            ),
            breakdown(
                "2026-08-19",
                "percent",
                vec![("gpt-5.6-sol", "standard", 50.0)],
            ),
        ];
        let response = build_server_credit_analytics(
            counts,
            breakdowns,
            "2026-08-21",
            "2026-08-01",
            "2026-08-21",
        );
        // Only the clean day calibrates; the contaminated day yields no credits.
        assert_eq!(response.calibration.sample_count, 1);
        assert_eq!(
            response
                .daily
                .iter()
                .find(|day| day.date == "2026-08-20")
                .unwrap()
                .credits,
            None
        );
    }

    #[test]
    fn skips_fast_speed_calibration_day() {
        let counts = vec![
            counts("2026-08-20", 100_000, 0, 100_000, 200_000),
            counts("2026-08-19", 100_000, 0, 100_000, 200_000),
        ];
        let breakdowns = vec![
            breakdown(
                "2026-08-20",
                "percent",
                vec![("gpt-5.6-luna", "fast", 100.0)],
            ),
            breakdown(
                "2026-08-19",
                "percent",
                vec![("gpt-5.6-luna", "standard", 100.0)],
            ),
        ];
        let response = build_server_credit_analytics(
            counts,
            breakdowns,
            "2026-08-21",
            "2026-08-01",
            "2026-08-21",
        );
        assert_eq!(response.calibration.sample_count, 1);
        assert_eq!(
            response
                .daily
                .iter()
                .find(|day| day.date == "2026-08-20")
                .unwrap()
                .credits,
            None
        );
    }

    #[test]
    fn rejects_non_percent_breakdown_for_percent_algorithm() {
        let counts = vec![
            counts("2026-08-20", 100_000, 0, 100_000, 200_000),
            counts("2026-08-19", 100_000, 0, 100_000, 200_000),
        ];
        let breakdowns = vec![
            breakdown(
                "2026-08-20",
                "credits",
                vec![("gpt-5.6-luna", "standard", 100.0)],
            ),
            breakdown(
                "2026-08-19",
                "credits",
                vec![("gpt-5.6-luna", "standard", 100.0)],
            ),
        ];
        let response = build_server_credit_analytics(
            counts,
            breakdowns,
            "2026-08-21",
            "2026-08-01",
            "2026-08-21",
        );
        assert_eq!(response.calibration.sample_count, 0);
        assert_eq!(response.calibration.status, CalibrationStatus::Invalid);
        assert_eq!(
            response
                .daily
                .iter()
                .find(|day| day.date == "2026-08-20")
                .unwrap()
                .credits,
            None
        );
    }

    #[test]
    fn marks_calibration_invalid_when_samples_disagree() {
        let counts = vec![
            counts("2026-08-19", 100_000, 0, 100_000, 200_000),
            counts("2026-08-20", 200_000, 0, 200_000, 400_000),
        ];
        let breakdowns = vec![
            breakdown(
                "2026-08-19",
                "percent",
                vec![("gpt-5.6-luna", "standard", 100.0)],
            ),
            breakdown(
                "2026-08-20",
                "percent",
                vec![("gpt-5.6-luna", "standard", 100.0)],
            ),
        ];
        let response = build_server_credit_analytics(
            counts,
            breakdowns,
            "2026-08-21",
            "2026-08-01",
            "2026-08-21",
        );
        assert_eq!(response.calibration.sample_count, 2);
        assert_eq!(response.calibration.status, CalibrationStatus::Invalid);
    }

    #[test]
    fn handles_zero_usage_day() {
        let counts = vec![
            counts("2026-08-20", 0, 0, 0, 0),
            counts("2026-08-19", 100_000, 0, 100_000, 200_000),
            counts("2026-08-18", 100_000, 0, 100_000, 200_000),
            counts("2026-08-17", 100_000, 0, 100_000, 200_000),
        ];
        let breakdowns = vec![
            breakdown(
                "2026-08-20",
                "percent",
                vec![("gpt-5.6-luna", "standard", 0.0)],
            ),
            breakdown(
                "2026-08-19",
                "percent",
                vec![("gpt-5.6-luna", "standard", 100.0)],
            ),
            breakdown(
                "2026-08-18",
                "percent",
                vec![("gpt-5.6-luna", "standard", 100.0)],
            ),
            breakdown(
                "2026-08-17",
                "percent",
                vec![("gpt-5.6-luna", "standard", 100.0)],
            ),
        ];
        let response = build_server_credit_analytics(
            counts,
            breakdowns,
            "2026-08-21",
            "2026-08-01",
            "2026-08-21",
        );
        let zero_day = response
            .daily
            .iter()
            .find(|day| day.date == "2026-08-20")
            .unwrap();
        assert_eq!(zero_day.credits, Some(0.0));
        assert_eq!(response.calibration.sample_count, 3);
    }

    #[test]
    fn marks_today_pending_when_tokens_exist_but_breakdown_is_zero() {
        let counts = vec![
            counts("2026-08-21", 100_000, 0, 100_000, 200_000),
            counts("2026-08-20", 100_000, 0, 100_000, 200_000),
            counts("2026-08-19", 100_000, 0, 100_000, 200_000),
        ];
        let breakdowns = vec![
            breakdown(
                "2026-08-20",
                "percent",
                vec![("gpt-5.6-luna", "standard", 100.0)],
            ),
            breakdown(
                "2026-08-19",
                "percent",
                vec![("gpt-5.6-luna", "standard", 100.0)],
            ),
        ];
        let response = build_server_credit_analytics(
            counts,
            breakdowns,
            "2026-08-21",
            "2026-08-01",
            "2026-08-21",
        );
        let today = response.today.as_ref().unwrap();
        assert!(today.is_pending);
        assert_eq!(today.credits, None);
        assert_eq!(response.status, ServerCreditAnalyticsStatus::Pending);
    }

    #[test]
    fn calibrates_same_credits_across_7d_and_30d_windows() {
        let counts_7d = vec![
            counts("2026-08-18", 1_000_000, 0, 1_000_000, 2_000_000),
            counts("2026-08-19", 2_000_000, 0, 1_000_000, 3_000_000),
            counts("2026-08-20", 3_000_000, 0, 1_000_000, 4_000_000),
        ];
        let breakdowns_7d = vec![
            breakdown(
                "2026-08-18",
                "percent",
                vec![("gpt-5.6-terra", "standard", 350.0)],
            ),
            breakdown(
                "2026-08-19",
                "percent",
                vec![("gpt-5.6-luna", "standard", 40.0)],
            ),
            breakdown(
                "2026-08-20",
                "percent",
                vec![("gpt-5.6-sol", "standard", 1125.0)],
            ),
        ];
        let counts_30d = counts_7d.clone();
        let breakdowns_30d = vec![
            breakdown(
                "2026-08-18",
                "percent",
                vec![("gpt-5.6-terra", "standard", 105.0)],
            ),
            breakdown(
                "2026-08-19",
                "percent",
                vec![("gpt-5.6-luna", "standard", 12.0)],
            ),
            breakdown(
                "2026-08-20",
                "percent",
                vec![("gpt-5.6-sol", "standard", 337.5)],
            ),
        ];
        let response_7d = build_server_credit_analytics(
            counts_7d,
            breakdowns_7d,
            "2026-08-21",
            "2026-08-15",
            "2026-08-21",
        );
        let response_30d = build_server_credit_analytics(
            counts_30d,
            breakdowns_30d,
            "2026-08-21",
            "2026-07-23",
            "2026-08-21",
        );
        assert_eq!(response_7d.calibration.status, CalibrationStatus::Excellent);
        assert_eq!(
            response_30d.calibration.status,
            CalibrationStatus::Excellent
        );
        for date in ["2026-08-18", "2026-08-19", "2026-08-20"] {
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
    fn does_not_depend_on_counts_credits_field() {
        // The counts DTO intentionally has no credits field; any server-provided
        // credits value in the raw JSON is ignored by serde and must not affect math.
        let counts = vec![
            counts("2026-08-18", 1_000_000, 0, 1_000_000, 2_000_000),
            counts("2026-08-19", 2_000_000, 0, 1_000_000, 3_000_000),
            counts("2026-08-20", 3_000_000, 0, 1_000_000, 4_000_000),
        ];
        let breakdowns = vec![
            breakdown(
                "2026-08-18",
                "percent",
                vec![("gpt-5.6-luna", "standard", 35.0)],
            ),
            breakdown(
                "2026-08-19",
                "percent",
                vec![("gpt-5.6-luna", "standard", 40.0)],
            ),
            breakdown(
                "2026-08-20",
                "percent",
                vec![("gpt-5.6-luna", "standard", 45.0)],
            ),
        ];
        let response = build_server_credit_analytics(
            counts,
            breakdowns,
            "2026-08-21",
            "2026-08-01",
            "2026-08-21",
        );
        assert!(response.last_30_days.credits.unwrap() > 0.0);
        assert!(response.calibration.status != CalibrationStatus::Invalid);
    }
}

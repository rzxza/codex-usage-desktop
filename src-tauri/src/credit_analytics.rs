use crate::{
    credit_rates,
    server_analytics::{TokenUsageBreakdownDay, TokenUsageBreakdownModel, WorkspaceUsageCountsDay},
    types::{
        CalibrationDiagnostics, CalibrationStatus, CalibrationSummary, CompleteCreditWindow,
        CreditAggregate, CreditWindowCompleteness, DailyCreditUsage, ModelCreditUsage,
        ServerCreditAnalyticsResponse, ServerCreditAnalyticsStatus, SevenDayCreditPoint,
    },
};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

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
    let mut eligible_days = 0usize;
    let mut excluded_days = 0usize;
    let mut unsupported_models_seen: BTreeSet<String> = BTreeSet::new();
    let mut unsupported_speeds_seen: BTreeSet<String> = BTreeSet::new();
    let mut units_seen: Option<String> = None;
    for date in &all_dates {
        let counts_day = counts_by_date.get(date);
        let breakdown_day = breakdowns_by_date.get(date);
        if let (Some(counts_day), Some(breakdown_day)) = (counts_day, breakdown_day) {
            if units_seen.is_none() {
                units_seen = Some(breakdown_day.units.clone());
            }
            for model in &breakdown_day.models {
                if !credit_rates::is_supported_rate_model(&model.model) {
                    unsupported_models_seen.insert(model.model.clone());
                } else if !credit_rates::is_standard_speed(&model.speed) {
                    unsupported_speeds_seen.insert(model.speed.clone());
                }
            }
            if is_eligible_for_calibration(
                date,
                today,
                token_total(counts_day),
                Some(breakdown_day),
            ) {
                eligible_days += 1;
                if let Some(k_day) = compute_k_day(counts_day, breakdown_day) {
                    k_values.push(k_day);
                }
            } else {
                excluded_days += 1;
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
    let daily_by_date: BTreeMap<String, DailyCreditUsage> = daily
        .iter()
        .map(|day| (day.date.clone(), day.clone()))
        .collect();

    let latest_complete_date = all_dates
        .iter()
        .filter(|date| is_complete_day(date, today, &counts_by_date, &breakdowns_by_date))
        .max()
        .cloned();
    let latest_complete_day = latest_complete_date
        .as_ref()
        .and_then(|date| daily_by_date.get(date).cloned());
    let window_end = latest_complete_date
        .clone()
        .unwrap_or_else(|| today.to_string());
    let previous_7_end =
        crate::date::shift_date_key(&window_end, -7).unwrap_or_else(|_| window_end.clone());

    let last_7_complete_days = complete_window(
        &window_end,
        7,
        &counts_by_date,
        &breakdowns_by_date,
        today,
        &daily_by_date,
    );
    let previous_7_complete_days = complete_window(
        &previous_7_end,
        7,
        &counts_by_date,
        &breakdowns_by_date,
        today,
        &daily_by_date,
    );
    let last_30_complete_days = complete_window(
        &window_end,
        30,
        &counts_by_date,
        &breakdowns_by_date,
        today,
        &daily_by_date,
    );
    let seven_day_series = seven_day_series(
        &window_end,
        &counts_by_date,
        &breakdowns_by_date,
        today,
        &daily_by_date,
    );
    let seven_day_delta_percent = match (
        last_7_complete_days.credits,
        previous_7_complete_days.credits,
    ) {
        (Some(current), Some(previous)) if previous > 0.0 => {
            Some((current - previous) / previous * 100.0)
        }
        _ => None,
    };

    let today_entry = daily.iter().find(|day| day.date == today);
    let top_status = if k.is_none() {
        ServerCreditAnalyticsStatus::Invalid
    } else if !last_7_complete_days.completeness.is_complete
        || !last_30_complete_days.completeness.is_complete
    {
        ServerCreditAnalyticsStatus::Partial
    } else {
        ServerCreditAnalyticsStatus::Ready
    };

    let last_7_start = crate::date::shift_date_key(today, -6).unwrap_or_else(|_| today.to_string());
    // Keep legacy `last30Days` a true 30-calendar-day window even though the
    // upstream fetch horizon is now 45 days. This field is deprecated for UI
    // but must not silently aggregate 45 days.
    let legacy_last_30_start =
        crate::date::shift_date_key(today, -29).unwrap_or_else(|_| today.to_string());
    let all_dates_vec: Vec<String> = all_dates.into_iter().collect();
    let last_7_dates: Vec<String> = all_dates_vec
        .iter()
        .filter(|date| date.as_str() >= last_7_start.as_str() && date.as_str() <= today)
        .cloned()
        .collect();
    let last_30_dates: Vec<String> = all_dates_vec
        .iter()
        .filter(|date| date.as_str() >= legacy_last_30_start.as_str() && date.as_str() <= today)
        .cloned()
        .collect();

    let models = aggregate_credits(&daily, &all_dates_vec).models;

    let diagnostics = CalibrationDiagnostics {
        eligible_days,
        excluded_days,
        unsupported_models: unsupported_models_seen.into_iter().collect(),
        unsupported_speeds: unsupported_speeds_seen.into_iter().collect(),
        units: units_seen.unwrap_or_default(),
    };

    ServerCreditAnalyticsResponse {
        fetched_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        diagnostics: Some(diagnostics),
        start_date: start_date.to_string(),
        end_date: end_date.to_string(),
        status: top_status,
        calibration,
        latest_complete_date,
        latest_complete_day,
        last_7_complete_days,
        previous_7_complete_days,
        last_30_complete_days,
        seven_day_delta_percent,
        seven_day_series,
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

/// Luna-equivalent base credits for a day, computed strictly from the shared
/// rate profile in `credit_rates` (single source of truth).
fn base_credits(day: &WorkspaceUsageCountsDay) -> f64 {
    (credit_rates::BASE_INPUT_PER_MILLION * day.totals.uncached_text_input_tokens as f64
        + credit_rates::BASE_CACHED_INPUT_PER_MILLION * day.totals.cached_text_input_tokens as f64
        + credit_rates::BASE_OUTPUT_PER_MILLION * day.totals.text_output_tokens as f64)
        / MILLION
}

fn is_complete_day(
    date: &str,
    today: &str,
    counts_by_date: &BTreeMap<String, WorkspaceUsageCountsDay>,
    breakdowns_by_date: &BTreeMap<String, TokenUsageBreakdownDay>,
) -> bool {
    if date >= today {
        return false;
    }
    let Some(counts_day) = counts_by_date.get(date) else {
        return false;
    };
    let total_tokens = token_total(counts_day);
    // A zero-usage day is complete only when the breakdown does not claim any
    // nonzero usage. If a breakdown exists with positive percent while counts
    // say zero, the two source snapshots are inconsistent -> fail closed.
    if total_tokens == 0 {
        return breakdowns_by_date
            .get(date)
            .map(|breakdown| breakdown.models.iter().all(|model| model.credits <= 0.0))
            .unwrap_or(true);
    }
    let Some(breakdown_day) = breakdowns_by_date.get(date) else {
        return false;
    };
    if breakdown_day.units != "percent" {
        return false;
    }
    let Some((known, _)) = usable_models(&breakdown_day.models) else {
        return false;
    };
    let total_percent: f64 = known.iter().map(|model| model.credits).sum();
    total_percent > 0.0
}

fn complete_window(
    end_date: &str,
    window_days: i64,
    counts_by_date: &BTreeMap<String, WorkspaceUsageCountsDay>,
    breakdowns_by_date: &BTreeMap<String, TokenUsageBreakdownDay>,
    today: &str,
    daily_by_date: &BTreeMap<String, DailyCreditUsage>,
) -> CompleteCreditWindow {
    let start_date = crate::date::shift_date_key(end_date, -(window_days - 1))
        .unwrap_or_else(|_| end_date.to_string());
    let mut complete_dates = Vec::new();
    let mut missing_dates = Vec::new();
    let mut current = start_date.clone();
    while current.as_str() <= end_date {
        if is_complete_day(&current, today, counts_by_date, breakdowns_by_date) {
            complete_dates.push(current.clone());
        } else {
            missing_dates.push(current.clone());
        }
        current = crate::date::shift_date_key(&current, 1).unwrap_or_else(|_| current.clone());
    }

    let is_complete = missing_dates.is_empty();
    let mut credits_sum = 0.0;
    let mut has_credits = false;
    let mut by_model: BTreeMap<String, f64> = BTreeMap::new();
    for date in &complete_dates {
        if let Some(day) = daily_by_date.get(date) {
            if let Some(credits) = day.credits {
                has_credits = true;
                credits_sum += credits;
                for model in &day.models {
                    *by_model.entry(model.model.clone()).or_insert(0.0) += model.credits;
                }
            }
        }
    }

    let models = if has_credits {
        by_model
            .into_iter()
            .map(|(model, credits)| ModelCreditUsage {
                credits,
                percent: if credits_sum > 0.0 {
                    credits / credits_sum * 100.0
                } else {
                    0.0
                },
                model,
            })
            .collect()
    } else {
        Vec::new()
    };

    CompleteCreditWindow {
        start_date,
        end_date: end_date.to_string(),
        credits: if is_complete && has_credits {
            Some(credits_sum)
        } else {
            None
        },
        known_credits: if has_credits { Some(credits_sum) } else { None },
        known_models: models.clone(),
        models: if is_complete { models } else { Vec::new() },
        completeness: CreditWindowCompleteness {
            expected_days: window_days as u32,
            complete_days: complete_dates.len() as u32,
            missing_dates,
            is_complete,
        },
    }
}

fn seven_day_series(
    end_date: &str,
    counts_by_date: &BTreeMap<String, WorkspaceUsageCountsDay>,
    breakdowns_by_date: &BTreeMap<String, TokenUsageBreakdownDay>,
    today: &str,
    daily_by_date: &BTreeMap<String, DailyCreditUsage>,
) -> Vec<SevenDayCreditPoint> {
    let start_date =
        crate::date::shift_date_key(end_date, -6).unwrap_or_else(|_| end_date.to_string());
    let mut series = Vec::new();
    let mut current = start_date.clone();
    while current.as_str() <= end_date {
        let credits = if is_complete_day(&current, today, counts_by_date, breakdowns_by_date) {
            daily_by_date.get(&current).and_then(|day| day.credits)
        } else {
            None
        };
        series.push(SevenDayCreditPoint {
            date: current.clone(),
            credits,
        });
        current = crate::date::shift_date_key(&current, 1).unwrap_or_else(|_| current.clone());
    }
    series
}

/// Percentage-point share below which unsupported model/speed entries in a
/// breakdown are considered legacy residue (e.g. `gpt-5.6-sol-preview: 0.0`) and ignored.
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
        // Real WHAM breakdowns can list unsupported model names with a zero
        // percent share; such residue must not invalidate the whole day.
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
                    ("gpt-5.6-sol-preview", "standard", 0.0),
                ],
            ),
            breakdown(
                "2026-08-19",
                "percent",
                vec![
                    ("gpt-5.6-sol", "standard", 50.0),
                    ("gpt-5.6-sol-preview", "standard", 0.0),
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
                    ("gpt-5.6-sol-preview", "standard", 6.9),
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
        let diag = response.diagnostics.expect("diagnostics attached");
        assert_eq!(diag.eligible_days, 3);
        assert_eq!(diag.excluded_days, 1); // the zero-usage day
        assert!(diag.unsupported_models.is_empty());
        assert_eq!(diag.units, "percent");
    }

    #[test]
    fn marks_today_pending_but_status_uses_complete_windows() {
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
        assert_eq!(response.status, ServerCreditAnalyticsStatus::Partial);
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
    fn calibrates_to_real_account_golden_value() {
        // Hand-verified against live WHAM data for 2026-08-18:
        // uncached=11_050_013 cached=208_925_824 output=942_290 with
        // sol 20.476773774943236% terra 0.16138313406044213% luna 0.8336911893453841%
        // => median K ~= 112.63804 under included_usage_equivalent_v1.
        let tokens = counts("2026-08-18", 11_050_013, 208_925_824, 942_290, 220_918_127);
        let models = vec![
            ("gpt-5.6-sol", "standard", 20.476_773_774_943_236_f64),
            ("gpt-5.6-terra", "standard", 0.161_383_134_060_442_13),
            ("gpt-5.6-luna", "standard", 0.833_691_189_345_384_1),
        ];
        let counts = vec![
            tokens.clone(),
            counts("2026-08-17", 11_050_013, 208_925_824, 942_290, 220_918_127),
        ];
        let breakdowns = vec![
            breakdown("2026-08-18", "percent", models.clone()),
            breakdown("2026-08-17", "percent", models),
        ];
        let response = build_server_credit_analytics(
            counts,
            breakdowns,
            "2026-08-19",
            "2026-08-17",
            "2026-08-19",
        );
        // Two agreeing samples cap at Warning even when deviation is zero.
        assert_eq!(response.calibration.status, CalibrationStatus::Warning);

        let k = response.calibration.k.expect("k calibrated");
        assert!((k - 112.638_04).abs() < 5e-5, "golden K drifted: {k}");

        let expected_day =
            k * (20.476_773_774_943_236 + 0.161_383_134_060_442_13 + 0.833_691_189_345_384_1);
        let day = response
            .daily
            .iter()
            .find(|d| d.date == "2026-08-18")
            .unwrap();
        let credits = day.credits.expect("day priced");
        assert!((credits - expected_day).abs() < 1e-6);
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
    #[test]
    fn today_pending_does_not_shorten_last7_complete_window() {
        // today=08/25 has no breakdown, but 08/18..08/24 are complete.
        let mut count_rows = Vec::new();
        let mut breakdowns = Vec::new();
        for day in 18..=24 {
            let date = format!("2026-08-{day:02}");
            count_rows.push(counts(&date, 100_000, 0, 100_000, 200_000));
            breakdowns.push(breakdown(
                &date,
                "percent",
                vec![("gpt-5.6-luna", "standard", 100.0)],
            ));
        }
        count_rows.push(counts("2026-08-25", 100_000, 0, 100_000, 200_000));
        let response = build_server_credit_analytics(
            count_rows,
            breakdowns,
            "2026-08-25",
            "2026-08-01",
            "2026-08-25",
        );
        assert_eq!(response.latest_complete_date.as_deref(), Some("2026-08-24"));
        assert_eq!(response.last_7_complete_days.completeness.expected_days, 7);
        assert_eq!(response.last_7_complete_days.completeness.complete_days, 7);
        assert!(response.last_7_complete_days.completeness.is_complete);
        assert_eq!(response.last_7_complete_days.start_date, "2026-08-18");
        assert_eq!(response.last_7_complete_days.end_date, "2026-08-24");
    }

    #[test]
    fn last30_complete_window_uses_latest_complete_date() {
        let mut count_rows = Vec::new();
        let mut breakdowns = Vec::new();
        for day in 1..=24 {
            let date = format!("2026-08-{day:02}");
            count_rows.push(counts(&date, 100_000, 0, 100_000, 200_000));
            breakdowns.push(breakdown(
                &date,
                "percent",
                vec![("gpt-5.6-luna", "standard", 100.0)],
            ));
        }
        let response = build_server_credit_analytics(
            count_rows,
            breakdowns,
            "2026-08-25",
            "2026-08-01",
            "2026-08-25",
        );
        assert_eq!(response.latest_complete_date.as_deref(), Some("2026-08-24"));
        assert_eq!(response.last_30_complete_days.end_date, "2026-08-24");
        assert_eq!(
            response.last_30_complete_days.completeness.expected_days,
            30
        );
        assert_eq!(
            response.last_30_complete_days.completeness.complete_days,
            24
        );
        assert!(!response.last_30_complete_days.completeness.is_complete);
    }

    #[test]
    fn forty_five_day_horizon_yields_30_30_complete_window() {
        let mut count_rows = Vec::new();
        let mut breakdowns = Vec::new();
        for day in 26..=31 {
            let date = format!("2026-07-{day:02}");
            count_rows.push(counts(&date, 100_000, 0, 100_000, 200_000));
            breakdowns.push(breakdown(
                &date,
                "percent",
                vec![("gpt-5.6-luna", "standard", 100.0)],
            ));
        }
        for day in 1..=24 {
            let date = format!("2026-08-{day:02}");
            count_rows.push(counts(&date, 100_000, 0, 100_000, 200_000));
            breakdowns.push(breakdown(
                &date,
                "percent",
                vec![("gpt-5.6-luna", "standard", 100.0)],
            ));
        }
        let response = build_server_credit_analytics(
            count_rows,
            breakdowns,
            "2026-08-25",
            "2026-07-12",
            "2026-08-25",
        );
        assert_eq!(response.latest_complete_date.as_deref(), Some("2026-08-24"));
        assert_eq!(response.last_30_complete_days.start_date, "2026-07-26");
        assert_eq!(response.last_30_complete_days.end_date, "2026-08-24");
        assert_eq!(
            response.last_30_complete_days.completeness.expected_days,
            30
        );
        assert_eq!(
            response.last_30_complete_days.completeness.complete_days,
            30
        );
        assert!(response.last_30_complete_days.completeness.is_complete);
    }

    #[test]
    fn legacy_last30_days_stays_30_days_when_fetch_is_45() {
        let mut count_rows = Vec::new();
        let mut breakdowns = Vec::new();
        let mut date = "2026-07-12".to_string();
        let end = "2026-08-25".to_string();
        while date.as_str() <= end.as_str() {
            count_rows.push(counts(&date, 100_000, 0, 100_000, 200_000));
            breakdowns.push(breakdown(
                &date,
                "percent",
                vec![("gpt-5.6-luna", "standard", 100.0)],
            ));
            date = crate::date::shift_date_key(&date, 1).unwrap();
        }

        let response = build_server_credit_analytics(
            count_rows,
            breakdowns,
            "2026-08-25",
            "2026-07-12",
            "2026-08-25",
        );
        let expected_legacy_sum: f64 = response
            .daily
            .iter()
            .filter(|day| day.date.as_str() >= "2026-07-27" && day.date.as_str() <= "2026-08-25")
            .filter_map(|day| day.credits)
            .sum();
        assert!(
            (response.last_30_days.credits.unwrap() - expected_legacy_sum).abs() < 1e-6,
            "legacy last30Days must aggregate only the 30-day window"
        );
        let early_sum: f64 = response
            .daily
            .iter()
            .filter(|day| day.date.as_str() < "2026-07-27")
            .filter_map(|day| day.credits)
            .sum();
        assert!(early_sum > 0.0);
        assert!(
            response.last_30_days.credits.unwrap()
                < response
                    .daily
                    .iter()
                    .filter_map(|day| day.credits)
                    .sum::<f64>()
        );
    }

    #[test]
    fn missing_historical_day_fails_completeness() {
        let mut count_rows = Vec::new();
        let mut breakdowns = Vec::new();
        for day in 18..=24 {
            let date = format!("2026-08-{day:02}");
            count_rows.push(counts(&date, 100_000, 0, 100_000, 200_000));
            breakdowns.push(breakdown(
                &date,
                "percent",
                vec![("gpt-5.6-luna", "standard", 100.0)],
            ));
        }
        // Remove 08/21 from breakdowns -> missing day.
        breakdowns.retain(|day| day.date != "2026-08-21");
        let response = build_server_credit_analytics(
            count_rows,
            breakdowns,
            "2026-08-25",
            "2026-08-01",
            "2026-08-25",
        );
        assert_eq!(response.last_7_complete_days.completeness.complete_days, 6);
        assert!(!response.last_7_complete_days.completeness.is_complete);
        assert_eq!(response.last_7_complete_days.credits, None);
        assert!(response
            .last_7_complete_days
            .completeness
            .missing_dates
            .contains(&"2026-08-21".to_string()));
    }

    #[test]
    fn zero_usage_day_counts_as_complete() {
        let mut count_rows = Vec::new();
        let mut breakdowns = Vec::new();
        for day in 18..=24 {
            let date = format!("2026-08-{day:02}");
            if day == 21 {
                count_rows.push(counts(&date, 0, 0, 0, 0));
                breakdowns.push(breakdown(&date, "percent", vec![]));
            } else {
                count_rows.push(counts(&date, 100_000, 0, 100_000, 200_000));
                breakdowns.push(breakdown(
                    &date,
                    "percent",
                    vec![("gpt-5.6-luna", "standard", 100.0)],
                ));
            }
        }
        let response = build_server_credit_analytics(
            count_rows,
            breakdowns,
            "2026-08-25",
            "2026-08-01",
            "2026-08-25",
        );
        assert_eq!(response.last_7_complete_days.completeness.complete_days, 7);
        assert!(response.last_7_complete_days.completeness.is_complete);
    }

    #[test]
    fn zero_token_day_without_breakdown_is_complete() {
        let mut count_rows = Vec::new();
        let mut breakdowns = Vec::new();
        for day in 18..=24 {
            let date = format!("2026-08-{day:02}");
            if day == 21 {
                // Counts row exists and is zero; no breakdown row at all.
                count_rows.push(counts(&date, 0, 0, 0, 0));
            } else {
                count_rows.push(counts(&date, 100_000, 0, 100_000, 200_000));
                breakdowns.push(breakdown(
                    &date,
                    "percent",
                    vec![("gpt-5.6-luna", "standard", 100.0)],
                ));
            }
        }
        let response = build_server_credit_analytics(
            count_rows,
            breakdowns,
            "2026-08-25",
            "2026-08-01",
            "2026-08-25",
        );
        assert_eq!(response.last_7_complete_days.completeness.complete_days, 7);
        assert!(response.last_7_complete_days.completeness.is_complete);
        assert_eq!(
            response
                .last_7_complete_days
                .completeness
                .missing_dates
                .len(),
            0
        );
        assert!(response.last_7_complete_days.credits.is_some());
        assert!(response.last_7_complete_days.known_credits.is_some());
    }

    #[test]
    fn zero_counts_with_nonzero_breakdown_fails_closed() {
        let mut count_rows = Vec::new();
        let mut breakdowns = Vec::new();
        for day in 18..=24 {
            let date = format!("2026-08-{day:02}");
            if day == 21 {
                // Counts say zero but breakdown claims nonzero usage: fail closed.
                count_rows.push(counts(&date, 0, 0, 0, 0));
                breakdowns.push(breakdown(
                    &date,
                    "percent",
                    vec![("gpt-5.6-sol", "standard", 25.3)],
                ));
            } else {
                count_rows.push(counts(&date, 100_000, 0, 100_000, 200_000));
                breakdowns.push(breakdown(
                    &date,
                    "percent",
                    vec![("gpt-5.6-luna", "standard", 100.0)],
                ));
            }
        }
        let response = build_server_credit_analytics(
            count_rows,
            breakdowns,
            "2026-08-25",
            "2026-08-01",
            "2026-08-25",
        );
        assert_eq!(response.last_7_complete_days.completeness.complete_days, 6);
        assert!(!response.last_7_complete_days.completeness.is_complete);
        assert!(response
            .last_7_complete_days
            .completeness
            .missing_dates
            .contains(&"2026-08-21".to_string()));
        assert_eq!(response.last_7_complete_days.credits, None);
        assert!(response.last_7_complete_days.known_credits.is_some());
    }

    #[test]
    fn seven_day_series_keeps_seven_slots_with_null_and_zero() {
        let mut count_rows = Vec::new();
        let mut breakdowns = Vec::new();
        for day in 18..=24 {
            let date = format!("2026-08-{day:02}");
            if day == 21 {
                // Completely missing source rows -> unknown null slot.
                continue;
            }
            if day == 22 {
                // Explicit zero usage, no breakdown -> complete zero day.
                count_rows.push(counts(&date, 0, 0, 0, 0));
                continue;
            }
            count_rows.push(counts(&date, 100_000, 0, 100_000, 200_000));
            breakdowns.push(breakdown(
                &date,
                "percent",
                vec![("gpt-5.6-luna", "standard", 100.0)],
            ));
        }
        let response = build_server_credit_analytics(
            count_rows,
            breakdowns,
            "2026-08-25",
            "2026-08-01",
            "2026-08-25",
        );
        assert_eq!(response.seven_day_series.len(), 7);
        let missing = response
            .seven_day_series
            .iter()
            .find(|point| point.date == "2026-08-21")
            .unwrap();
        assert_eq!(missing.credits, None);
        let zero = response
            .seven_day_series
            .iter()
            .find(|point| point.date == "2026-08-22")
            .unwrap();
        assert_eq!(zero.credits, Some(0.0));
        let normal = response
            .seven_day_series
            .iter()
            .find(|point| point.date == "2026-08-20")
            .unwrap();
        assert!(normal.credits.unwrap() > 0.0);
    }

    #[test]
    fn mixed_gpt55_sol_luna_terra_is_complete() {
        let mut count_rows = Vec::new();
        let mut breakdowns = Vec::new();
        for day in 16..=22 {
            let date = format!("2026-08-{day:02}");
            count_rows.push(counts(&date, 100_000, 0, 100_000, 200_000));
            if day == 21 {
                breakdowns.push(breakdown(
                    &date,
                    "percent",
                    vec![
                        ("gpt-5.6-sol", "standard", 25.0),
                        ("gpt-5.6-luna", "standard", 25.0),
                        ("gpt-5.5", "standard", 25.0),
                        ("gpt-5.6-terra", "standard", 25.0),
                    ],
                ));
            } else {
                breakdowns.push(breakdown(
                    &date,
                    "percent",
                    vec![("gpt-5.6-luna", "standard", 100.0)],
                ));
            }
        }
        let response = build_server_credit_analytics(
            count_rows,
            breakdowns,
            "2026-08-23",
            "2026-08-01",
            "2026-08-23",
        );
        assert_eq!(response.latest_complete_date.as_deref(), Some("2026-08-22"));
        assert!(response.last_7_complete_days.completeness.is_complete);
        assert_eq!(response.last_7_complete_days.completeness.complete_days, 7);
    }

    #[test]
    fn mixed_gpt55_sol_luna_is_complete() {
        let mut count_rows = Vec::new();
        let mut breakdowns = Vec::new();
        for day in 16..=22 {
            let date = format!("2026-08-{day:02}");
            count_rows.push(counts(&date, 100_000, 0, 100_000, 200_000));
            if day == 22 {
                breakdowns.push(breakdown(
                    &date,
                    "percent",
                    vec![
                        ("gpt-5.6-sol", "standard", 40.0),
                        ("gpt-5.6-luna", "standard", 30.0),
                        ("gpt-5.5", "standard", 30.0),
                    ],
                ));
            } else {
                breakdowns.push(breakdown(
                    &date,
                    "percent",
                    vec![("gpt-5.6-luna", "standard", 100.0)],
                ));
            }
        }
        let response = build_server_credit_analytics(
            count_rows,
            breakdowns,
            "2026-08-23",
            "2026-08-01",
            "2026-08-23",
        );
        assert_eq!(response.latest_complete_date.as_deref(), Some("2026-08-22"));
        assert!(response.last_7_complete_days.completeness.is_complete);
        assert_eq!(response.last_7_complete_days.completeness.complete_days, 7);
    }

    #[test]
    fn previous_7_delta_is_computed_from_complete_windows() {
        let mut count_rows = Vec::new();
        let mut breakdowns = Vec::new();
        for day in 11..=24 {
            let date = format!("2026-08-{day:02}");
            count_rows.push(counts(&date, 100_000, 0, 100_000, 200_000));
            breakdowns.push(breakdown(
                &date,
                "percent",
                vec![("gpt-5.6-luna", "standard", 100.0)],
            ));
        }
        let response = build_server_credit_analytics(
            count_rows,
            breakdowns,
            "2026-08-25",
            "2026-08-01",
            "2026-08-25",
        );
        assert!(response.last_7_complete_days.completeness.is_complete);
        assert!(response.previous_7_complete_days.completeness.is_complete);
        assert!(response.seven_day_delta_percent.is_some());
        assert_eq!(response.seven_day_series.len(), 7);
    }
}

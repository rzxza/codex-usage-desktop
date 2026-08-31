#![allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ModelRateEntry {
    pub model: &'static str,
    pub speed: &'static str,
    pub input_per_million_tokens: f64,
    pub cached_input_per_million_tokens: f64,
    pub output_per_million_tokens: f64,
    pub base_multiplier: f64,
}

/// Single rate profile used by WHAM normalization: it expresses how many
/// plan-included "credits equivalent" one token costs per model. It is NOT a
/// purchased-credit billing rate (promotional purchase pricing differs).
pub const RATE_PROFILE_ID: &str = "included_usage_equivalent_v1";
pub const RATE_PROFILE_PURPOSE: &str =
    "Included-plan usage normalization for WHAM reverse derivation; not purchased-credit billing.";

/// Luna is the base vector of the profile; every other entry is a multiple.
pub const BASE_INPUT_PER_MILLION: f64 = 5.0;
pub const BASE_CACHED_INPUT_PER_MILLION: f64 = 0.5;
pub const BASE_OUTPUT_PER_MILLION: f64 = 30.0;

pub const STANDARD_SPEED_MULTIPLIER: f64 = 1.0;
pub const FAST_SPEED_MULTIPLIER: f64 = 2.5;

pub const MODEL_RATE_TABLE: [ModelRateEntry; 4] = [
    ModelRateEntry {
        model: "gpt-5.6-sol",
        speed: "standard",
        input_per_million_tokens: 125.0,
        cached_input_per_million_tokens: 12.5,
        output_per_million_tokens: 750.0,
        base_multiplier: 25.0,
    },
    ModelRateEntry {
        model: "gpt-5.5",
        speed: "standard",
        input_per_million_tokens: 125.0,
        cached_input_per_million_tokens: 12.5,
        output_per_million_tokens: 750.0,
        base_multiplier: 25.0,
    },
    ModelRateEntry {
        model: "gpt-5.6-terra",
        speed: "standard",
        input_per_million_tokens: 50.0,
        cached_input_per_million_tokens: 5.0,
        output_per_million_tokens: 300.0,
        base_multiplier: 10.0,
    },
    ModelRateEntry {
        model: "gpt-5.6-luna",
        speed: "standard",
        input_per_million_tokens: 5.0,
        cached_input_per_million_tokens: 0.5,
        output_per_million_tokens: 30.0,
        base_multiplier: 1.0,
    },
];

pub const RATE_TABLE_SOURCE: &str =
    "OpenAI Codex rate card (https://help.openai.com/en/articles/20001106-codex-rate-card), included-usage column; GPT-5.5 standard uses the same rate vector as GPT-5.6 Sol";
pub const RATE_TABLE_UPDATED_AT: &str = "2026-08-26";

pub fn lookup_model_rate(model: &str) -> Option<&'static ModelRateEntry> {
    MODEL_RATE_TABLE.iter().find(|entry| entry.model == model)
}

pub fn is_standard_speed(speed: &str) -> bool {
    speed == "standard"
}

/// Returns the included-usage speed multiplier for an allowlisted model.
///
/// Only exact `standard` and `fast` are supported. `Standard`, `fast-preview`,
/// `turbo`, and any other casing/prefix/suffix are rejected (fail closed).
pub fn speed_multiplier(model: &str, speed: &str) -> Option<f64> {
    match speed {
        "standard" => Some(STANDARD_SPEED_MULTIPLIER),
        "fast" if is_supported_rate_model(model) => Some(FAST_SPEED_MULTIPLIER),
        _ => None,
    }
}

/// Combined base-model × speed multiplier used by WHAM normalization.
pub fn effective_multiplier(model: &str, speed: &str) -> Option<f64> {
    let base = lookup_model_rate(model)?.base_multiplier;
    let speed = speed_multiplier(model, speed)?;
    Some(base * speed)
}

pub fn is_supported_rate_model(model: &str) -> bool {
    lookup_model_rate(model).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_table_matches_v0_1_rate_card() {
        assert_eq!(
            RATE_TABLE_SOURCE,
            "OpenAI Codex rate card (https://help.openai.com/en/articles/20001106-codex-rate-card), included-usage column; GPT-5.5 standard uses the same rate vector as GPT-5.6 Sol"
        );
        assert_eq!(RATE_PROFILE_ID, "included_usage_equivalent_v1");
        assert!(RATE_PROFILE_PURPOSE.contains("not purchased-credit billing"));
        assert_eq!(RATE_TABLE_UPDATED_AT, "2026-08-26");
        assert_eq!(MODEL_RATE_TABLE.len(), 4);

        let sol = &MODEL_RATE_TABLE[0];
        assert_eq!(sol.model, "gpt-5.6-sol");
        assert_eq!(sol.speed, "standard");
        assert_eq!(sol.input_per_million_tokens, 125.0);
        assert_eq!(sol.cached_input_per_million_tokens, 12.5);
        assert_eq!(sol.output_per_million_tokens, 750.0);
        assert_eq!(sol.base_multiplier, 25.0);

        let gpt55 = &MODEL_RATE_TABLE[1];
        assert_eq!(gpt55.model, "gpt-5.5");
        assert_eq!(gpt55.speed, "standard");
        assert_eq!(gpt55.input_per_million_tokens, 125.0);
        assert_eq!(gpt55.cached_input_per_million_tokens, 12.5);
        assert_eq!(gpt55.output_per_million_tokens, 750.0);
        assert_eq!(gpt55.base_multiplier, 25.0);

        let terra = &MODEL_RATE_TABLE[2];
        assert_eq!(terra.model, "gpt-5.6-terra");
        assert_eq!(terra.speed, "standard");
        assert_eq!(terra.input_per_million_tokens, 50.0);
        assert_eq!(terra.cached_input_per_million_tokens, 5.0);
        assert_eq!(terra.output_per_million_tokens, 300.0);
        assert_eq!(terra.base_multiplier, 10.0);

        let luna = &MODEL_RATE_TABLE[3];
        assert_eq!(luna.model, "gpt-5.6-luna");
        assert_eq!(luna.speed, "standard");
        assert_eq!(luna.input_per_million_tokens, 5.0);
        assert_eq!(luna.cached_input_per_million_tokens, 0.5);
        assert_eq!(luna.output_per_million_tokens, 30.0);
        assert_eq!(luna.base_multiplier, 1.0);
    }

    #[test]
    fn rate_table_is_strictly_proportional() {
        let luna = &MODEL_RATE_TABLE[3];
        for entry in &MODEL_RATE_TABLE {
            let multiplier = entry.base_multiplier;
            assert_eq!(
                entry.input_per_million_tokens,
                luna.input_per_million_tokens * multiplier
            );
            assert_eq!(
                entry.cached_input_per_million_tokens,
                luna.cached_input_per_million_tokens * multiplier
            );
            assert_eq!(
                entry.output_per_million_tokens,
                luna.output_per_million_tokens * multiplier
            );
            let expected_multiplier = entry.input_per_million_tokens / luna.input_per_million_tokens;
            assert_eq!(entry.base_multiplier, expected_multiplier);
        }
    }

    #[test]
    fn table_contains_only_the_four_allowlisted_models() {
        let models: Vec<&str> = MODEL_RATE_TABLE.iter().map(|entry| entry.model).collect();
        assert_eq!(
            models,
            vec!["gpt-5.6-sol", "gpt-5.5", "gpt-5.6-terra", "gpt-5.6-luna"]
        );
        assert_eq!(models.len(), 4);
        for model in ["gpt-5.6-sol", "gpt-5.5", "gpt-5.6-terra", "gpt-5.6-luna"] {
            assert_eq!(
                MODEL_RATE_TABLE.iter().filter(|e| e.model == model).count(),
                1
            );
        }
    }

    #[test]
    fn unknown_models_are_never_resolved() {
        let unknown_models = [
            "",
            "gpt-5.6",
            "gpt-5.5-preview",
            "openai/gpt-5.6-sol",
            "GPT-5.6-SOL",
            "gpt-4.1",
            "gpt-5.6-sol-fast",
        ];
        for model in unknown_models {
            assert!(
                lookup_model_rate(model).is_none(),
                "unexpected rate for {model:?}"
            );
            assert!(
                !is_supported_rate_model(model),
                "unexpected support for {model:?}"
            );
        }
    }

    #[test]
    fn rate_table_has_unique_model_speed_ranges() {
        let mut seen = std::collections::BTreeSet::new();
        for entry in &MODEL_RATE_TABLE {
            assert!(
                seen.insert((entry.model, entry.speed)),
                "duplicate rate range for {} / {}",
                entry.model,
                entry.speed
            );
        }
        assert_eq!(seen.len(), MODEL_RATE_TABLE.len());
    }

    #[test]
    fn rate_multiplier_matches_rate_vectors() {
        let luna = &MODEL_RATE_TABLE[3];
        for entry in &MODEL_RATE_TABLE {
            let multiplier = entry.base_multiplier;
            let ratio = entry.input_per_million_tokens / luna.input_per_million_tokens;
            assert!(
                (ratio - multiplier).abs() < 1e-9,
                "{} input ratio {} does not match multiplier {}",
                entry.model,
                ratio,
                multiplier
            );
            let cached_ratio =
                entry.cached_input_per_million_tokens / luna.cached_input_per_million_tokens;
            assert!((cached_ratio - multiplier).abs() < 1e-9);
            let output_ratio = entry.output_per_million_tokens / luna.output_per_million_tokens;
            assert!((output_ratio - multiplier).abs() < 1e-9);
        }
    }

    #[test]
    fn unsupported_model_is_rejected() {
        assert!(lookup_model_rate("gpt-5.5-preview").is_none());
        assert!(!is_supported_rate_model("gpt-5.5-preview"));
        assert!(lookup_model_rate("").is_none());
        assert!(!is_supported_rate_model("gpt-5.6-sol-fast"));
    }

    #[test]
    fn standard_speed_is_exact() {
        assert!(is_standard_speed("standard"));
        assert!(!is_standard_speed("fast"));
        assert!(!is_standard_speed("Standard"));
        assert!(!is_standard_speed("standard "));
        assert!(!is_standard_speed(""));
    }

    #[test]
    fn unknown_or_fast_day_is_not_eligible() {
        // `is_standard_speed` intentionally stays exact: `fast` is not `standard`.
        assert!(!(is_supported_rate_model("gpt-5.6") && is_standard_speed("standard")));
        assert!(!(is_supported_rate_model("gpt-5.6-sol") && is_standard_speed("fast")));
        assert!(!(is_supported_rate_model("gpt-5.6-sol") && is_standard_speed("Standard")));
        assert!(!(is_supported_rate_model("gpt-5.6-sol") && is_standard_speed("standard ")));
        assert!(!(is_supported_rate_model("") && is_standard_speed("standard")));
        assert!(is_supported_rate_model("gpt-5.6-sol") && is_standard_speed("standard"));
        assert!(is_supported_rate_model("gpt-5.5") && is_standard_speed("standard"));
        assert!(is_supported_rate_model("gpt-5.6-terra") && is_standard_speed("standard"));
        assert!(is_supported_rate_model("gpt-5.6-luna") && is_standard_speed("standard"));
    }

    #[test]
    fn fast_multiplier_is_2_5x_standard() {
        assert_eq!(STANDARD_SPEED_MULTIPLIER, 1.0);
        assert_eq!(FAST_SPEED_MULTIPLIER, 2.5);
        for model in [
            "gpt-5.6-sol",
            "gpt-5.5",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
        ] {
            assert_eq!(speed_multiplier(model, "standard"), Some(1.0));
            assert_eq!(speed_multiplier(model, "fast"), Some(2.5));
        }
    }

    #[test]
    fn gpt56_sol_fast_supported() {
        assert_eq!(effective_multiplier("gpt-5.6-sol", "standard"), Some(25.0));
        assert_eq!(effective_multiplier("gpt-5.6-sol", "fast"), Some(62.5));
    }

    #[test]
    fn gpt56_terra_fast_supported() {
        assert_eq!(effective_multiplier("gpt-5.6-terra", "standard"), Some(10.0));
        assert_eq!(effective_multiplier("gpt-5.6-terra", "fast"), Some(25.0));
    }

    #[test]
    fn gpt56_luna_fast_supported() {
        assert_eq!(effective_multiplier("gpt-5.6-luna", "standard"), Some(1.0));
        assert_eq!(effective_multiplier("gpt-5.6-luna", "fast"), Some(2.5));
    }

    #[test]
    fn gpt55_fast_supported() {
        assert_eq!(effective_multiplier("gpt-5.5", "standard"), Some(25.0));
        assert_eq!(effective_multiplier("gpt-5.5", "fast"), Some(62.5));
    }

    #[test]
    fn unknown_speed_fails_closed() {
        for speed in [
            "Fast",
            "fast-preview",
            "turbo",
            "standard ",
            "Standard",
            "",
            "fast ",
        ] {
            assert!(
                effective_multiplier("gpt-5.6-sol", speed).is_none(),
                "unexpected effective multiplier for speed {speed:?}"
            );
            assert!(
                effective_multiplier("gpt-5.5", speed).is_none(),
                "unexpected effective multiplier for speed {speed:?}"
            );
        }
        // Unknown model cannot get a fast multiplier even with exact speed.
        assert!(effective_multiplier("gpt-5.6", "fast").is_none());
        assert!(effective_multiplier("gpt-5.5-preview", "fast").is_none());
    }
}

import type { CodexLimitWindow, CodexLimitsResponse } from "@/lib/api";

/**
 * Shared primary quota selection used by Compact and Tray.
 *
 * Long-term quota wins: weekly when present, otherwise session. We do not
 * infer the label from `windowMinutes` (e.g. 10080 != always "Weekly") so
 * PROLITE/FREE / monthly-style plans are not mislabeled.
 */
export function selectPrimaryQuota(
  limits: Pick<CodexLimitsResponse, "session" | "weekly"> | null,
): CodexLimitWindow | null {
  return limits?.weekly ?? limits?.session ?? null;
}

/** Short tray prefix for the primary quota. Deliberately not plan-specific. */
export function primaryQuotaTitlePrefix(): "Q" {
  return "Q";
}

/** Display label used by Compact and Tray for the primary quota. */
export function primaryQuotaLabel(
  t: (key: string, options?: any) => string,
): string {
  return t("compact.current_quota");
}
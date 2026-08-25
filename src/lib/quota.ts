import type { CodexLimitWindow, CodexLimitsResponse } from "@/lib/api";

/**
 * Shared primary quota selection used by Compact and Tray.
 * Picks the longest actual valid window returned by the server instead of
 * hardcoding a 5-hour/weekly plan assumption.
 */
export function selectPrimaryQuota(
  limits: Pick<CodexLimitsResponse, "session" | "weekly"> | null,
): CodexLimitWindow | null {
  const list = [limits?.session, limits?.weekly].filter(
    (window): window is CodexLimitWindow => !!window,
  );
  if (list.length === 0) return null;
  return list.reduce((a, b) =>
    (a.windowMinutes ?? 0) >= (b.windowMinutes ?? 0) ? a : b,
  );
}
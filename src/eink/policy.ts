import type { EinkSettings, EinkSnapshot } from "./types";
import { einkSnapshotHash } from "./snapshot";

export const EINK_DEFAULT_MIN_INTERVAL_MS = 10 * 60 * 1000;

export function shouldRefreshEink(
  previous: EinkSnapshot | null,
  next: EinkSnapshot,
  lastPushedAt: number | null,
  settings: EinkSettings,
  now = Date.now(),
): boolean {
  if (!settings.enabled) return false;
  if (lastPushedAt !== null && now - lastPushedAt < EINK_DEFAULT_MIN_INTERVAL_MS) {
    return false;
  }

  if (previous === null) return true;
  if (einkSnapshotHash(previous) === einkSnapshotHash(next)) return false;

  if (previous.resetSignalStatus !== next.resetSignalStatus) return true;
  if (previous.resetCardCount !== next.resetCardCount) return true;
  if (previous.latestCompleteDate !== next.latestCompleteDate) return true;
  if (previous.analyticsUpdatedAt !== next.analyticsUpdatedAt) return true;

  if (previous.quotaRemainingPercent !== null && next.quotaRemainingPercent !== null) {
    if (Math.abs(next.quotaRemainingPercent - previous.quotaRemainingPercent) >= 1) {
      return true;
    }
  }
  if (previous.sevenDayCredits !== next.sevenDayCredits) return true;
  if (previous.thirtyDayCredits !== next.thirtyDayCredits) return true;
  if (previous.sevenDayDeltaPercent !== next.sevenDayDeltaPercent) return true;

  return false;
}
import type { EinkSettings, EinkSnapshot } from "./types";
import { hashEinkPixels } from "./snapshot";
import { renderEinkMatrix } from "./renderer";

export const EINK_DEFAULT_MIN_INTERVAL_MS = 10 * 60 * 1000;

export function shouldRefreshEink(
  previous: EinkSnapshot | null,
  next: EinkSnapshot,
  lastPushedAt: number | null,
  settings: EinkSettings,
  now = Date.now(),
): boolean {
  if (!settings.enabled || !settings.autoPush) {
    return false;
  }

  const intervalMs = Math.max(
    10 * 60_000,
    (settings.refreshIntervalMinutes ?? 15) * 60_000,
  );
  if (lastPushedAt !== null && now - lastPushedAt < intervalMs) {
    return false;
  }

  if (previous === null) return true;

  // Deduplicate by rendered 400x300 pixel hash
  const prevMatrix = renderEinkMatrix(previous);
  const nextMatrix = renderEinkMatrix(next);
  if (hashEinkPixels(prevMatrix) === hashEinkPixels(nextMatrix)) {
    return false;
  }

  return true;
}

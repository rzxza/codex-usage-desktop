import type {
  CodexLimitsResponse,
  CodexResetSignalResponse,
  ServerCreditAnalyticsResponse,
} from "@/lib/api";
import type { EinkSnapshot } from "./types";

export function buildEinkSnapshot(
  limits: CodexLimitsResponse | null | undefined,
  analytics: ServerCreditAnalyticsResponse | null | undefined,
  resetSignal: CodexResetSignalResponse | null | undefined,
): EinkSnapshot {
  const quotaWindow = limits?.weekly ?? limits?.session ?? null;
  const last7 = analytics?.last7CompleteDays;
  const previous7 = analytics?.previous7CompleteDays;
  const last30 = analytics?.last30CompleteDays;

  const sevenDayCredits = last7?.credits ?? last7?.knownCredits ?? null;
  const thirtyDayCredits = last30?.credits ?? last30?.knownCredits ?? null;
  const sevenDayDeltaPercent =
    last7?.completeness.isComplete && previous7?.completeness.isComplete
      ? (analytics?.sevenDayDeltaPercent ?? null)
      : null;

  const sevenDaySeries = analytics?.sevenDaySeries ?? [];

  return {
    quotaRemainingPercent: quotaWindow?.remainingPercent ?? null,
    quotaResetAt: quotaWindow?.resetsAt ?? null,
    resetCardCount:
      limits?.resetCreditsAvailableCount ?? limits?.resetCredits?.length ?? 0,
    latestCompleteDate: analytics?.latestCompleteDate ?? null,
    latestCompleteCredits: analytics?.latestCompleteDay?.credits ?? null,
    sevenDayCredits,
    sevenDayCoverage: {
      completeDays: last7?.completeness.completeDays ?? 0,
      expectedDays: last7?.completeness.expectedDays ?? 7,
    },
    thirtyDayCredits,
    thirtyDayCoverage: {
      completeDays: last30?.completeness.completeDays ?? 0,
      expectedDays: last30?.completeness.expectedDays ?? 30,
    },
    sevenDayDeltaPercent,
    sevenDaySeries,
    resetSignalStatus: resetSignal?.status ?? null,
    resetSignalConfidence: resetSignal?.confidence ?? null,
    resetSignalEffectiveAt: resetSignal?.effectiveAt ?? null,
    analyticsUpdatedAt: analytics?.fetchedAt ?? null,
  };
}

export function hashEinkPixels(matrix: import("./types").EinkPixelMatrix): string {
  let hash = 0x811c9dc5;
  for (let y = 0; y < matrix.length; y += 1) {
    const row = matrix[y];
    for (let x = 0; x < row.length; x += 1) {
      hash ^= row[x];
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
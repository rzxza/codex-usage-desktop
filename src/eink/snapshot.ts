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
    resetSignalStatus: resetSignal?.status ?? null,
    resetSignalEffectiveAt: resetSignal?.effectiveAt ?? null,
    analyticsUpdatedAt: analytics?.fetchedAt ?? null,
  };
}

export function einkSnapshotHash(snapshot: EinkSnapshot): string {
  const normalized = {
    ...snapshot,
    quotaRemainingPercent: round(snapshot.quotaRemainingPercent),
    latestCompleteCredits: round(snapshot.latestCompleteCredits),
    sevenDayCredits: round(snapshot.sevenDayCredits),
    thirtyDayCredits: round(snapshot.thirtyDayCredits),
    sevenDayDeltaPercent: round(snapshot.sevenDayDeltaPercent),
  };
  return JSON.stringify(normalized);
}

function round(value: number | null): number | null {
  if (value === null || value === undefined) return null;
  return Math.round(value * 1000) / 1000;
}
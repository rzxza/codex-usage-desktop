import { getTargetKey } from "./settings";
import type {
  EinkPushResult,
  EinkSettings,
  EinkSnapshot,
  EinkSyncState,
  EinkSyncStatus,
  EinkTransportCapabilities,
} from "./types";

export type { EinkSyncState, EinkSyncStatus };

export const INITIAL_EINK_SYNC_STATE: EinkSyncState = {
  status: "idle",
  lastSuccessHash: null,
  lastSuccessAt: null,
  lastSuccessTargetKey: null,
  lastAttemptAt: null,
  lastError: null,
  pendingHash: null,
  pendingTargetKey: null,
  nextPushAt: null,
  consecutiveFailures: 0,
};

export function createInitialEinkSyncState(
  baseline?: import("./types").EinkSyncBaseline | null,
): EinkSyncState {
  return {
    ...INITIAL_EINK_SYNC_STATE,
    lastSuccessHash: baseline?.lastSuccessHash ?? null,
    lastSuccessAt: baseline?.lastSuccessAt ?? null,
    lastSuccessTargetKey: baseline?.lastSuccessTargetKey ?? null,
  };
}

export function isSnapshotPushable(snapshot: EinkSnapshot | null | undefined): boolean {
  if (!snapshot) return false;
  return (
    (typeof snapshot.quotaRemainingPercent === "number" && Number.isFinite(snapshot.quotaRemainingPercent)) ||
    (typeof snapshot.latestCompleteCredits === "number" && Number.isFinite(snapshot.latestCompleteCredits)) ||
    (typeof snapshot.sevenDayCredits === "number" && Number.isFinite(snapshot.sevenDayCredits)) ||
    (typeof snapshot.thirtyDayCredits === "number" && Number.isFinite(snapshot.thirtyDayCredits))
  );
}

export function getEinkRetryDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 1) return 1 * 60_000;
  if (consecutiveFailures === 2) return 5 * 60_000;
  if (consecutiveFailures === 3) return 15 * 60_000;
  return 30 * 60_000;
}

export type AutoSyncDecisionInput = {
  snapshot: EinkSnapshot | null;
  pixelsHash: string | null;
  settings: EinkSettings;
  capabilities: EinkTransportCapabilities;
  state: EinkSyncState;
  now: number;
};

export type AutoSyncDecision = {
  action: "none" | "push" | "schedule_due" | "block";
  nextState: EinkSyncState;
  delayMs?: number;
};

export function evaluateAutoSyncDecision(input: AutoSyncDecisionInput): AutoSyncDecision {
  const { snapshot, pixelsHash, settings, capabilities, state, now } = input;

  if (!settings.enabled || !settings.autoPush) {
    return {
      action: "none",
      nextState: {
        ...state,
        status: "disabled",
        pendingHash: null,
        pendingTargetKey: null,
        nextPushAt: null,
      },
    };
  }

  if (!capabilities.supportsAutoPush) {
    return {
      action: "block",
      nextState: {
        ...state,
        status: "blocked",
        lastError: "Selected transport does not support automated push.",
        pendingHash: null,
        pendingTargetKey: null,
        nextPushAt: null,
      },
    };
  }

  if (!isSnapshotPushable(snapshot) || !pixelsHash) {
    return {
      action: "none",
      nextState: {
        ...state,
        status: state.status === "uploading" ? "uploading" : state.consecutiveFailures > 0 ? "retry_wait" : "idle",
      },
    };
  }

  const currentTargetKey = getTargetKey(settings.transportKind, settings.deviceId);
  const isTargetChanged = currentTargetKey !== state.lastSuccessTargetKey;
  const isContentChanged = pixelsHash !== state.lastSuccessHash;
  const isDifferentFromSuccess = isContentChanged || isTargetChanged;

  if (!isDifferentFromSuccess && state.consecutiveFailures === 0) {
    return {
      action: "none",
      nextState: {
        ...state,
        status: "idle",
        pendingHash: null,
        pendingTargetKey: null,
        nextPushAt: null,
        lastError: null,
      },
    };
  }

  const intervalMs = Math.max(10, settings.refreshIntervalMinutes) * 60_000;
  const minNextAllowedAt =
    state.lastSuccessAt === null || isTargetChanged
      ? 0
      : state.lastSuccessAt + intervalMs;

  const retryDelay = state.consecutiveFailures > 0 ? getEinkRetryDelayMs(state.consecutiveFailures) : 0;
  const minRetryAllowedAt = state.lastAttemptAt !== null ? state.lastAttemptAt + retryDelay : 0;

  const earliestAllowedAt = Math.max(minNextAllowedAt, minRetryAllowedAt);

  if (now >= earliestAllowedAt) {
    return {
      action: "push",
      nextState: {
        ...state,
        status: "uploading",
        lastAttemptAt: now,
        pendingHash: null,
        pendingTargetKey: null,
        nextPushAt: null,
      },
    };
  }

  const delayMs = earliestAllowedAt - now;
  return {
    action: "schedule_due",
    delayMs,
    nextState: {
      ...state,
      status: state.consecutiveFailures > 0 ? "retry_wait" : "pending",
      pendingHash: pixelsHash,
      pendingTargetKey: currentTargetKey,
      nextPushAt: earliestAllowedAt,
    },
  };
}

export function handlePushOutcome(
  state: EinkSyncState,
  outcome: { success: boolean; hash: string; targetKey: string; result?: EinkPushResult; error?: string },
  now: number,
): EinkSyncState {
  if (outcome.success) {
    return {
      ...state,
      status: "success",
      lastSuccessHash: outcome.hash,
      lastSuccessAt: now,
      lastSuccessTargetKey: outcome.targetKey,
      lastAttemptAt: now,
      lastError: null,
      pendingHash: null,
      pendingTargetKey: null,
      nextPushAt: null,
      consecutiveFailures: 0,
    };
  }

  const nextFailures = state.consecutiveFailures + 1;
  const retryDelay = getEinkRetryDelayMs(nextFailures);
  return {
    ...state,
    status: "retry_wait",
    lastAttemptAt: now,
    lastError: outcome.error ?? "E-Ink push failed",
    pendingHash: outcome.hash,
    pendingTargetKey: outcome.targetKey,
    nextPushAt: now + retryDelay,
    consecutiveFailures: nextFailures,
  };
}

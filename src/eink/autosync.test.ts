import { describe, expect, it } from "vitest";
import {
  INITIAL_EINK_SYNC_STATE,
  evaluateAutoSyncDecision,
  getEinkRetryDelayMs,
  handlePushOutcome,
  isSnapshotPushable,
  type EinkSyncState,
} from "./autosync";
import type { EinkSettings, EinkSnapshot, EinkTransportCapabilities } from "./types";

const mockCapabilities: EinkTransportCapabilities = {
  supportsAutoPush: true,
  supportsDeviceDiscovery: true,
  confirmsDeviceRefresh: true,
};

const defaultSettings: EinkSettings = {
  enabled: true,
  autoPush: true,
  refreshIntervalMinutes: 15,
  transportKind: "file",
  deviceId: null,
};

const validSnapshot: EinkSnapshot = {
  quotaRemainingPercent: 80,
  quotaResetAt: "2026-09-01T12:00:00Z",
  resetCardCount: 1,
  latestCompleteDate: "2026-08-31",
  latestCompleteCredits: 6738,
  sevenDayCredits: 20700,
  sevenDayCoverage: { completeDays: 7, expectedDays: 7 },
  thirtyDayCredits: 94900,
  thirtyDayCoverage: { completeDays: 30, expectedDays: 30 },
  sevenDayDeltaPercent: 35.0,
  sevenDaySeries: [],
  resetSignalStatus: "scheduled",
  resetSignalConfidence: 0.95,
  resetSignalEffectiveAt: "2026-09-01T14:30:00Z",
  analyticsUpdatedAt: "2026-08-31T10:00:00Z",
};

describe("Pure AutoSync Engine (P2)", () => {
  it("disabled settings returns action none and status disabled", () => {
    const decision = evaluateAutoSyncDecision({
      snapshot: validSnapshot,
      pixelsHash: "hash-1",
      settings: { ...defaultSettings, autoPush: false },
      capabilities: mockCapabilities,
      state: INITIAL_EINK_SYNC_STATE,
      now: 100000,
    });
    expect(decision.action).toBe("none");
    expect(decision.nextState.status).toBe("disabled");
  });

  it("unsupported transport autoPush blocks sync with error", () => {
    const decision = evaluateAutoSyncDecision({
      snapshot: validSnapshot,
      pixelsHash: "hash-1",
      settings: defaultSettings,
      capabilities: { ...mockCapabilities, supportsAutoPush: false },
      state: INITIAL_EINK_SYNC_STATE,
      now: 100000,
    });
    expect(decision.action).toBe("block");
    expect(decision.nextState.status).toBe("blocked");
    expect(decision.nextState.lastError).toMatch(/does not support/i);
  });

  it("unpushable blank snapshot stays idle", () => {
    const blankSnapshot: EinkSnapshot = {
      ...validSnapshot,
      quotaRemainingPercent: null,
      latestCompleteCredits: null,
      sevenDayCredits: null,
      thirtyDayCredits: null,
    };
    expect(isSnapshotPushable(blankSnapshot)).toBe(false);

    const decision = evaluateAutoSyncDecision({
      snapshot: blankSnapshot,
      pixelsHash: "hash-blank",
      settings: defaultSettings,
      capabilities: mockCapabilities,
      state: INITIAL_EINK_SYNC_STATE,
      now: 100000,
    });
    expect(decision.action).toBe("none");
    expect(decision.nextState.status).toBe("idle");
  });

  it("first valid snapshot pushes immediately", () => {
    const decision = evaluateAutoSyncDecision({
      snapshot: validSnapshot,
      pixelsHash: "hash-1",
      settings: defaultSettings,
      capabilities: mockCapabilities,
      state: INITIAL_EINK_SYNC_STATE,
      now: 100000,
    });
    expect(decision.action).toBe("push");
    expect(decision.nextState.status).toBe("uploading");
    expect(decision.nextState.lastAttemptAt).toBe(100000);
  });

  it("identical hash and targetKey does not re-push (stays idle)", () => {
    const state: EinkSyncState = {
      ...INITIAL_EINK_SYNC_STATE,
      status: "idle",
      lastSuccessHash: "hash-1",
      lastSuccessAt: 100000,
      lastSuccessTargetKey: "file:default",
    };

    const decision = evaluateAutoSyncDecision({
      snapshot: validSnapshot,
      pixelsHash: "hash-1",
      settings: defaultSettings,
      capabilities: mockCapabilities,
      state,
      now: 100000 + 30 * 60_000, // even after 30 min, same hash -> idle
    });
    expect(decision.action).toBe("none");
    expect(decision.nextState.status).toBe("idle");
  });

  it("different hash within interval schedules due", () => {
    const state: EinkSyncState = {
      ...INITIAL_EINK_SYNC_STATE,
      status: "idle",
      lastSuccessHash: "hash-1",
      lastSuccessAt: 100000,
      lastSuccessTargetKey: "file:default",
    };

    const now = 100000 + 5 * 60_000; // 5 min later (interval is 15 min)
    const decision = evaluateAutoSyncDecision({
      snapshot: validSnapshot,
      pixelsHash: "hash-2",
      settings: defaultSettings,
      capabilities: mockCapabilities,
      state,
      now,
    });

    expect(decision.action).toBe("schedule_due");
    expect(decision.nextState.status).toBe("pending");
    expect(decision.nextState.pendingHash).toBe("hash-2");
    expect(decision.nextState.nextPushAt).toBe(100000 + 15 * 60_000);
    expect(decision.delayMs).toBe(10 * 60_000);
  });

  it("multiple hash updates within interval coalesce to latest pendingHash", () => {
    let state: EinkSyncState = {
      ...INITIAL_EINK_SYNC_STATE,
      status: "pending",
      lastSuccessHash: "hash-1",
      lastSuccessAt: 100000,
      lastSuccessTargetKey: "file:default",
      pendingHash: "hash-2",
      nextPushAt: 100000 + 15 * 60_000,
    };

    const now = 100000 + 10 * 60_000;
    const decision = evaluateAutoSyncDecision({
      snapshot: validSnapshot,
      pixelsHash: "hash-3",
      settings: defaultSettings,
      capabilities: mockCapabilities,
      state,
      now,
    });

    expect(decision.action).toBe("schedule_due");
    expect(decision.nextState.pendingHash).toBe("hash-3");
    expect(decision.nextState.nextPushAt).toBe(100000 + 15 * 60_000);
  });

  it("interval elapsed triggers push of latest pendingHash", () => {
    const state: EinkSyncState = {
      ...INITIAL_EINK_SYNC_STATE,
      status: "pending",
      lastSuccessHash: "hash-1",
      lastSuccessAt: 100000,
      lastSuccessTargetKey: "file:default",
      pendingHash: "hash-3",
      nextPushAt: 100000 + 15 * 60_000,
    };

    const now = 100000 + 15 * 60_000;
    const decision = evaluateAutoSyncDecision({
      snapshot: validSnapshot,
      pixelsHash: "hash-3",
      settings: defaultSettings,
      capabilities: mockCapabilities,
      state,
      now,
    });

    expect(decision.action).toBe("push");
    expect(decision.nextState.status).toBe("uploading");
    expect(decision.nextState.lastAttemptAt).toBe(now);
  });

  it("successful push updates lastSuccessHash, lastSuccessAt, and clears pending", () => {
    const state: EinkSyncState = {
      ...INITIAL_EINK_SYNC_STATE,
      status: "uploading",
      pendingHash: "hash-3",
      consecutiveFailures: 2,
    };

    const nextState = handlePushOutcome(
      state,
      {
        success: true,
        hash: "hash-3",
        targetKey: "file:default",
        result: { disposition: "written", detail: "/path/latest.png" },
      },
      200000,
    );

    expect(nextState.status).toBe("success");
    expect(nextState.lastSuccessHash).toBe("hash-3");
    expect(nextState.lastSuccessAt).toBe(200000);
    expect(nextState.lastSuccessTargetKey).toBe("file:default");
    expect(nextState.consecutiveFailures).toBe(0);
    expect(nextState.pendingHash).toBeNull();
  });

  it("failed push increments failures and schedules retry in 1m", () => {
    const state: EinkSyncState = {
      ...INITIAL_EINK_SYNC_STATE,
      status: "uploading",
      consecutiveFailures: 0,
    };

    const nextState = handlePushOutcome(
      state,
      {
        success: false,
        hash: "hash-3",
        targetKey: "file:default",
        error: "Disk error",
      },
      200000,
    );

    expect(nextState.status).toBe("retry_wait");
    expect(nextState.consecutiveFailures).toBe(1);
    expect(nextState.lastError).toBe("Disk error");
    expect(nextState.nextPushAt).toBe(200000 + 1 * 60_000);
    expect(getEinkRetryDelayMs(1)).toBe(60_000);
  });

  it("second failure schedules retry in 5m", () => {
    const state: EinkSyncState = {
      ...INITIAL_EINK_SYNC_STATE,
      status: "uploading",
      consecutiveFailures: 1,
    };

    const nextState = handlePushOutcome(
      state,
      {
        success: false,
        hash: "hash-3",
        targetKey: "file:default",
      },
      200000,
    );

    expect(nextState.consecutiveFailures).toBe(2);
    expect(nextState.nextPushAt).toBe(200000 + 5 * 60_000);
    expect(getEinkRetryDelayMs(2)).toBe(5 * 60_000);
  });

  it("third failure schedules retry in 15m", () => {
    expect(getEinkRetryDelayMs(3)).toBe(15 * 60_000);
  });

  it("fourth failure schedules retry in 30m", () => {
    expect(getEinkRetryDelayMs(4)).toBe(30 * 60_000);
    expect(getEinkRetryDelayMs(10)).toBe(30 * 60_000);
  });

  it("target key change (different device/sink) forces immediate push", () => {
    const state: EinkSyncState = {
      ...INITIAL_EINK_SYNC_STATE,
      status: "idle",
      lastSuccessHash: "hash-1",
      lastSuccessAt: 100000,
      lastSuccessTargetKey: "file:default",
    };

    // Same hash, but transport changed to seller device
    const now = 100000 + 1000;
    const decision = evaluateAutoSyncDecision({
      snapshot: validSnapshot,
      pixelsHash: "hash-1",
      settings: { ...defaultSettings, transportKind: "seller", deviceId: "nrf-7ef30d" },
      capabilities: mockCapabilities,
      state,
      now,
    });

    expect(decision.action).toBe("push");
    expect(decision.nextState.status).toBe("uploading");
  });
});

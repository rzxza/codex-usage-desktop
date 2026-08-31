import { describe, expect, it } from "vitest";
import { buildEinkSnapshot, einkSnapshotHash } from "./snapshot";
import { EINK_HEIGHT, EINK_WIDTH, matrixHasColor, renderSkeleton } from "./renderer";
import { EINK_DEFAULT_MIN_INTERVAL_MS, shouldRefreshEink } from "./policy";
import { ManualExportTransport, MockEinkTransport } from "./transport";
import type { EinkSnapshot } from "./types";

function sampleSnapshot(overrides: Partial<EinkSnapshot> = {}): EinkSnapshot {
  return {
    quotaRemainingPercent: 90,
    quotaResetAt: "2026-08-30T14:30:00Z",
    resetCardCount: 1,
    latestCompleteDate: "2026-08-29",
    latestCompleteCredits: 6738,
    sevenDayCredits: 20700,
    sevenDayCoverage: { completeDays: 7, expectedDays: 7 },
    thirtyDayCredits: 94900,
    thirtyDayCoverage: { completeDays: 30, expectedDays: 30 },
    sevenDayDeltaPercent: 35,
    resetSignalStatus: "scheduled",
    resetSignalEffectiveAt: "2026-08-30T14:30:00Z",
    analyticsUpdatedAt: "2026-08-30T10:00:00Z",
    ...overrides,
  };
}

describe("eink snapshot", () => {
  it("maps existing dashboard data into an E-Ink snapshot", () => {
    const limits = {
      session: null,
      weekly: { usedPercent: 10, remainingPercent: 90, windowMinutes: 10080, resetsAt: "2026-08-30T14:30:00Z" },
      resetCreditsAvailableCount: 1,
      resetCredits: [],
      updatedAt: "2026-08-30T10:00:00Z",
      source: "oauth",
    } as any;
    const analytics = {
      fetchedAt: "2026-08-30T10:00:00Z",
      latestCompleteDate: "2026-08-29",
      latestCompleteDay: { date: "2026-08-29", credits: 6738, isPartial: false, isPending: false, models: [] },
      last7CompleteDays: {
        credits: 20700,
        knownCredits: 20700,
        completeness: { completeDays: 7, expectedDays: 7, isComplete: true },
      },
      previous7CompleteDays: {
        credits: 15300,
        completeness: { completeDays: 7, expectedDays: 7, isComplete: true },
      },
      last30CompleteDays: {
        credits: 94900,
        knownCredits: 94900,
        completeness: { completeDays: 30, expectedDays: 30, isComplete: true },
      },
      sevenDayDeltaPercent: 35,
    } as any;
    const resetSignal = {
      status: "scheduled",
      effectiveAt: "2026-08-30T14:30:00Z",
    } as any;

    const snapshot = buildEinkSnapshot(limits, analytics, resetSignal);
    expect(snapshot.quotaRemainingPercent).toBe(90);
    expect(snapshot.resetCardCount).toBe(1);
    expect(snapshot.latestCompleteDate).toBe("2026-08-29");
    expect(snapshot.sevenDayCredits).toBe(20700);
    expect(snapshot.thirtyDayCredits).toBe(94900);
    expect(snapshot.sevenDayDeltaPercent).toBe(35);
    expect(snapshot.resetSignalStatus).toBe("scheduled");
  });

  it("uses known credits when a window is partial", () => {
    const analytics = {
      last7CompleteDays: {
        credits: null,
        knownCredits: 12345,
        completeness: { completeDays: 4, expectedDays: 7, isComplete: false },
      },
      previous7CompleteDays: { completeness: { completeDays: 7, expectedDays: 7, isComplete: true } },
      last30CompleteDays: { credits: null, knownCredits: null, completeness: { completeDays: 0, expectedDays: 30, isComplete: false } },
    } as any;
    const snapshot = buildEinkSnapshot(null, analytics, null);
    expect(snapshot.sevenDayCredits).toBe(12345);
    expect(snapshot.sevenDayCoverage.completeDays).toBe(4);
  });

  it("hides delta when either 7-day window is incomplete", () => {
    const analytics = {
      last7CompleteDays: { completeness: { completeDays: 6, expectedDays: 7, isComplete: false } },
      previous7CompleteDays: { completeness: { completeDays: 7, expectedDays: 7, isComplete: true } },
      sevenDayDeltaPercent: 35,
    } as any;
    const snapshot = buildEinkSnapshot(null, analytics, null);
    expect(snapshot.sevenDayDeltaPercent).toBeNull();
  });
});

describe("eink renderer", () => {
  it("renders exactly 400x300", () => {
    const matrix = renderSkeleton(sampleSnapshot());
    expect(matrix.length).toBe(EINK_HEIGHT);
    expect(matrix.every((row) => row.length === EINK_WIDTH)).toBe(true);
  });

  it("uses only black, white, and red pixels", () => {
    const matrix = renderSkeleton(sampleSnapshot());
    const allowed = new Set([0, 1, 2]);
    for (const row of matrix) {
      for (const pixel of row) {
        expect(allowed.has(pixel)).toBe(true);
      }
    }
  });

  it("uses red for low quota", () => {
    const matrix = renderSkeleton(sampleSnapshot({ quotaRemainingPercent: 10 }));
    expect(matrixHasColor(matrix, 2)).toBe(true);
  });
});

describe("eink refresh policy", () => {
  const settings = { enabled: true, autoPush: true, refreshIntervalMinutes: 15, deviceId: null };

  it("deduplicates identical image hashes", () => {
    const a = sampleSnapshot();
    const b = sampleSnapshot();
    expect(einkSnapshotHash(a)).toBe(einkSnapshotHash(b));
    expect(einkSnapshotHash({ ...a, quotaRemainingPercent: 91 })).not.toBe(einkSnapshotHash(a));
  });

  it("respects minimum refresh interval", () => {
    const now = Date.now();
    const previous = sampleSnapshot();
    const next = sampleSnapshot({ quotaRemainingPercent: 91 });
    expect(
      shouldRefreshEink(previous, next, now - EINK_DEFAULT_MIN_INTERVAL_MS + 1000, settings, now),
    ).toBe(false);
    expect(
      shouldRefreshEink(previous, next, now - EINK_DEFAULT_MIN_INTERVAL_MS - 1000, settings, now),
    ).toBe(true);
  });

  it("triggers refresh on reset signal status change", () => {
    const previous = sampleSnapshot();
    const next = sampleSnapshot({ resetSignalStatus: "completed" });
    expect(shouldRefreshEink(previous, next, null, settings)).toBe(true);
  });
});

describe("eink transport", () => {
  it("mock transport uploads successfully", async () => {
    const transport = new MockEinkTransport();
    const bytes = new Uint8Array([1, 2, 3]);
    await transport.uploadImage("mock-4p2", bytes);
    expect(transport.uploaded).toHaveLength(1);
    expect(transport.uploaded[0].bytes).toBe(bytes);
  });

  it("mock transport failure is isolated and does not affect dashboard state", async () => {
    const transport = new MockEinkTransport();
    transport.failNextUpload = true;
    await expect(transport.uploadImage("mock-4p2", new Uint8Array([1]))).rejects.toThrow("Mock upload failed");
    expect(transport.uploaded).toHaveLength(0);
  });

  it("manual transport discovers manual export device", async () => {
    const transport = new ManualExportTransport();
    const devices = await transport.discover();
    expect(devices[0].id).toBe("manual-export");
  });
});
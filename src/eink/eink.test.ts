// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildEinkSnapshot, hashEinkPixels } from "./snapshot";
import {
  EINK_HEIGHT,
  EINK_WIDTH,
  matrixHasColor,
  quantizeImageData,
  renderEinkMatrix,
  renderSkeleton,
} from "./renderer";
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
    sevenDaySeries: [
      { date: "2026-08-23", credits: 3000 },
      { date: "2026-08-24", credits: 3200 },
      { date: "2026-08-25", credits: null },
      { date: "2026-08-26", credits: 2800 },
      { date: "2026-08-27", credits: 3100 },
      { date: "2026-08-28", credits: 3000 },
      { date: "2026-08-29", credits: 3500 },
    ],
    resetSignalStatus: "scheduled",
    resetSignalConfidence: 0.92,
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
      sevenDaySeries: [
        { date: "2026-08-23", credits: 3000 },
        { date: "2026-08-24", credits: null },
      ],
    } as any;
    const resetSignal = {
      status: "scheduled",
      confidence: 0.92,
      effectiveAt: "2026-08-30T14:30:00Z",
    } as any;

    const snapshot = buildEinkSnapshot(limits, analytics, resetSignal);
    expect(snapshot.quotaRemainingPercent).toBe(90);
    expect(snapshot.resetCardCount).toBe(1);
    expect(snapshot.latestCompleteDate).toBe("2026-08-29");
    expect(snapshot.sevenDayCredits).toBe(20700);
    expect(snapshot.thirtyDayCredits).toBe(94900);
    expect(snapshot.sevenDayDeltaPercent).toBe(35);
    expect(snapshot.sevenDaySeries).toHaveLength(2);
    expect(snapshot.resetSignalStatus).toBe("scheduled");
    expect(snapshot.resetSignalConfidence).toBe(0.92);
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

describe("eink renderer and palette", () => {
  it("renders exactly 400x300", () => {
    const matrix = renderEinkMatrix(sampleSnapshot());
    expect(matrix.length).toBe(EINK_HEIGHT);
    expect(matrix.every((row) => row.length === EINK_WIDTH)).toBe(true);
  });

  it("uses only black, white, and red pixels", () => {
    const matrix = renderEinkMatrix(sampleSnapshot());
    const allowed = new Set([0, 1, 2]);
    for (const row of matrix) {
      for (const pixel of row) {
        expect(allowed.has(pixel)).toBe(true);
      }
    }
  });

  it("uses red for low quota", () => {
    const matrix = renderEinkMatrix(sampleSnapshot({ quotaRemainingPercent: 10 }));
    expect(matrixHasColor(matrix, 2)).toBe(true);
  });

  it("uses red for incomplete window coverage warning", () => {
    const matrix = renderEinkMatrix(
      sampleSnapshot({
        sevenDayCoverage: { completeDays: 5, expectedDays: 7 },
      }),
    );
    expect(matrixHasColor(matrix, 2)).toBe(true);
  });

  it("quantizes arbitrary image buffer into strictly 3-color palette", () => {
    const width = 400;
    const height = 300;
    const data = new Uint8ClampedArray(width * height * 4);
    // Fill top-left with red, top-right with dark (black), bottom with bright (white)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = (y * width + x) * 4;
        if (x < 100 && y < 100) {
          // Dominant red
          data[idx] = 240;
          data[idx + 1] = 20;
          data[idx + 2] = 20;
        } else if (x >= 200 && y < 100) {
          // Dark gray / black
          data[idx] = 30;
          data[idx + 1] = 30;
          data[idx + 2] = 30;
        } else {
          // Light gray / white
          data[idx] = 240;
          data[idx + 1] = 240;
          data[idx + 2] = 240;
        }
        data[idx + 3] = 255;
      }
    }

    const matrix = quantizeImageData({ data, width, height } as any);
    expect(matrix.length).toBe(300);
    expect(matrix[0].length).toBe(400);
    expect(matrix[50][50]).toBe(2); // Red
    expect(matrix[50][250]).toBe(1); // Black
    expect(matrix[200][200]).toBe(0); // White
  });
});

describe("eink refresh policy and pixel deduplication", () => {
  const activeSettings = { enabled: true, autoPush: true, refreshIntervalMinutes: 15, deviceId: null };

  it("deduplicates by rendered pixel matrix hash", () => {
    const a = sampleSnapshot();
    // Metadata timestamp change alone does not alter rendered pixels
    const b = sampleSnapshot({ analyticsUpdatedAt: "2026-08-30T12:00:00Z" });
    const matrixA = renderEinkMatrix(a);
    const matrixB = renderEinkMatrix(b);
    expect(hashEinkPixels(matrixA)).toBe(hashEinkPixels(matrixB));

    // Visible quota change alters pixels and hash
    const c = sampleSnapshot({ quotaRemainingPercent: 40 });
    const matrixC = renderEinkMatrix(c);
    expect(hashEinkPixels(matrixC)).not.toBe(hashEinkPixels(matrixA));
  });

  it("changes final pixel hash when 7D credits text changes", () => {
    const a = sampleSnapshot({ sevenDayCredits: 20700 });
    const b = sampleSnapshot({ sevenDayCredits: 25400 });
    expect(hashEinkPixels(renderEinkMatrix(a))).not.toBe(hashEinkPixels(renderEinkMatrix(b)));
  });

  it("changes final pixel hash when latestCompleteCredits changes", () => {
    const a = sampleSnapshot({ latestCompleteCredits: 6738 });
    const b = sampleSnapshot({ latestCompleteCredits: 8100 });
    expect(hashEinkPixels(renderEinkMatrix(a))).not.toBe(hashEinkPixels(renderEinkMatrix(b)));
  });

  it("changes final pixel hash when resetCardCount changes", () => {
    const a = sampleSnapshot({ resetCardCount: 1 });
    const b = sampleSnapshot({ resetCardCount: 2 });
    expect(hashEinkPixels(renderEinkMatrix(a))).not.toBe(hashEinkPixels(renderEinkMatrix(b)));
  });

  it("changes final pixel hash when reset confidence changes on likely status", () => {
    const a = sampleSnapshot({ resetSignalStatus: "likely", resetSignalConfidence: 0.83 });
    const b = sampleSnapshot({ resetSignalStatus: "likely", resetSignalConfidence: 0.95 });
    expect(hashEinkPixels(renderEinkMatrix(a))).not.toBe(hashEinkPixels(renderEinkMatrix(b)));
  });

  it("keeps final pixel hash unchanged when purely non-visible metadata changes", () => {
    // status=scheduled does NOT render confidence, so changing confidence is a
    // non-visible metadata change and must not alter the final pixel hash.
    // Note: jsdom has no real Canvas 2D context, so this test exercises the
    // deterministic fallback matrix. Real Canvas/font rasterization is verified
    // by Windows native/manual validation.
    const a = sampleSnapshot({ resetSignalStatus: "scheduled", resetSignalConfidence: 0.92 });
    const b = sampleSnapshot({ resetSignalStatus: "scheduled", resetSignalConfidence: 0.88 });
    expect(hashEinkPixels(renderEinkMatrix(a))).toBe(hashEinkPixels(renderEinkMatrix(b)));
  });

  it("respects minimum refresh interval", () => {
    const now = Date.now();
    const previous = sampleSnapshot();
    const next = sampleSnapshot({ quotaRemainingPercent: 40 });
    const intervalMs = Math.max(10 * 60_000, activeSettings.refreshIntervalMinutes * 60_000);
    expect(
      shouldRefreshEink(previous, next, now - intervalMs + 1000, activeSettings, now),
    ).toBe(false);
    expect(
      shouldRefreshEink(previous, next, now - intervalMs - 1000, activeSettings, now),
    ).toBe(true);
  });

  it("does not refresh when auto push is disabled", () => {
    const disabledSettings = { enabled: true, autoPush: false, refreshIntervalMinutes: 15, deviceId: null };
    const previous = sampleSnapshot();
    const next = sampleSnapshot({ quotaRemainingPercent: 40 });
    expect(shouldRefreshEink(previous, next, null, disabledSettings)).toBe(false);
  });

  it("triggers refresh on reset signal change when pixel output changes", () => {
    const previous = sampleSnapshot();
    const next = sampleSnapshot({ resetSignalStatus: "completed" });
    expect(shouldRefreshEink(previous, next, null, activeSettings)).toBe(true);
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

  it("handles telemetry in snapshot mapping", () => {
    const snapshot = buildEinkSnapshot(null, null, null, { batteryPercent: 82, temperatureC: 27 });
    expect(snapshot.batteryPercent).toBe(82);
    expect(snapshot.temperatureC).toBe(27);
  });

  it("handles empty telemetry without fabricating fake defaults", () => {
    const snapshot = buildEinkSnapshot(null, null, null);
    expect(snapshot.batteryPercent).toBeNull();
    expect(snapshot.temperatureC).toBeNull();
  });

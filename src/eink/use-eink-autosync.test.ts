// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useEinkAutoSync } from "./use-eink-autosync";
import { saveEinkSettings, saveEinkSyncBaseline } from "./settings";
import type { CodexLimitsResponse, ServerCreditAnalyticsResponse } from "@/lib/api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockImplementation(async (cmd: string) => {
    if (cmd === "eink_write_latest_png") {
      return "C:\Users\test\AppData\Roaming\com.codex.usage\eink\latest.png";
    }
    if (cmd === "eink_get_file_sink_path") {
      return "C:\Users\test\AppData\Roaming\com.codex.usage\eink\latest.png";
    }
    throw new Error(`Unhandled invoke: ${cmd}`);
  }),
}));

function sampleLimits(): CodexLimitsResponse {
  return {
    weekly: {
      usedPercent: 20,
      remainingPercent: 80,
      windowMinutes: 10080,
      resetsAt: "2026-09-07T00:00:00Z",
    },
    session: null,
    resetCreditsAvailableCount: 1,
    resetCredits: [],
    updatedAt: "2026-09-01T12:00:00Z",
    source: "oauth",
  };
}

function sampleAnalytics(): ServerCreditAnalyticsResponse {
  return {
    fetchedAt: "2026-09-01T12:00:00Z",
    startDate: "2026-08-01",
    endDate: "2026-09-01",
    status: "ready",
    calibration: { status: "good", sampleCount: 7, k: 25.0, deviation: 0, maxDeviation: 0 },
    latestCompleteDate: "2026-08-31",
    latestCompleteDay: { date: "2026-08-31", credits: 4032, models: [], isPartial: false, isPending: false },
    last7CompleteDays: {
      startDate: "2026-08-25",
      endDate: "2026-08-31",
      credits: 35642,
      knownCredits: 35642,
      models: [],
      completeness: { expectedDays: 7, completeDays: 7, missingDates: [], incompleteDays: [], isComplete: true },
    },
    previous7CompleteDays: {
      startDate: "2026-08-18",
      endDate: "2026-08-24",
      credits: 20800,
      knownCredits: 20800,
      models: [],
      completeness: { expectedDays: 7, completeDays: 7, missingDates: [], incompleteDays: [], isComplete: true },
    },
    last30CompleteDays: {
      startDate: "2026-08-02",
      endDate: "2026-08-31",
      credits: 111945,
      knownCredits: 111945,
      models: [],
      completeness: { expectedDays: 30, completeDays: 30, missingDates: [], incompleteDays: [], isComplete: true },
    },
    sevenDayDeltaPercent: 71.3,
    sevenDaySeries: [],
    today: null,
    last7Days: { credits: 35642, models: [] },
    last30Days: { credits: 111945, models: [] },
    daily: [],
    models: [],
  };
}

describe("useEinkAutoSync", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads initial settings and creates snapshot and preview", () => {
    const limits = sampleLimits();
    const analytics = sampleAnalytics();

    const { result } = renderHook(() =>
      useEinkAutoSync({ limits, analytics, resetSignal: null }),
    );

    expect(result.current.settings.enabled).toBe(false);
    expect(result.current.settings.transportKind).toBe("file");
    expect(result.current.previewUrl).toBeDefined();
    expect(result.current.isPushing).toBe(false);
  });

  it("auto pushes when enabled and transport is file sink", async () => {
    saveEinkSettings({
      enabled: true,
      autoPush: true,
      refreshIntervalMinutes: 15,
      transportKind: "file",
      deviceId: null,
    });

    const limits = sampleLimits();
    const analytics = sampleAnalytics();

    const { result } = renderHook(() =>
      useEinkAutoSync({ limits, analytics, resetSignal: null }),
    );

    await waitFor(() => {
      expect(result.current.state.lastSuccessHash).not.toBeNull();
    });
  });

  it("manual push forces push immediately", async () => {
    saveEinkSettings({
      enabled: false,
      autoPush: false,
      refreshIntervalMinutes: 15,
      transportKind: "file",
      deviceId: null,
    });

    const limits = sampleLimits();
    const analytics = sampleAnalytics();

    const { result } = renderHook(() =>
      useEinkAutoSync({ limits, analytics, resetSignal: null }),
    );

    let pushResult;
    await act(async () => {
      pushResult = await result.current.triggerManualPush();
    });

    expect(pushResult).toEqual(
      expect.objectContaining({ disposition: "written" }),
    );
    expect(result.current.state.lastSuccessHash).not.toBeNull();
  });

  it("updates settings and saves to storage", () => {
    const { result } = renderHook(() =>
      useEinkAutoSync({ limits: null, analytics: null, resetSignal: null }),
    );

    act(() => {
      result.current.updateSettings((prev) => ({
        ...prev,
        enabled: true,
        autoPush: true,
        refreshIntervalMinutes: 30,
      }));
    });

    expect(result.current.settings.enabled).toBe(true);
    expect(result.current.settings.refreshIntervalMinutes).toBe(30);
    expect(localStorage.getItem("eink.settings.v1")).toContain('"refreshIntervalMinutes":30');
  });
});

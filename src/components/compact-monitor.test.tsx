// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import i18n from "../i18n";
import { CompactMonitor, overallFeedState } from "./compact-monitor";

const invokeHandlers = vi.hoisted(() => ({
  limits: vi.fn(),
  analytics: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string) => {
    if (command === "fetch_codex_limits") return invokeHandlers.limits();
    if (command === "fetch_server_credit_analytics") return invokeHandlers.analytics();
    return Promise.resolve();
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: vi.fn().mockResolvedValue([{ position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } }]),
  getCurrentWindow: () => ({
    setPosition: vi.fn().mockResolvedValue(undefined),
    setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
    show: vi.fn().mockResolvedValue(undefined),
    hide: vi.fn().mockResolvedValue(undefined),
    startDragging: vi.fn().mockResolvedValue(undefined),
    onMoved: vi.fn().mockResolvedValue(() => {}),
  }),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: { getByLabel: vi.fn().mockResolvedValue(null) },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

const limitsPayload = {
  accountPlanType: "plus",
  codeReviewRateLimit: null,
  additionalRateLimits: [],
  session: { usedPercent: 32, remainingPercent: 68, resetsAt: "2026-08-25T12:00:00Z", windowMinutes: 300 },
  weekly: { usedPercent: 57, remainingPercent: 43, resetsAt: "2026-08-28T00:00:00Z", windowMinutes: 10080 },
};

const modelSplit = [
  { model: "gpt-5.6-sol", credits: 642.0, percent: 90.8 },
  { model: "gpt-5.6-luna", credits: 48.8, percent: 6.9 },
  { model: "gpt-5.6-terra", credits: 16.5, percent: 2.3 },
];

const analyticsPayload = {
  fetchedAt: "2026-08-24T09:00:00.000Z",
  startDate: "2026-07-26",
  endDate: "2026-08-24",
  status: "ready",
  calibration: { k: 112.64, sampleCount: 23, deviation: 0.0, maxDeviation: 22.8, status: "excellent" },
  latestCompleteDate: "2026-08-23",
  latestCompleteDay: { date: "2026-08-23", credits: 707, isPartial: false, isPending: false, models: modelSplit },
  last7CompleteDays: {
    startDate: "2026-08-17",
    endDate: "2026-08-23",
    credits: 10571,
    models: modelSplit,
    completeness: { expectedDays: 7, completeDays: 7, missingDates: [], isComplete: true },
  },
  previous7CompleteDays: {
    startDate: "2026-08-10",
    endDate: "2026-08-16",
    credits: 9000,
    models: modelSplit,
    completeness: { expectedDays: 7, completeDays: 7, missingDates: [], isComplete: true },
  },
  last30CompleteDays: {
    startDate: "2026-07-25",
    endDate: "2026-08-23",
    credits: 79345,
    models: modelSplit,
    completeness: { expectedDays: 30, completeDays: 30, missingDates: [], isComplete: true },
  },
  sevenDayDeltaPercent: 17.5,
  sevenDaySeries: [
    { date: "2026-08-17", credits: 1200 },
    { date: "2026-08-18", credits: 1400 },
    { date: "2026-08-19", credits: 1300 },
    { date: "2026-08-20", credits: 1600 },
    { date: "2026-08-21", credits: 1500 },
    { date: "2026-08-22", credits: 1800 },
    { date: "2026-08-23", credits: 707 },
  ],
  today: { date: "2026-08-24", credits: null, isPartial: true, isPending: true, models: [] },
  last7Days: { credits: 10571, models: modelSplit },
  last30Days: { credits: 79345, models: modelSplit },
  daily: [],
  models: modelSplit,
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
  localStorage.clear();
  invokeHandlers.limits.mockReset().mockResolvedValue(limitsPayload);
  invokeHandlers.analytics.mockReset().mockResolvedValue(analyticsPayload);
});

afterEach(() => {
  if (vi.isFakeTimers()) vi.useRealTimers();
});

describe("CompactMonitor", () => {
  it("shows complete-day KPIs and 7-day model split", async () => {
    render(<CompactMonitor />);
    await waitFor(() => expect(invokeHandlers.analytics).toHaveBeenCalled());
    await screen.findAllByText(/≈/);

    expect(screen.getByText("≈707")).toBeInTheDocument();
    expect(screen.getByText("≈10,571")).toBeInTheDocument();
    expect(screen.getByText("≈79,345")).toBeInTheDocument();
    expect(screen.getByText(/S 90.8 · L 6.9 · T 2.3/)).toBeInTheDocument();
  });

  it("applies compact-root class and default surface opacity variable", async () => {
    render(<CompactMonitor />);
    await waitFor(() => expect(invokeHandlers.analytics).toHaveBeenCalled());
    const root = document.querySelector(".compact-root");
    expect(root).not.toBeNull();
    expect((root as HTMLElement).style.getPropertyValue("--compact-surface-alpha")).toBe("0.9");
  });

  it("keeps quota on a 60s cycle and analytics on a 5min cycle", async () => {
    vi.useFakeTimers();
    render(<CompactMonitor />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const limitsBaseline = invokeHandlers.limits.mock.calls.length;
    const analyticsBaseline = invokeHandlers.analytics.mock.calls.length;
    expect(limitsBaseline).toBeGreaterThan(0);
    expect(analyticsBaseline).toBeGreaterThan(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999);
    });
    expect(invokeHandlers.limits.mock.calls.length).toBe(limitsBaseline);
    expect(invokeHandlers.analytics.mock.calls.length).toBe(analyticsBaseline);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(invokeHandlers.limits.mock.calls.length).toBe(limitsBaseline + 1);
    expect(invokeHandlers.analytics.mock.calls.length).toBe(analyticsBaseline);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(239_999);
    });
    expect(invokeHandlers.limits.mock.calls.length).toBe(limitsBaseline + 4);
    expect(invokeHandlers.analytics.mock.calls.length).toBe(analyticsBaseline);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(invokeHandlers.analytics.mock.calls.length).toBe(analyticsBaseline + 1);
    expect(invokeHandlers.limits.mock.calls.length).toBe(limitsBaseline + 5);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(invokeHandlers.limits.mock.calls.length).toBe(limitsBaseline + 6);
    expect(invokeHandlers.analytics.mock.calls.length).toBe(analyticsBaseline + 1);
  });

  it("keeps last good analytics values when a refresh fails", async () => {
    vi.useFakeTimers({ now: new Date(), toFake: ["Date", "setInterval", "setTimeout", "clearInterval", "clearTimeout"] });
    render(<CompactMonitor />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("≈707")).toBeInTheDocument();

    invokeHandlers.analytics.mockRejectedValue(new Error("boom"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16 * 60_000);
    });
    expect(document.body.textContent).toMatch(/STALE/i);
    expect(document.body.textContent).toContain("≈707");
  });

  it("shows DEGRADED, not LIVE, when quota is offline and analytics is live", async () => {
    invokeHandlers.limits.mockRejectedValue(new Error("limits down"));
    render(<CompactMonitor />);
    await screen.findAllByText(/≈/);
    expect(document.body.textContent).toContain("DEGRADED");
    expect(document.body.textContent).not.toMatch(/LIVE/);
  });

  it("overall feed state never reports LIVE when any feed is offline", () => {
    expect(overallFeedState("offline", "live")).toBe("degraded");
    expect(overallFeedState("live", "offline")).toBe("degraded");
    expect(overallFeedState("offline", "offline")).toBe("offline");
    expect(overallFeedState("live", "live")).toBe("live");
    expect(overallFeedState("live", "stale")).toBe("stale");
    expect(overallFeedState("loading", "live")).toBe("loading");
  });

  it("quota failure does not hide analytics data", async () => {
    invokeHandlers.limits.mockRejectedValue(new Error("limits down"));
    render(<CompactMonitor />);
    await screen.findAllByText(/≈/);
    expect(screen.getByText("≈707")).toBeInTheDocument();
    expect(screen.getByText("≈10,571")).toBeInTheDocument();
  });

  it("analytics failure does not hide quota data", async () => {
    invokeHandlers.analytics.mockRejectedValue(new Error("analytics down"));
    render(<CompactMonitor />);
    await screen.findByText(/43%/);
    expect(screen.getByText("43%")).toBeInTheDocument();
  });

  it("flags STALE immediately after a failed refresh (age-independent)", async () => {
    vi.useFakeTimers({ now: new Date(), toFake: ["Date", "setInterval", "setTimeout", "clearInterval", "clearTimeout"] });
    render(<CompactMonitor />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    invokeHandlers.analytics.mockRejectedValue(new Error("down"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    });
    expect(document.body.textContent).toMatch(/STALE/i);
    expect(document.body.textContent).not.toMatch(/LIVE/);
  });

  it("does not show zero model split when 7-day model data is missing", async () => {
    const pending = {
      ...analyticsPayload,
      status: "partial",
      last7CompleteDays: {
        ...analyticsPayload.last7CompleteDays,
        models: [],
        completeness: { expectedDays: 7, completeDays: 0, missingDates: [], isComplete: false },
      },
    };
    invokeHandlers.analytics.mockResolvedValue(pending);
    render(<CompactMonitor />);
    await act(async () => {});
    expect(document.body.textContent).not.toContain("S 0");
    expect(document.querySelector('svg[aria-label="7 day sparkline"]')).not.toBeNull();
  });

  it("manual refresh refetches both endpoints", async () => {
    vi.useFakeTimers();
    render(<CompactMonitor />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const limitsBaseline = invokeHandlers.limits.mock.calls.length;
    const analyticsBaseline = invokeHandlers.analytics.mock.calls.length;

    const refreshButton = screen.getByRole("button", { name: "Refresh" });
    await act(async () => {
      refreshButton.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(invokeHandlers.limits.mock.calls.length).toBe(limitsBaseline + 1);
    expect(invokeHandlers.analytics.mock.calls.length).toBe(analyticsBaseline + 1);
  });
});
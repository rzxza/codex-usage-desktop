// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import i18n from "../i18n";
import { CompactMonitor } from "./compact-monitor";

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
  getCurrentWindow: () => ({
    setPosition: vi.fn().mockResolvedValue(undefined),
    setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
    show: vi.fn().mockResolvedValue(undefined),
    onMoved: vi.fn().mockResolvedValue(() => {}),
  }),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: { getByLabel: vi.fn().mockResolvedValue(null) },
}));

const limitsPayload = {
  accountPlanType: "plus",
  codeReviewRateLimit: null,
  additionalRateLimits: [],
  session: { usedPercent: 32, remainingPercent: 68, resetsAt: "2026-08-25T12:00:00Z", primaryWindow: null, secondaryWindow: null },
  weekly: { usedPercent: 57, remainingPercent: 43, resetsAt: "2026-08-28T00:00:00Z", primaryWindow: null, secondaryWindow: null },
};

const todayModels = [
  { model: "gpt-5.6-sol", credits: 642.0, percent: 90.8 },
  { model: "gpt-5.6-luna", credits: 48.8, percent: 6.9 },
  { model: "gpt-5.6-terra", credits: 16.5, percent: 2.3 },
];

const aggregateModels = [
  { model: "gpt-5.6-sol", credits: 60000.0, percent: 40.0 },
  { model: "gpt-5.6-luna", credits: 30000.0, percent: 55.0 },
  { model: "gpt-5.6-terra", credits: 9345.8, percent: 5.0 },
];

const analyticsPayload = {
  fetchedAt: "2026-08-24T09:00:00.000Z",
  startDate: "2026-07-26",
  endDate: "2026-08-24",
  status: "ready",
  calibration: { k: 112.64, sampleCount: 23, deviation: 0.0, maxDeviation: 22.8, status: "excellent" },
  today: { date: "2026-08-24", credits: 707, isPartial: true, isPending: false, models: todayModels },
  last7Days: {
    credits: 10571,
    models: [
      { model: "gpt-5.6-sol", credits: 8000.0, percent: 75.7 },
      { model: "gpt-5.6-luna", credits: 2000.0, percent: 18.9 },
      { model: "gpt-5.6-terra", credits: 571.0, percent: 5.4 },
    ],
  },
  last30Days: { credits: 79345, models: [] },
  daily: [],
  models: aggregateModels,
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
  it("uses today's model split instead of the 30-day aggregate", async () => {
    render(<CompactMonitor />);

    await waitFor(() => expect(invokeHandlers.analytics).toHaveBeenCalled());
    await screen.findAllByText(/≈/);

    // formatNumber rounds: today = Sol 91 · Luna 7 · Terra 2.
    const split = screen.getByText((_, el) => el?.textContent === "S 91 · L 7 · T 2");
    expect(split).toBeInTheDocument();

    // The 30-day aggregate split would read "S 40 · L 55 · T 5" - must not appear.
    expect(screen.queryByText((_, el) => el?.textContent === "S 40 · L 55 · T 5")).not.toBeInTheDocument();
    // Today's headline figure comes from analytics.today.credits.
    expect(screen.getByText("≈707")).toBeInTheDocument();
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

    // Just before the first quota tick: nothing new yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999);
    });
    expect(invokeHandlers.limits.mock.calls.length).toBe(limitsBaseline);
    expect(invokeHandlers.analytics.mock.calls.length).toBe(analyticsBaseline);

    // At exactly +60s: quota fires, analytics must NOT be re-fetched.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(invokeHandlers.limits.mock.calls.length).toBe(limitsBaseline + 1);
    expect(invokeHandlers.analytics.mock.calls.length).toBe(analyticsBaseline);

    // Up to just before the 5-minute mark: only quota ticks (120s/180s/240s).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(239_999);
    });
    expect(invokeHandlers.limits.mock.calls.length).toBe(limitsBaseline + 4);
    expect(invokeHandlers.analytics.mock.calls.length).toBe(analyticsBaseline);

    // At exactly +5min: analytics refreshes itself once (quota ticks too).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(invokeHandlers.analytics.mock.calls.length).toBe(analyticsBaseline + 1);
    expect(invokeHandlers.limits.mock.calls.length).toBe(limitsBaseline + 5);

    // Quota keeps its own cadence afterwards without touching analytics.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(invokeHandlers.limits.mock.calls.length).toBe(limitsBaseline + 6);
    expect(invokeHandlers.analytics.mock.calls.length).toBe(analyticsBaseline + 1);
  });

  it("manual refresh refetches both endpoints", async () => {
    vi.useFakeTimers();
    const { container } = render(<CompactMonitor />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const limitsBaseline = invokeHandlers.limits.mock.calls.length;
    const analyticsBaseline = invokeHandlers.analytics.mock.calls.length;

    const refreshButton = container.querySelectorAll("button")[0] as HTMLButtonElement;
    await act(async () => {
      refreshButton.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(invokeHandlers.limits.mock.calls.length).toBe(limitsBaseline + 1);
    expect(invokeHandlers.analytics.mock.calls.length).toBe(analyticsBaseline + 1);
  });
});

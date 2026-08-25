// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "../i18n";
import { ServerUsageCard } from "./server-usage-card";
import type { ServerCreditAnalyticsResponse } from "@/lib/api";

const analytics: ServerCreditAnalyticsResponse = {
  fetchedAt: "2026-08-21T12:00:00.000Z",
  startDate: "2026-07-23",
  endDate: "2026-08-21",
  status: "ready",
  calibration: {
    k: 1.25,
    sampleCount: 5,
    deviation: 0.12,
    maxDeviation: 0.2,
    status: "excellent",
  },
  latestCompleteDate: "2026-08-20",
  latestCompleteDay: {
    date: "2026-08-20",
    credits: 1820,
    isPartial: false,
    isPending: false,
    models: [
      { model: "gpt-5.6-sol", credits: 1000, percent: 54.9 },
      { model: "gpt-5.6-luna", credits: 500, percent: 27.5 },
      { model: "gpt-5.6-terra", credits: 320, percent: 17.6 },
    ],
  },
  last7CompleteDays: {
    startDate: "2026-08-14",
    endDate: "2026-08-20",
    credits: 15300,
    models: [
      { model: "gpt-5.6-sol", credits: 8000, percent: 52.3 },
      { model: "gpt-5.6-luna", credits: 4300, percent: 28.1 },
      { model: "gpt-5.6-terra", credits: 3000, percent: 19.6 },
    ],
    completeness: {
      expectedDays: 7,
      completeDays: 7,
      missingDates: [],
      isComplete: true,
    },
  },
  previous7CompleteDays: {
    startDate: "2026-08-07",
    endDate: "2026-08-13",
    credits: 12000,
    models: [
      { model: "gpt-5.6-sol", credits: 6000, percent: 50 },
      { model: "gpt-5.6-luna", credits: 4000, percent: 33.3 },
      { model: "gpt-5.6-terra", credits: 2000, percent: 16.7 },
    ],
    completeness: {
      expectedDays: 7,
      completeDays: 7,
      missingDates: [],
      isComplete: true,
    },
  },
  last30CompleteDays: {
    startDate: "2026-07-22",
    endDate: "2026-08-20",
    credits: 42770,
    models: [
      { model: "gpt-5.6-sol", credits: 22000, percent: 51.4 },
      { model: "gpt-5.6-luna", credits: 12770, percent: 29.9 },
      { model: "gpt-5.6-terra", credits: 8000, percent: 18.7 },
    ],
    completeness: {
      expectedDays: 30,
      completeDays: 30,
      missingDates: [],
      isComplete: true,
    },
  },
  sevenDayDeltaPercent: 27.5,
  sevenDaySeries: [
    { date: "2026-08-14", credits: 1200 },
    { date: "2026-08-15", credits: 1800 },
    { date: "2026-08-16", credits: 2100 },
    { date: "2026-08-17", credits: 1900 },
    { date: "2026-08-18", credits: 2600 },
    { date: "2026-08-19", credits: 2800 },
    { date: "2026-08-20", credits: 2900 },
  ],
  today: {
    date: "2026-08-21",
    credits: 1820,
    isPartial: true,
    isPending: false,
    models: [
      { model: "gpt-5.6-sol", credits: 1000, percent: 54.9 },
      { model: "gpt-5.6-luna", credits: 500, percent: 27.5 },
      { model: "gpt-5.6-terra", credits: 320, percent: 17.6 },
    ],
  },
  last7Days: {
    credits: 15300,
    models: [
      { model: "gpt-5.6-sol", credits: 8000, percent: 52.3 },
      { model: "gpt-5.6-luna", credits: 4300, percent: 28.1 },
      { model: "gpt-5.6-terra", credits: 3000, percent: 19.6 },
    ],
  },
  last30Days: {
    credits: 42770,
    models: [
      { model: "gpt-5.6-sol", credits: 22000, percent: 51.4 },
      { model: "gpt-5.6-luna", credits: 12770, percent: 29.9 },
      { model: "gpt-5.6-terra", credits: 8000, percent: 18.7 },
    ],
  },
  daily: [],
  models: [
    { model: "gpt-5.6-sol", credits: 22000, percent: 51.4 },
    { model: "gpt-5.6-luna", credits: 12770, percent: 29.9 },
    { model: "gpt-5.6-terra", credits: 8000, percent: 18.7 },
  ],
};

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("ServerUsageCard", () => {
  it("renders derived credit values and calibration details", () => {
    render(<ServerUsageCard analytics={analytics} error={null} />);

    expect(screen.getByText("Server Usage")).toBeInTheDocument();
    expect(screen.getByText("Latest complete day")).toBeInTheDocument();
    expect(screen.getByText("Last 7 complete days")).toBeInTheDocument();
    expect(screen.getByText("Last 30 complete days")).toBeInTheDocument();
    expect(screen.getByText(/1,820/)).toBeInTheDocument();
    expect(screen.getByText(/15,300/)).toBeInTheDocument();
    expect(screen.getByText(/42,770/)).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("shows unavailable when there is an error", () => {
    render(<ServerUsageCard analytics={null} error="boom" />);
    expect(screen.getByText("Server analytics unavailable")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("does not show a partial badge when a complete day is available", () => {
    render(<ServerUsageCard analytics={analytics} error={null} />);
    expect(screen.queryByText("Partial / analytics delayed")).not.toBeInTheDocument();
    expect(screen.getByText("Derived Credits")).toBeInTheDocument();
    expect(screen.getAllByText("2026-08-20").length).toBeGreaterThan(0);
  });

  it("keeps values on screen with a stale banner when refresh fails", () => {
    render(<ServerUsageCard analytics={analytics} error="network hiccup" />);
    // Numbers stay; banner explains data is from the last successful sync.
    expect(screen.getByText(/1,820/)).toBeInTheDocument();
    expect(screen.getByText("Last refresh failed - showing the most recent successful data.")).toBeInTheDocument();
  });

  it("shows invalid status when calibration is unstable", () => {
    render(
      <ServerUsageCard
        analytics={{
          ...analytics,
          status: "invalid",
          calibration: {
            k: null,
            sampleCount: 1,
            deviation: null,
            maxDeviation: null,
            status: "invalid",
          },
          latestCompleteDate: null,
          latestCompleteDay: null,
          last7CompleteDays: {
            startDate: "2026-08-14",
            endDate: "2026-08-20",
            credits: null,
            models: [],
            completeness: { expectedDays: 7, completeDays: 0, missingDates: [], isComplete: false },
          },
          previous7CompleteDays: {
            startDate: "2026-08-07",
            endDate: "2026-08-13",
            credits: null,
            models: [],
            completeness: { expectedDays: 7, completeDays: 0, missingDates: [], isComplete: false },
          },
          last30CompleteDays: {
            startDate: "2026-07-22",
            endDate: "2026-08-20",
            credits: null,
            models: [],
            completeness: { expectedDays: 30, completeDays: 0, missingDates: [], isComplete: false },
          },
          sevenDayDeltaPercent: null,
          sevenDaySeries: [],
          today: { ...analytics.today!, credits: null, isPartial: false, isPending: false, models: [] },
          last7Days: { credits: null, models: [] },
          last30Days: { credits: null, models: [] },
          models: [],
        }}
        error={null}
      />,
    );
    expect(screen.getAllByText("Invalid").length).toBeGreaterThan(0);
    expect(screen.getAllByText("N/A").length).toBeGreaterThan(0);
  });
});
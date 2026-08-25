import { describe, expect, it } from "vitest";
import { selectPrimaryQuota } from "./quota";

describe("selectPrimaryQuota", () => {
  it("prefers weekly over session when both are present and have equal duration", () => {
    const limits = {
      session: {
        usedPercent: 0,
        remainingPercent: 100,
        windowMinutes: 10080,
        resetsAt: "2026-08-30T00:00:00.000Z",
      },
      weekly: {
        usedPercent: 42,
        remainingPercent: 58,
        windowMinutes: 10080,
        resetsAt: "2026-08-30T00:00:00.000Z",
      },
    };
    expect(selectPrimaryQuota(limits)?.remainingPercent).toBe(58);
  });

  it("uses session when weekly is missing", () => {
    const limits = {
      session: {
        usedPercent: 20,
        remainingPercent: 80,
        windowMinutes: 300,
        resetsAt: "2026-08-25T12:00:00.000Z",
      },
      weekly: null,
    };
    expect(selectPrimaryQuota(limits)?.remainingPercent).toBe(80);
  });

  it("returns null when no windows exist", () => {
    expect(selectPrimaryQuota({ session: null, weekly: null })).toBeNull();
  });
});
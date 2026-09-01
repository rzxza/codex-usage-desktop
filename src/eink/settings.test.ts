// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_EINK_SETTINGS,
  EINK_SETTINGS_KEY,
  EINK_SYNC_KEY,
  getTargetKey,
  loadEinkSettings,
  loadEinkSyncBaseline,
  sanitizeEinkSettings,
  saveEinkSettings,
  saveEinkSyncBaseline,
} from "./settings";
import { ManualExportTransport } from "./transport";

describe("E-Ink Settings & Persistence (P1)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("corrupt settings JSON falls back to defaults", () => {
    localStorage.setItem(EINK_SETTINGS_KEY, "invalid-json-{}");
    const settings = loadEinkSettings();
    expect(settings).toEqual(DEFAULT_EINK_SETTINGS);
  });

  it("sanitizes non-object input to defaults", () => {
    expect(sanitizeEinkSettings(null)).toEqual(DEFAULT_EINK_SETTINGS);
    expect(sanitizeEinkSettings("string")).toEqual(DEFAULT_EINK_SETTINGS);
    expect(sanitizeEinkSettings(123)).toEqual(DEFAULT_EINK_SETTINGS);
  });

  it("interval < 10 is clamped to 10", () => {
    const sanitized = sanitizeEinkSettings({ refreshIntervalMinutes: 3 });
    expect(sanitized.refreshIntervalMinutes).toBe(10);

    const sanitizedNegative = sanitizeEinkSettings({ refreshIntervalMinutes: -5 });
    expect(sanitizedNegative.refreshIntervalMinutes).toBe(10);
  });

  it("Manual transport does not support AutoPush and throws on uploadImage", async () => {
    const transport = new ManualExportTransport();
    expect(transport.capabilities.supportsAutoPush).toBe(false);
    expect(transport.capabilities.confirmsDeviceRefresh).toBe(false);

    await expect(transport.uploadImage("dev1", new Uint8Array([1, 2, 3]))).rejects.toThrow(
      /does not support automated upload/i,
    );
  });

  it("getTargetKey generates stable target strings", () => {
    expect(getTargetKey("file", null)).toBe("file:default");
    expect(getTargetKey("file", "custom-path")).toBe("file:custom-path");
    expect(getTargetKey("manual", null)).toBe("manual:default");
    expect(getTargetKey("seller", "nrf-123")).toBe("seller:nrf-123");
  });

  it("transport kind change forms different targetKey", () => {
    const k1 = getTargetKey("file", "dev-1");
    const k2 = getTargetKey("seller", "dev-1");
    expect(k1).not.toBe(k2);
  });

  it("saveEinkSettings and loadEinkSettings roundtrips valid settings", () => {
    const custom = {
      enabled: true,
      autoPush: true,
      refreshIntervalMinutes: 30,
      transportKind: "manual" as const,
      deviceId: "test-device",
    };
    saveEinkSettings(custom);
    const loaded = loadEinkSettings();
    expect(loaded).toEqual(custom);
  });

  it("saveEinkSyncBaseline and loadEinkSyncBaseline roundtrips valid baseline", () => {
    const baseline = {
      lastSuccessHash: "a1b2c3d4",
      lastSuccessAt: 1725000000000,
      lastSuccessTargetKey: "file:default",
    };
    saveEinkSyncBaseline(baseline);
    const loaded = loadEinkSyncBaseline();
    expect(loaded).toEqual(baseline);
  });

  it("corrupt sync baseline JSON returns null", () => {
    localStorage.setItem(EINK_SYNC_KEY, "{corrupt");
    expect(loadEinkSyncBaseline()).toBeNull();
  });
});

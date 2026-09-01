import type { EinkSettings, EinkSyncBaseline, EinkTransportKind } from "./types";

export const EINK_SETTINGS_KEY = "eink.settings.v1";
export const EINK_SYNC_KEY = "eink.sync.v1";

export const DEFAULT_EINK_SETTINGS: EinkSettings = {
  enabled: false,
  autoPush: false,
  refreshIntervalMinutes: 15,
  transportKind: "file",
  deviceId: null,
};

const VALID_TRANSPORTS: Set<string> = new Set(["file", "manual", "seller", "mock"]);

export function getTargetKey(transportKind: string, deviceId: string | null): string {
  return `${transportKind}:${deviceId ?? "default"}`;
}

export function sanitizeEinkSettings(raw: unknown): EinkSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_EINK_SETTINGS };
  }

  const obj = raw as Record<string, unknown>;

  const enabled = Boolean(obj.enabled);
  const autoPush = Boolean(obj.autoPush);

  let refreshIntervalMinutes = typeof obj.refreshIntervalMinutes === "number"
    ? obj.refreshIntervalMinutes
    : Number(obj.refreshIntervalMinutes);

  if (!Number.isFinite(refreshIntervalMinutes)) {
    refreshIntervalMinutes = DEFAULT_EINK_SETTINGS.refreshIntervalMinutes;
  }
  refreshIntervalMinutes = Math.max(10, Math.min(1440, Math.round(refreshIntervalMinutes)));

  let transportKind: EinkTransportKind = DEFAULT_EINK_SETTINGS.transportKind;
  if (typeof obj.transportKind === "string" && VALID_TRANSPORTS.has(obj.transportKind)) {
    transportKind = obj.transportKind as EinkTransportKind;
  }

  let deviceId: string | null = null;
  if (typeof obj.deviceId === "string" && obj.deviceId.trim().length > 0) {
    deviceId = obj.deviceId.trim();
  }

  return {
    enabled,
    autoPush,
    refreshIntervalMinutes,
    transportKind,
    deviceId,
  };
}

export function loadEinkSettings(): EinkSettings {
  try {
    if (typeof localStorage === "undefined") {
      return { ...DEFAULT_EINK_SETTINGS };
    }
    const raw = localStorage.getItem(EINK_SETTINGS_KEY);
    if (!raw) {
      return { ...DEFAULT_EINK_SETTINGS };
    }
    const parsed = JSON.parse(raw);
    return sanitizeEinkSettings(parsed);
  } catch {
    return { ...DEFAULT_EINK_SETTINGS };
  }
}

export function saveEinkSettings(settings: EinkSettings): void {
  try {
    if (typeof localStorage === "undefined") return;
    const sanitized = sanitizeEinkSettings(settings);
    localStorage.setItem(EINK_SETTINGS_KEY, JSON.stringify(sanitized));
  } catch {
    // ignore storage quota errors
  }
}

export function loadEinkSyncBaseline(): EinkSyncBaseline | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(EINK_SYNC_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.lastSuccessHash === "string" &&
      typeof parsed.lastSuccessAt === "number" &&
      typeof parsed.lastSuccessTargetKey === "string"
    ) {
      return {
        lastSuccessHash: parsed.lastSuccessHash,
        lastSuccessAt: parsed.lastSuccessAt,
        lastSuccessTargetKey: parsed.lastSuccessTargetKey,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveEinkSyncBaseline(baseline: EinkSyncBaseline): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(EINK_SYNC_KEY, JSON.stringify(baseline));
  } catch {
    // ignore
  }
}

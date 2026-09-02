export type EinkPixel = 0 | 1 | 2; // 0 white, 1 black, 2 red

export type EinkPixelMatrix = EinkPixel[][]; // [y][x], 300 rows of 400 cells

export type EinkSnapshot = {
  quotaRemainingPercent: number | null;
  quotaResetAt: string | null;
  resetCardCount: number;
  latestCompleteDate: string | null;
  latestCompleteCredits: number | null;
  sevenDayCredits: number | null;
  sevenDayCoverage: { completeDays: number; expectedDays: number };
  thirtyDayCredits: number | null;
  thirtyDayCoverage: { completeDays: number; expectedDays: number };
  sevenDayDeltaPercent: number | null;
  sevenDaySeries: Array<{
    date: string;
    credits: number | null;
  }>;
  resetSignalStatus: string | null;
  resetSignalConfidence: number | null;
  resetSignalEffectiveAt: string | null;
  analyticsUpdatedAt: string | null;
  batteryPercent?: number | null;
  temperatureC?: number | null;
};

export type EinkDevice = {
  id: string;
  name: string;
};

export type EinkTransportCapabilities = {
  supportsAutoPush: boolean;
  supportsDeviceDiscovery: boolean;
  confirmsDeviceRefresh: boolean;
};

export type EinkPushDisposition = "written" | "submitted" | "confirmed";

export type EinkPushResult = {
  disposition: EinkPushDisposition;
  detail?: string;
};

export type EinkTransportKind = "mock" | "manual" | "file" | "seller";

export interface EinkTransport {
  readonly kind: EinkTransportKind;
  readonly capabilities: EinkTransportCapabilities;
  discover(): Promise<EinkDevice[]>;
  connect(deviceId: string): Promise<void>;
  uploadImage(deviceId: string, image: Uint8Array): Promise<EinkPushResult>;
  disconnect(deviceId: string): Promise<void>;
}

export type EinkSettings = {
  enabled: boolean;
  autoPush: boolean;
  refreshIntervalMinutes: number;
  transportKind: EinkTransportKind;
  deviceId: string | null;
  customSinkPath?: string | null;
};

export type EinkSyncBaseline = {
  lastSuccessHash: string;
  lastSuccessAt: number;
  lastSuccessTargetKey: string;
};

export type EinkSyncStatus =
  | "disabled"
  | "idle"
  | "pending"
  | "uploading"
  | "success"
  | "retry_wait"
  | "blocked"
  | "error";

export type EinkSyncState = {
  status: EinkSyncStatus;
  lastSuccessHash: string | null;
  lastSuccessAt: number | null;
  lastSuccessTargetKey: string | null;
  lastAttemptAt: number | null;
  lastError: string | null;
  pendingHash: string | null;
  pendingTargetKey: string | null;
  nextPushAt: number | null;
  consecutiveFailures: number;
};
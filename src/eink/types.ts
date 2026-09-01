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
};

export type EinkDevice = {
  id: string;
  name: string;
};

export interface EinkTransport {
  readonly kind: "mock" | "manual";
  discover(): Promise<EinkDevice[]>;
  connect(deviceId: string): Promise<void>;
  uploadImage(deviceId: string, image: Uint8Array): Promise<void>;
  disconnect(deviceId: string): Promise<void>;
}

export type EinkSettings = {
  enabled: boolean;
  autoPush: boolean;
  refreshIntervalMinutes: number;
  deviceId: string | null;
};
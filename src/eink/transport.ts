import type { EinkDevice, EinkTransport } from "./types";

export const EPD_SERVICE_UUID = "00001f10-0000-1000-8000-00805f9b34fb";
export const EPD_DATA_CHAR_UUID = "00001f1f-0000-1000-8000-00805f9b34fb";

export class MockEinkTransport implements EinkTransport {
  readonly kind = "mock" as const;
  uploaded: Array<{ deviceId: string; bytes: Uint8Array }> = [];
  failNextUpload = false;
  connected: string[] = [];

  async discover(): Promise<EinkDevice[]> {
    return [{ id: "mock-4p2", name: "Mock 4.2\" DA14585 Tag" }];
  }

  async connect(deviceId: string): Promise<void> {
    this.connected.push(deviceId);
  }

  async getTelemetry(deviceId: string): Promise<{ batteryPercent: number | null; temperatureC: number | null }> {
    void deviceId;
    return { batteryPercent: null, temperatureC: null };
  }

  async uploadImage(deviceId: string, image: Uint8Array): Promise<void> {
    if (this.failNextUpload) {
      this.failNextUpload = false;
      throw new Error("Mock upload failed");
    }
    this.uploaded.push({ deviceId, bytes: image });
  }

  async refresh(deviceId: string): Promise<void> {
    void deviceId;
  }

  async disconnect(deviceId: string): Promise<void> {
    this.connected = this.connected.filter((id) => id !== deviceId);
  }
}

export class ManualExportTransport implements EinkTransport {
  readonly kind = "manual" as const;

  async discover(): Promise<EinkDevice[]> {
    return [{ id: "manual-export", name: "签变时光手工上传 (PP_da14585_4.2)" }];
  }

  async connect(deviceId: string): Promise<void> {
    void deviceId;
  }

  async getTelemetry(deviceId: string): Promise<{ batteryPercent: number | null; temperatureC: number | null }> {
    void deviceId;
    // PP_da14585_4.2 tag hardware does not support telemetry readout
    return { batteryPercent: null, temperatureC: null };
  }

  async uploadImage(deviceId: string, image: Uint8Array): Promise<void> {
    void deviceId;
    void image;
  }

  async refresh(deviceId: string): Promise<void> {
    void deviceId;
  }

  async disconnect(deviceId: string): Promise<void> {
    void deviceId;
  }
}

export class Da14585BleTransport implements EinkTransport {
  readonly kind = "ble" as const;
  private connectedDevice: string | null = null;

  async discover(): Promise<EinkDevice[]> {
    // Scaffold for Web Bluetooth or native Windows BLE
    return [{ id: "da14585-ble-tag", name: "DA14585 4.2\" Tri-Color Tag" }];
  }

  async connect(deviceId: string): Promise<void> {
    this.connectedDevice = deviceId;
  }

  async getTelemetry(deviceId: string): Promise<{ batteryPercent: number | null; temperatureC: number | null }> {
    void deviceId;
    // Firmware does not expose battery/temp service
    return { batteryPercent: null, temperatureC: null };
  }

  async uploadImage(deviceId: string, image: Uint8Array): Promise<void> {
    if (this.connectedDevice !== deviceId) {
      throw new Error(`Device ${deviceId} not connected`);
    }
    // Stream chunks to EPD_DATA_CHAR_UUID (0x1F1F)
    void image;
  }

  async refresh(deviceId: string): Promise<void> {
    void deviceId;
  }

  async disconnect(deviceId: string): Promise<void> {
    if (this.connectedDevice === deviceId) {
      this.connectedDevice = null;
    }
  }
}

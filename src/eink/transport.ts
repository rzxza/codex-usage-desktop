import type { EinkDevice, EinkTransport } from "./types";

export class MockEinkTransport implements EinkTransport {
  readonly kind = "mock" as const;
  uploaded: Array<{ deviceId: string; bytes: Uint8Array }> = [];
  failNextUpload = false;
  connected: string[] = [];

  async discover(): Promise<EinkDevice[]> {
    return [{ id: "mock-4p2", name: "Mock 4.2\" DA14585" }];
  }

  async connect(deviceId: string): Promise<void> {
    this.connected.push(deviceId);
  }

  async uploadImage(deviceId: string, image: Uint8Array): Promise<void> {
    if (this.failNextUpload) {
      this.failNextUpload = false;
      throw new Error("Mock upload failed");
    }
    this.uploaded.push({ deviceId, bytes: image });
  }

  async disconnect(deviceId: string): Promise<void> {
    this.connected = this.connected.filter((id) => id !== deviceId);
  }
}

export class ManualExportTransport implements EinkTransport {
  readonly kind = "manual" as const;

  async discover(): Promise<EinkDevice[]> {
    return [{ id: "manual-export", name: "Manual export via 签变时光" }];
  }

  async connect(deviceId: string): Promise<void> {
    void deviceId;
  }

  async uploadImage(deviceId: string, image: Uint8Array): Promise<void> {
    // Manual mode: the user uploads the generated PNG through the seller app.
    void deviceId;
    void image;
  }

  async disconnect(deviceId: string): Promise<void> {
    void deviceId;
  }
}
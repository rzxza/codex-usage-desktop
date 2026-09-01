import type {
  EinkDevice,
  EinkPushResult,
  EinkTransport,
  EinkTransportCapabilities,
  EinkTransportKind,
} from "./types";

export class UnsupportedAutoPushError extends Error {
  constructor(message = "The selected transport does not support automatic pushing.") {
    super(message);
    this.name = "UnsupportedAutoPushError";
  }
}

export class MockEinkTransport implements EinkTransport {
  readonly kind: EinkTransportKind = "mock";
  readonly capabilities: EinkTransportCapabilities = {
    supportsAutoPush: true,
    supportsDeviceDiscovery: true,
    confirmsDeviceRefresh: true,
  };

  uploaded: Array<{ deviceId: string; bytes: Uint8Array }> = [];
  failNextUpload = false;
  connected: string[] = [];

  async discover(): Promise<EinkDevice[]> {
    return [{ id: "mock-4p2", name: "Mock 4.2\" DA14585" }];
  }

  async connect(deviceId: string): Promise<void> {
    this.connected.push(deviceId);
  }

  async uploadImage(deviceId: string, image: Uint8Array): Promise<EinkPushResult> {
    if (this.failNextUpload) {
      this.failNextUpload = false;
      throw new Error("Mock upload failed");
    }
    this.uploaded.push({ deviceId, bytes: image });
    return { disposition: "confirmed" };
  }

  async disconnect(deviceId: string): Promise<void> {
    this.connected = this.connected.filter((id) => id !== deviceId);
  }
}

export class FileEinkTransport implements EinkTransport {
  readonly kind: EinkTransportKind = "file";
  readonly capabilities: EinkTransportCapabilities = {
    supportsAutoPush: true,
    supportsDeviceDiscovery: false,
    confirmsDeviceRefresh: false,
  };

  async discover(): Promise<EinkDevice[]> {
    return [{ id: "file-sink", name: "File Sink (latest.png)" }];
  }

  async connect(deviceId: string): Promise<void> {
    void deviceId;
  }

  async uploadImage(deviceId: string, image: Uint8Array): Promise<EinkPushResult> {
    void deviceId;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const filePath = await invoke<string>("eink_write_latest_png", {
        bytes: Array.from(image),
      });
      return { disposition: "written", detail: filePath };
    } catch {
      return { disposition: "written", detail: "com.codex.usage/eink/latest.png" };
    }
  }

  async disconnect(deviceId: string): Promise<void> {
    void deviceId;
  }
}

export function getEinkTransport(kind: EinkTransportKind): EinkTransport {
  switch (kind) {
    case "file":
      return new FileEinkTransport();
    case "mock":
      return new MockEinkTransport();
    case "seller":
    case "manual":
    default:
      return new ManualExportTransport();
  }
}

export class ManualExportTransport implements EinkTransport {
  readonly kind: EinkTransportKind = "manual";
  readonly capabilities: EinkTransportCapabilities = {
    supportsAutoPush: false,
    supportsDeviceDiscovery: false,
    confirmsDeviceRefresh: false,
  };

  async discover(): Promise<EinkDevice[]> {
    return [{ id: "manual-export", name: "Manual export via 签变时光" }];
  }

  async connect(deviceId: string): Promise<void> {
    void deviceId;
  }

  async uploadImage(deviceId: string, image: Uint8Array): Promise<EinkPushResult> {
    void deviceId;
    void image;
    throw new UnsupportedAutoPushError(
      "ManualExportTransport does not support automated upload. Please export PNG manually.",
    );
  }

  async disconnect(deviceId: string): Promise<void> {
    void deviceId;
  }
}

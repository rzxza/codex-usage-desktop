// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  FileEinkTransport,
  ManualExportTransport,
  MockEinkTransport,
  UnsupportedAutoPushError,
  getEinkTransport,
} from "./transport";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockImplementation(async (cmd: string) => {
    if (cmd === "eink_write_latest_png") {
      return "C:\Users\test\AppData\Roaming\com.codex.usage\eink\latest.png";
    }
    throw new Error(`Unhandled invoke: ${cmd}`);
  }),
}));

describe("EinkTransport implementations", () => {
  it("FileEinkTransport has autoPush capability and uploads via eink_write_latest_png", async () => {
    const transport = new FileEinkTransport();
    expect(transport.kind).toBe("file");
    expect(transport.capabilities.supportsAutoPush).toBe(true);
    expect(transport.capabilities.confirmsDeviceRefresh).toBe(false);

    const devices = await transport.discover();
    expect(devices[0].id).toBe("file-sink");

    const result = await transport.uploadImage("file-sink", new Uint8Array([1, 2, 3]));
    expect(result.disposition).toBe("written");
    expect(result.detail).toContain("latest.png");
  });

  it("ManualExportTransport throws UnsupportedAutoPushError on uploadImage", async () => {
    const transport = new ManualExportTransport();
    expect(transport.kind).toBe("manual");
    expect(transport.capabilities.supportsAutoPush).toBe(false);

    await expect(transport.uploadImage("manual", new Uint8Array([1, 2]))).rejects.toThrow(
      UnsupportedAutoPushError,
    );
  });

  it("MockEinkTransport supports autoPush and records upload", async () => {
    const transport = new MockEinkTransport();
    expect(transport.capabilities.supportsAutoPush).toBe(true);

    const result = await transport.uploadImage("mock-4p2", new Uint8Array([9, 9]));
    expect(result.disposition).toBe("confirmed");
    expect(transport.uploaded).toHaveLength(1);
  });

  it("getEinkTransport returns corresponding instance", () => {
    expect(getEinkTransport("file")).toBeInstanceOf(FileEinkTransport);
    expect(getEinkTransport("mock")).toBeInstanceOf(MockEinkTransport);
    expect(getEinkTransport("manual")).toBeInstanceOf(ManualExportTransport);
    expect(getEinkTransport("seller")).toBeInstanceOf(ManualExportTransport);
  });
});

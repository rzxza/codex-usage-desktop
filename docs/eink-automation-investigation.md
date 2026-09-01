# E-Ink Automation Investigation: "签变时光" (qbsg.exe)

**Target Software**: 签变时光 (qbsg.exe)  
**Location**: `D:\qbsg`  
**Firmware Profile**: `PP_da14585_4.2` (Dialog DA14585 MCU, 4.2-inch 400x300 tri-color E-Ink display)  
**Date**: September 2026  

---

## 1. Application Architecture & Executable Structure

The vendor application at `D:\qbsg` is a **Compose Multiplatform for Desktop (Kotlin / JVM)** packaged using JDK `jpackage`.

- **Main Executable**: `D:\qbsg\qbsg.exe` (Windows launcher stub, 507 KB)
- **Application Bundle**: `D:\qbsg\app\composeApp-jvm.jar` (7.3 MB compiled bytecode)
- **Bundled Runtime**: `D:\qbsg\runtime` (OpenJDK 17.0.12 embedded JRE)
- **Configuration**: `D:\qbsg\app\qbsg.cfg` (`app.mainclass=qbsg.top.MainKt`)
- **Native Bridges**: JNA 5.14.0 for native Windows Bluetooth stack access.

---

## 2. Automation Interfaces Investigation

We performed static bytecode analysis and disassembled the relevant classes in `composeApp-jvm.jar`.

### 2.1 Command-Line Interface (CLI)
- **Inspection Target**: `qbsg.top.MainKt.main(args: Array<String>)`
- **Findings**: The `main` method simply initializes Compose Desktop `application { ... }` and launches the window. It **does not parse any command-line arguments** (e.g. `--upload`, `--image`, `-f`, `/?`, `--help`).
- **Conclusion**: **No CLI automation available.**

### 2.2 Local IPC / Network Sockets
- **Inspection Target**: Sockets, HTTP, WebSockets, Named Pipes
- **Findings**: The application includes Ktor HTTP client libraries (used for cloud sync / login), but **does not run any local HTTP server, WebSocket server, or named pipe listener** on `localhost`.
- **Conclusion**: **No local IPC / API automation available.**

### 2.3 Filesystem Watcher / Auto-Import
- **Inspection Target**: `java.nio.file.WatchService` / directory polling
- **Findings**: The application does not monitor any directory for incoming PNG/BMP images. Image uploads require explicit manual selection in the Compose UI file dialog.
- **Conclusion**: **No folder-watch automation available.**

---

## 3. Bluetooth Communication Analysis

The application directly communicates with the DA14585 E-Ink tag over Bluetooth Low Energy (BLE) via `qbsg.top.ble.JvmBleManager` and `qbsg.top.devices.pingping.PingpingEpdManager`.

- **Device GATT Services**:
  - `00001f10-0000-1000-8000-00805f9b34fb` (`0x1F10` — Primary EPD Service)
  - `00001f1f-0000-1000-8000-00805f9b34fb` (`0x1F1F` — EPD Upload Characteristic)
- **Encoding Scheme**: `PingpingEpdEncoder.canvas2bytes` generates dual 1-bit bitplanes ($15,000$ bytes BW plane + $15,000$ bytes Red plane = $30,000$ bytes total).
- **Command Protocol**: `$IMG(0,0)` followed by stream chunked to negotiated BLE MTU.

---

## 4. Final Conclusion & Strategic Path

- **Option A (Vendor App Automation)**: **UNSUPPORTED**  
  `qbsg.exe` provides no CLI flags, no local IPC, and no folder watcher. Attempting to automate the vendor GUI via UI automation (Win32 accessibility/clicks) is brittle and violates reliability principles.
- **Option B (Direct BLE Transport / Standalone Exporter)**: **RECOMMENDED & IMPLEMENTED**  
  1. **Primary Working Path**: Standalone high-density 400x300 PNG Export + "签变时光" manual upload (stable, reliable, preserves all existing capabilities).
  2. **Automated Path**: Native BLE transport (`Da14585BleTransport` / `PingpingBleTransport`) communicating directly with GATT `0x1F10` / `0x1F1F`.

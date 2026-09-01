# E-Ink Telemetry & GATT Protocol Specification

**Device**: Dialog Semiconductor DA14585 4.2-inch E-Ink Tag  
**Firmware Profile**: `PP_da14585_4.2` (`Pingping`)  
**Resolution**: 400x300 pixels (Tri-color: Black, White, Red)  
**Date**: September 2026  

---

## 1. GATT Services & Characteristics Map

Based on direct bytecode analysis of `qbsg.top.ble.JvmBleManager` and `qbsg.top.devices.pingping.PingpingEpdManager`:

| Service / Characteristic | UUID | Properties | Description |
| :--- | :--- | :--- | :--- |
| **EPD Service** | `00001f10-0000-1000-8000-00805f9b34fb` (`0x1F10`) | Primary | Main Image Upload Service |
| **EPD Data Characteristic** | `00001f1f-0000-1000-8000-00805f9b34fb` (`0x1F1F`) | Write / Write Without Response | Raw Bitplane Data Stream |
| **Control Service** | `7e400001-b5a3-f393-e0a9-e50e24dcca9e` | Primary | Vendor Control / Command Channel |
| **TX Characteristic** | `7e400002-b5a3-f393-e0a9-e50e24dcca9e` | Write / Notify | Command TX |
| **Control Characteristic** | `7e400003-b5a3-f393-e0a9-e50e24dcca9e` | Write | Command Control |
| **Model Number** | `00002a24-0000-1000-8000-00805f9b34fb` (`0x2A24`) | Read | Device Model String |
| **Firmware Revision** | `00002a26-0000-1000-8000-00805f9b34fb` (`0x2A26`) | Read | e.g. `PP_da14585_4.2` |

---

## 2. Image Bit-Plane Encoding Specification

For the 4.2-inch $400 \times 300$ tri-color panel ($120,000$ pixels):

1. **Pixel Packing**: 8 pixels per byte, Most Significant Bit (MSB) first.
2. **Channel 1 (Black/White Plane)**:
   - Size: $400 \times 300 / 8 = 15,000$ bytes.
   - Bit `0` = Black, Bit `1` = White.
3. **Channel 2 (Red Plane)**:
   - Size: $400 \times 300 / 8 = 15,000$ bytes.
   - Bit `1` = Red, Bit `0` = Non-Red (Black/White).
4. **Total Payload**: $30,000$ bytes ($15,000$ B/W + $15,000$ Red).
5. **Header**: ASCII `$IMG(0,0)` (Hex: `24 49 4d 47 28 30 2c 30 29`).
6. **Transmission**: Streamed in chunks matching the BLE negotiated MTU (typically 20 bytes to 244 bytes) to Characteristic `0x1F1F`.

---

## 3. Telemetry Findings & Classification

We comprehensively searched the entire vendor codebase (`composeApp-jvm.jar`) for Battery Service (`0x180F`), Battery Level (`0x2A19`), Temperature Service (`0x1809`), and custom ADC read commands.

### 3.1 Battery Status: **HOST-READABLE TELEMETRY UNVERIFIED**
- The `PP_da14585_4.2` firmware is an ultra-low power passive display receiver.
- Neither standard Battery Service `0x180F` nor vendor battery telemetry commands exist in the firmware or client code.
- **Classification**: `HOST-READABLE TELEMETRY UNVERIFIED`.

### 3.2 Temperature Status: **HOST-READABLE TELEMETRY UNVERIFIED**
- The tag does not integrate a digital thermometer or environmental sensing characteristic over GATT.
- **Classification**: `HOST-READABLE TELEMETRY UNVERIFIED`.

---

## 4. UI & Data Model Telemetry Rules

To ensure strict engineering integrity and prevent misleading the user:

1. `EinkSnapshot` includes `batteryPercent?: number | null` and `temperatureC?: number | null`.
2. When telemetry is `null` / `undefined`, the UI renders `B--` and `T--` (or hides them gracefully).
3. **No mock / synthetic battery or temperature values are ever rendered**.

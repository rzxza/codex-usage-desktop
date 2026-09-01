# Pingping E-Ink (PP_da14585_4.2) BLE Sequence Specification

## 1. Overview & Hardware Identity
- **MCU**: Dialog Semiconductor DA14585 (ARM Cortex-M0).
- **Display**: 4.2-inch 400x300 Tri-Color (Black, White, Red) E-Ink Screen.
- **Firmware Family**: `PP_da14585_4.2` (vendor designation "Pingping").
- **Vendor Client**: 签变时光 (`qbsg.exe`, Compose Multiplatform Desktop / Kotlin JVM).

---

## 2. GATT Services & Characteristics

| Purpose | Service UUID | Characteristic UUID | Properties | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **EPD Image Channel** | `00001f10-0000-1000-8000-00805f9b34fb` (`0x1F10`) | `00001f1f-0000-1000-8000-00805f9b34fb` (`0x1F1F`) | Write Without Response / Write | Primary streaming channel for image frame |
| **Control / Command Channel** | `7e400001-b5a3-f393-e0a9-e50e24dcca9e` | `7e400002-b5a3-f393-e0a9-e50e24dcca9e` | Write / Notify | Peripheral command channel (text/phone/countdown) |
| **Model Info** | `0000180a-0000-1000-8000-00805f9b34fb` | `00002a24-0000-1000-8000-00805f9b34fb` | Read | Returns `PP_da14585_4.2` |
| **Firmware Revision** | `0000180a-0000-1000-8000-00805f9b34fb` | `00002a26-0000-1000-8000-00805f9b34fb` | Read | Version string |

---

## 3. Protocol Q&A Analysis (Decompiled Bytecode Evidence)

### A. Characteristic for `$IMG(0,0)`
- Written to **EPD Characteristic `00001f1f-0000-1000-8000-00805f9b34fb` (`0x1F1F`)**.

### B. Header and Payload Stream
- **Unified Stream**: The 9-byte ASCII header `$IMG(0,0)` and the 30,000-byte dual-plane binary payload are transmitted as one contiguous streaming sequence over `0x1F1F`.

### C. Write Type
- **Write Without Response** (`writeWithoutResponse`) for maximum BLE streaming throughput.

### D. MTU Chunk Size Calculation
- Chunk size is calculated dynamically as **`negotiatedMtu - 3`** (e.g. $247 - 3 = 244$ bytes under Windows BLE, or default $20$ bytes if MTU exchange is unnegotiated).

### E. Frame & Bit-Plane Encoding
- Total pixels: $400 	imes 300 = 120,000$ pixels.
- 8 pixels per byte, **MSB first**:
  - **Plane 1 (Black/White Plane)**: 15,000 bytes.
    - White ($0$): bit = 1
    - Black ($1$): bit = 0
    - Red ($2$): bit = 1
  - **Plane 2 (Red Plane)**: 15,000 bytes.
    - White ($0$): bit = 0
    - Black ($1$): bit = 0
    - Red ($2$): bit = 1
- Combined Payload: exactly 30,000 bytes (`BW_Plane || Red_Plane`).

### F. Completion & Refresh Sequence
- After the final chunk of the 30,000 bytes is written to `0x1F1F`, the DA14585 onboard firmware automatically initiates the physical E-Ink refresh cycle (approx. 2.5~3.5s).
- No auxiliary refresh command is required on the EPD channel.

### G. Is `7e400001` Control Service Required for Image Upload?
- **No.** Image upload is fully self-contained within the EPD GATT service (`0x1F10` / `0x1F1F`).

---

## 4. End-to-End Upload Workflow

```
Client (Codex Usage Desktop)                     Device (DA14585 E-Ink Tag)
          |                                                  |
          |-------- Scan for BLE Service 0x1F10 ------------>|
          |<------- Advertisement (NRF-xxxxxx / PP_...) -----|
          |                                                  |
          |-------- Connect GATT --------------------------->|
          |<------- Connection Established ------------------|
          |                                                  |
          |-------- Request MTU (e.g. 247) ----------------->|
          |<------- MTU Negotiated (chunk = MTU - 3) --------|
          |                                                  |
          |-------- Write Header "$IMG(0,0)" (0x1F1F) ------>|
          |-------- Write Chunk 0..N (0x1F1F) -------------->| (Pacing 5~10ms)
          |-------- Write Final Chunk (0x1F1F) ------------->|
          |                                                  |
          |                                       [Screen Refreshing]
          |                                                  |
          |-------- Disconnect ----------------------------->|
```

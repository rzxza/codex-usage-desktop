# DA14585 4.2" E-Ink Integration Notes

## Device / Firmware

- Size: 4.2 inch
- Resolution: 400 x 300
- Colors: Black / White / Red (tri-color)
- MCU: DA14585
- Firmware family: `PP_da14585_4.2`
- Seller client: “签变时光” (Windows client)

## Constraints (do not violate)

- Do not flash third-party firmware.
- Do not modify the DA14585 firmware.
- Do not bypass or crack device activation.
- Do not hardcode a user's device MAC/name.
- Prefer the seller's legitimate image-upload path for the first delivery.

## Status

| Area | Status |
| --- | --- |
| E-Ink Snapshot | Implemented (`src/eink`) |
| 400x300 renderer | Implemented |
| Tri-color quantization | Implemented and tested |
| Manual export / preview | Implemented as transport + renderer |
| Direct BLE transport | **PENDING — protocol discovery** |
| “签变时光” CLI / IPC investigation | **PENDING — no public EXE/API available in this environment** |

## Observed Upload Path (Manual)

1. Generate a 400x300 PNG (only `#FFFFFF`, `#000000`, `#FF0000`).
2. Open “签变时光” Windows client.
3. Connect to the actual DA14585 device.
4. Use the client's image upload feature to push the PNG.
5. Confirm orientation, colors, Chinese text legibility, and no cropping.

This path is fully supported by `ManualExportTransport` and does not require any BLE knowledge.

## BLE Protocol Investigation

No reliable protocol information has been obtained yet.

What is still unknown:

- Service UUID
- Characteristic UUID(s)
- MTU
- Write mode (with/without response)
- Packet size and header/frame index
- Checksum / ACK
- Refresh command
- Whether the seller client exposes a local HTTP/WebSocket/IPC endpoint or CLI arguments

### Allowed future investigation steps

1. If a publicly downloadable “签变时光” EXE is available, inspect:
   - `--help`, `/?`, file associations, upload command-line arguments
   - Local HTTP/WebSocket/IPC ports while the app is running
2. Use normal BLE sniffing/observation of the seller client's connection to the DA14585 (no firmware patching, no activation bypass).
3. Only after the GATT services, characteristics, and packet format are reliably known, implement `Da14585EinkTransport`.

## Next Steps

- Obtain a legitimate copy of the seller client for CLI/IPC inspection.
- Capture BLE traffic (service/characteristic UUIDs, packet framing, ACK).
- Validate manual PNG upload on real hardware.
- If upload format differs (e.g. BMP/RLE), adjust the exporter before touching firmware.
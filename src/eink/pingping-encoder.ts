import { EINK_HEIGHT, EINK_WIDTH } from "./renderer";
import type { EinkPixelMatrix } from "./types";

export const PINGPING_PLANE_BYTES = 15000;
export const PINGPING_PAYLOAD_BYTES = 30000;
export const PINGPING_HEADER_ASCII = "$IMG(0,0)";

export type PingpingFrame = {
  header: Uint8Array;
  payload: Uint8Array;
};

/**
 * Encodes a 400x300 tri-color EinkPixelMatrix into the exact Pingping DA14585 dual-plane format.
 *
 * Bit-plane color encoding (MSB first, 8 pixels per byte):
 * - White (0): BW bit = 1, Red bit = 0
 * - Black (1): BW bit = 0, Red bit = 0
 * - Red   (2): BW bit = 1, Red bit = 1
 *
 * Output:
 * - header: ASCII "$IMG(0,0)" (9 bytes)
 * - payload: exactly 30,000 bytes (15,000 bytes B/W plane + 15,000 bytes Red plane)
 */
export function encodePingpingFrame(matrix: EinkPixelMatrix): PingpingFrame {
  const header = new TextEncoder().encode(PINGPING_HEADER_ASCII);
  const payload = new Uint8Array(PINGPING_PAYLOAD_BYTES);

  const bwPlane = payload.subarray(0, PINGPING_PLANE_BYTES);
  const redPlane = payload.subarray(PINGPING_PLANE_BYTES, PINGPING_PAYLOAD_BYTES);

  let byteIndex = 0;
  let bitCount = 0;
  let currentBwByte = 0;
  let currentRedByte = 0;

  for (let y = 0; y < EINK_HEIGHT; y += 1) {
    const row = matrix[y];
    for (let x = 0; x < EINK_WIDTH; x += 1) {
      const pixel = row?.[x] ?? 0;

      let bwBit = 0;
      let redBit = 0;

      if (pixel === 0) {
        // White
        bwBit = 1;
        redBit = 0;
      } else if (pixel === 1) {
        // Black
        bwBit = 0;
        redBit = 0;
      } else if (pixel === 2) {
        // Red
        bwBit = 1;
        redBit = 1;
      }

      currentBwByte = (currentBwByte << 1) | bwBit;
      currentRedByte = (currentRedByte << 1) | redBit;
      bitCount += 1;

      if (bitCount === 8) {
        bwPlane[byteIndex] = currentBwByte;
        redPlane[byteIndex] = currentRedByte;
        byteIndex += 1;
        bitCount = 0;
        currentBwByte = 0;
        currentRedByte = 0;
      }
    }
  }

  return { header, payload };
}

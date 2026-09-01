// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { encodePingpingFrame, PINGPING_PAYLOAD_BYTES, PINGPING_PLANE_BYTES } from "./encoder";
import { emptyMatrix, EINK_HEIGHT, EINK_WIDTH } from "./renderer";
import type { EinkPixelMatrix } from "./types";

describe("Pingping 400x300 Encoder", () => {
  it("encodes header as ASCII $IMG(0,0)", () => {
    const matrix = emptyMatrix();
    const { header } = encodePingpingFrame(matrix);
    const headerStr = new TextDecoder().decode(header);
    expect(headerStr).toBe("$IMG(0,0)");
    expect(header.length).toBe(9);
  });

  it("produces a payload of exactly 30,000 bytes", () => {
    const matrix = emptyMatrix();
    const { payload } = encodePingpingFrame(matrix);
    expect(payload.length).toBe(PINGPING_PAYLOAD_BYTES);
  });

  it("encodes all white matrix correctly (BW plane 0xFF, Red plane 0x00)", () => {
    const matrix = emptyMatrix(); // all 0 (white)
    const { payload } = encodePingpingFrame(matrix);
    const bwPlane = payload.subarray(0, PINGPING_PLANE_BYTES);
    const redPlane = payload.subarray(PINGPING_PLANE_BYTES, PINGPING_PAYLOAD_BYTES);

    expect(bwPlane.every((b) => b === 0xff)).toBe(true);
    expect(redPlane.every((b) => b === 0x00)).toBe(true);
  });

  it("encodes all black matrix correctly (BW plane 0x00, Red plane 0x00)", () => {
    const matrix: EinkPixelMatrix = Array.from({ length: EINK_HEIGHT }, () =>
      new Array(EINK_WIDTH).fill(1),
    );
    const { payload } = encodePingpingFrame(matrix);
    const bwPlane = payload.subarray(0, PINGPING_PLANE_BYTES);
    const redPlane = payload.subarray(PINGPING_PLANE_BYTES, PINGPING_PAYLOAD_BYTES);

    expect(bwPlane.every((b) => b === 0x00)).toBe(true);
    expect(redPlane.every((b) => b === 0x00)).toBe(true);
  });

  it("encodes all red matrix correctly (BW plane 0xFF, Red plane 0xFF)", () => {
    const matrix: EinkPixelMatrix = Array.from({ length: EINK_HEIGHT }, () =>
      new Array(EINK_WIDTH).fill(2),
    );
    const { payload } = encodePingpingFrame(matrix);
    const bwPlane = payload.subarray(0, PINGPING_PLANE_BYTES);
    const redPlane = payload.subarray(PINGPING_PLANE_BYTES, PINGPING_PAYLOAD_BYTES);

    expect(bwPlane.every((b) => b === 0xff)).toBe(true);
    expect(redPlane.every((b) => b === 0xff)).toBe(true);
  });

  it("encodes known 8-pixel pattern accurately", () => {
    // Pattern: [White (0), Black (1), Red (2), White (0), Black (1), Black (1), Red (2), Red (2)]
    // BW bits:   1          0          1        1          0          0        1        1  => 0b10110011 = 0xB3 = 179
    // Red bits:  0          0          1        0          0          0        1        1  => 0b00100011 = 0x23 = 35
    const matrix = emptyMatrix();
    matrix[0][0] = 0;
    matrix[0][1] = 1;
    matrix[0][2] = 2;
    matrix[0][3] = 0;
    matrix[0][4] = 1;
    matrix[0][5] = 1;
    matrix[0][6] = 2;
    matrix[0][7] = 2;

    const { payload } = encodePingpingFrame(matrix);
    expect(payload[0]).toBe(0xb3);
    expect(payload[PINGPING_PLANE_BYTES]).toBe(0x23);
  });

  it("verifies first and last pixel ordering (MSB first, LSB last)", () => {
    const matrix = emptyMatrix(); // All white (0xFF / 0x00)

    // Set first pixel (0,0) to Black (1) -> BW bit should become 0 at bit 7
    // 0xFF with bit 7 cleared is 0x7F
    matrix[0][0] = 1;

    // Set last pixel (399, 299) to Red (2) ->
    // Last byte is index 14999.
    // In BW plane: bit 0 is 1 (0xFF)
    // In Red plane: bit 0 becomes 1 (0x01)
    matrix[299][399] = 2;

    const { payload } = encodePingpingFrame(matrix);

    // Byte 0:
    expect(payload[0]).toBe(0x7f); // MSB cleared
    expect(payload[PINGPING_PLANE_BYTES]).toBe(0x00);

    // Last byte (index 14999):
    expect(payload[PINGPING_PLANE_BYTES - 1]).toBe(0xff);
    expect(payload[PINGPING_PAYLOAD_BYTES - 1]).toBe(0x01); // LSB set
  });

  it("respects row boundary from column 399 to column 400 (next row 0)", () => {
    const matrix = emptyMatrix();

    // Column 399 of row 0 is byte index 49 (bit 0)
    // Column 0 of row 1 is byte index 50 (bit 7)
    matrix[0][399] = 1; // Black at row 0 end -> byte 49 bit 0 cleared (0xFE)
    matrix[1][0] = 2;   // Red at row 1 start -> byte 50 in red plane bit 7 set (0x80)

    const { payload } = encodePingpingFrame(matrix);

    expect(payload[49]).toBe(0xfe);
    expect(payload[50]).toBe(0xff);
    expect(payload[PINGPING_PLANE_BYTES + 49]).toBe(0x00);
    expect(payload[PINGPING_PLANE_BYTES + 50]).toBe(0x80);
  });
});

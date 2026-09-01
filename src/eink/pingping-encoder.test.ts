// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { encodePingpingFrame, PINGPING_PAYLOAD_BYTES, PINGPING_PLANE_BYTES } from "./pingping-encoder";
import { emptyMatrix, EINK_HEIGHT, EINK_WIDTH } from "./renderer";
import type { EinkPixelMatrix } from "./types";

describe("Pingping 400x300 Raw Encoder Golden Tests", () => {
  it("payload_exact_30000", () => {
    const matrix = emptyMatrix();
    const { header, payload } = encodePingpingFrame(matrix);
    expect(payload.length).toBe(30000);
    expect(payload.length).toBe(PINGPING_PAYLOAD_BYTES);
    expect(new TextDecoder().decode(header)).toBe("$IMG(0,0)");
  });

  it("all_white_golden", () => {
    const matrix = emptyMatrix(); // all 0 (white)
    const { payload } = encodePingpingFrame(matrix);
    const bwPlane = payload.subarray(0, PINGPING_PLANE_BYTES);
    const redPlane = payload.subarray(PINGPING_PLANE_BYTES, PINGPING_PAYLOAD_BYTES);

    expect(bwPlane.every((b) => b === 0xff)).toBe(true);
    expect(redPlane.every((b) => b === 0x00)).toBe(true);
  });

  it("all_black_golden", () => {
    const matrix: EinkPixelMatrix = Array.from({ length: EINK_HEIGHT }, () =>
      new Array(EINK_WIDTH).fill(1),
    );
    const { payload } = encodePingpingFrame(matrix);
    const bwPlane = payload.subarray(0, PINGPING_PLANE_BYTES);
    const redPlane = payload.subarray(PINGPING_PLANE_BYTES, PINGPING_PAYLOAD_BYTES);

    expect(bwPlane.every((b) => b === 0x00)).toBe(true);
    expect(redPlane.every((b) => b === 0x00)).toBe(true);
  });

  it("all_red_golden", () => {
    const matrix: EinkPixelMatrix = Array.from({ length: EINK_HEIGHT }, () =>
      new Array(EINK_WIDTH).fill(2),
    );
    const { payload } = encodePingpingFrame(matrix);
    const bwPlane = payload.subarray(0, PINGPING_PLANE_BYTES);
    const redPlane = payload.subarray(PINGPING_PLANE_BYTES, PINGPING_PAYLOAD_BYTES);

    expect(bwPlane.every((b) => b === 0xff)).toBe(true);
    expect(redPlane.every((b) => b === 0xff)).toBe(true);
  });

  it("known_8_pixel_pattern", () => {
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

  it("msb_first", () => {
    const matrix = emptyMatrix();
    matrix[0][0] = 1; // Black at first pixel (bit 7)
    const { payload } = encodePingpingFrame(matrix);
    expect(payload[0]).toBe(0x7f); // MSB cleared in BW
  });

  it("row_boundary_399_400", () => {
    const matrix = emptyMatrix();
    matrix[0][399] = 1; // Black at row 0 end -> byte 49 bit 0 cleared (0xFE)
    matrix[1][0] = 2;   // Red at row 1 start -> byte 50 in red plane bit 7 set (0x80)

    const { payload } = encodePingpingFrame(matrix);

    expect(payload[49]).toBe(0xfe);
    expect(payload[50]).toBe(0xff);
    expect(payload[PINGPING_PLANE_BYTES + 49]).toBe(0x00);
    expect(payload[PINGPING_PLANE_BYTES + 50]).toBe(0x80);
  });

  it("last_pixel", () => {
    const matrix = emptyMatrix();
    matrix[299][399] = 2; // Red at last pixel
    const { payload } = encodePingpingFrame(matrix);

    expect(payload[PINGPING_PLANE_BYTES - 1]).toBe(0xff);
    expect(payload[PINGPING_PAYLOAD_BYTES - 1]).toBe(0x01); // LSB set in Red plane
  });
});

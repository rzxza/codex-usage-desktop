import type { EinkPixel, EinkPixelMatrix, EinkSnapshot } from "./types";

export const EINK_WIDTH = 400;
export const EINK_HEIGHT = 300;
export const EINK_COLORS = {
  0: "#FFFFFF",
  1: "#000000",
  2: "#FF0000",
} as const;

export function emptyMatrix(): EinkPixelMatrix {
  return Array.from({ length: EINK_HEIGHT }, () =>
    Array.from({ length: EINK_WIDTH }, () => 0 as EinkPixel),
  );
}

/**
 * Pure layout skeleton used by unit tests and by the canvas renderer as the
 * deterministic pixel basis. It intentionally contains no text glyphs; those
 * are layered by `renderEinkCanvas` and then quantized to the three-color
 * palette by `quantizeImageData`.
 */
export function renderSkeleton(snapshot: EinkSnapshot): EinkPixelMatrix {
  const matrix = emptyMatrix();

  fillRect(matrix, 0, 0, EINK_WIDTH, 12, 1);
  fillRect(matrix, 8, 2, 90, 8, 0);
  fillRect(matrix, 8, 2, 80, 4, 1);

  const quota = snapshot.quotaRemainingPercent;
  const quotaValue = clamp(quota ?? 0, 0, 100);
  const high = quota === null || quota > 15;
  const color: EinkPixel = high ? 1 : 2;
  fillRect(matrix, 16, 30, Math.round((quotaValue / 100) * 300), 18, color);
  fillRect(matrix, 16, 30, 300, 18, 0);
  fillRect(matrix, 16, 30, Math.round((quotaValue / 100) * 300), 18, color);

  const resetStatus = snapshot.resetSignalStatus;
  if (resetStatus === "scheduled" || resetStatus === "likely") {
    fillRect(matrix, 16, 60, 120, 10, 2);
  }

  if (snapshot.sevenDayCredits !== null) {
    fillRect(matrix, 16, 90, 160, 8, 1);
    fillRect(matrix, 16, 102, 100, 8, 1);
  }
  if (snapshot.thirtyDayCredits !== null) {
    fillRect(matrix, 16, 130, 180, 8, 1);
  }
  if (snapshot.sevenDayDeltaPercent !== null) {
    fillRect(matrix, 16, 150, 60, 8, 1);
    fillRect(matrix, 200, 150, 20, 8, 2);
  }

  // 7-day sparkline bars in the final row area.
  const barWidth = 30;
  const gap = 12;
  const startX = 16;
  const startY = 210;
  const maxBar = 50;
  for (let i = 0; i < 7; i += 1) {
    const height = Math.max(4, Math.round(Math.abs(Math.sin(i * 1.7) * maxBar)));
    fillRect(matrix, startX + i * (barWidth + gap), startY + maxBar - height, barWidth, height, 1);
  }

  if (quota !== null && quota <= 15) {
    fillRect(matrix, 16, 270, 60, 8, 2);
  } else {
    fillRect(matrix, 16, 270, 60, 8, 1);
  }

  return matrix;
}

export function quantizeImageData(imageData: ImageData): EinkPixelMatrix {
  const { width, height, data } = imageData;
  const matrix = emptyMatrix();
  for (let y = 0; y < Math.min(height, EINK_HEIGHT); y += 1) {
    for (let x = 0; x < Math.min(width, EINK_WIDTH); x += 1) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const alpha = data[offset + 3];
      if (alpha < 128) {
        matrix[y][x] = 0;
      } else if (r > 128 && r > g * 1.4 && r > b * 1.4) {
        matrix[y][x] = 2;
      } else {
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        matrix[y][x] = luminance < 128 ? 1 : 0;
      }
    }
  }
  return matrix;
}

export function matrixHasColor(matrix: EinkPixelMatrix, color: EinkPixel): boolean {
  return matrix.some((row) => row.includes(color));
}

export function createCanvasFromMatrix(matrix: EinkPixelMatrix): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = EINK_WIDTH;
  canvas.height = EINK_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  const imageData = ctx.createImageData(EINK_WIDTH, EINK_HEIGHT);
  for (let y = 0; y < EINK_HEIGHT; y += 1) {
    for (let x = 0; x < EINK_WIDTH; x += 1) {
      const offset = (y * EINK_WIDTH + x) * 4;
      const hex = EINK_COLORS[matrix[y]?.[x] ?? 0];
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      imageData.data[offset] = r;
      imageData.data[offset + 1] = g;
      imageData.data[offset + 2] = b;
      imageData.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export function renderEinkCanvas(snapshot: EinkSnapshot): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = EINK_WIDTH;
  canvas.height = EINK_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, EINK_WIDTH, EINK_HEIGHT);

  // Draw the deterministic skeleton first, then text on top so text is visible.
  const skeleton = renderSkeleton(snapshot);
  const skeletonCanvas = createCanvasFromMatrix(skeleton);
  ctx.drawImage(skeletonCanvas, 0, 0);

  ctx.fillStyle = "#000000";
  ctx.font = "16px 'Microsoft YaHei', 'Segoe UI', sans-serif";
  ctx.fillText("CODEX MONITOR", 12, 22);
  ctx.font = "12px 'Microsoft YaHei', 'Segoe UI', sans-serif";

  if (snapshot.quotaRemainingPercent !== null) {
    ctx.fillStyle = snapshot.quotaRemainingPercent <= 15 ? "#FF0000" : "#000000";
    ctx.fillText(`Current ${Math.round(snapshot.quotaRemainingPercent)}%`, 12, 50);
  }
  if (snapshot.sevenDayCredits !== null) {
    ctx.fillStyle = "#000000";
    ctx.fillText(`7D ${snapshot.sevenDayCredits.toFixed(0)}`, 12, 90);
  }
  if (snapshot.thirtyDayCredits !== null) {
    ctx.fillText(`30D ${snapshot.thirtyDayCredits.toFixed(0)}`, 12, 120);
  }
  if (snapshot.sevenDayDeltaPercent !== null) {
    ctx.fillStyle = "#000000";
    ctx.fillText(`vs prev 7d ${snapshot.sevenDayDeltaPercent >= 0 ? "+" : ""}${snapshot.sevenDayDeltaPercent.toFixed(1)}%`, 12, 150);
  }
  if (snapshot.resetSignalStatus) {
    ctx.fillStyle = snapshot.resetSignalStatus === "scheduled" || snapshot.resetSignalStatus === "likely" ? "#FF0000" : "#000000";
    ctx.fillText(`RESET ${snapshot.resetSignalStatus.toUpperCase()}`, 12, 180);
  }

  return canvas;
}

export function quantizeCanvas(canvas: HTMLCanvasElement): EinkPixelMatrix {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  const imageData = ctx.getImageData(0, 0, EINK_WIDTH, EINK_HEIGHT);
  return quantizeImageData(imageData);
}

export async function snapshotToPngBlob(snapshot: EinkSnapshot): Promise<Blob> {
  const canvas = renderEinkCanvas(snapshot);
  const matrix = quantizeCanvas(canvas);
  const quantized = createCanvasFromMatrix(matrix);
  return await new Promise<Blob>((resolve, reject) => {
    quantized.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to encode E-Ink PNG"));
    }, "image/png");
  });
}

function fillRect(
  matrix: EinkPixelMatrix,
  x: number,
  y: number,
  width: number,
  height: number,
  color: EinkPixel,
) {
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const px = x + i;
      const py = y + j;
      if (py >= 0 && py < EINK_HEIGHT && px >= 0 && px < EINK_WIDTH) {
        matrix[py][px] = color;
      }
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
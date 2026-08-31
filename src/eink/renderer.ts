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
 * Pure layout skeleton used as the deterministic pixel basis and by unit tests.
 * All shapes, bars, 7D series lines/markers, and warning highlights are drawn here.
 */
export function renderSkeleton(snapshot: EinkSnapshot): EinkPixelMatrix {
  const matrix = emptyMatrix();

  // Header separator
  fillRect(matrix, 16, 32, 368, 2, 1);

  // Quota bar (x: 16, y: 60, w: 368, h: 12)
  const quota = snapshot.quotaRemainingPercent;
  const quotaValue = clamp(quota ?? 0, 0, 100);
  const quotaIsLow = quota !== null && quota <= 15;
  const quotaColor: EinkPixel = quotaIsLow ? 2 : 1;

  // Bar outline
  drawHollowBox(matrix, 16, 60, 368, 12, 1);
  if (quotaValue > 0) {
    const fillW = Math.round((quotaValue / 100) * 364);
    fillRect(matrix, 18, 62, fillW, 8, quotaColor);
  }

  // Credits section separator
  fillRect(matrix, 16, 96, 368, 1, 1);

  // Subtitle card count
  if (snapshot.resetCardCount > 0) {
    fillRect(matrix, 160, 84, Math.min(40, snapshot.resetCardCount * 6), 4, 1);
  }

  // Latest complete day credits representation
  if (snapshot.latestCompleteCredits !== null) {
    const lcW = Math.min(50, Math.round((snapshot.latestCompleteCredits / 1000) * 4));
    fillRect(matrix, 60, 114, lcW, 4, 1);
  }

  // 7D Credits representation
  if (snapshot.sevenDayCredits !== null) {
    const c7W = Math.min(50, Math.round((snapshot.sevenDayCredits / 1000) * 2));
    fillRect(matrix, 45, 138, c7W, 4, 1);
  }

  // 7D Coverage highlight (red if incomplete)
  const cov7 = snapshot.sevenDayCoverage;
  const cov7Incomplete = cov7.completeDays < cov7.expectedDays;
  if (cov7Incomplete) {
    fillRect(matrix, 110, 132, 30, 8, 2);
  } else if (snapshot.sevenDayCredits !== null) {
    fillRect(matrix, 110, 132, 30, 8, 1);
  }

  // 30D Coverage highlight (red if incomplete)
  const cov30 = snapshot.thirtyDayCoverage;
  const cov30Incomplete = cov30.completeDays < cov30.expectedDays;
  if (cov30Incomplete) {
    fillRect(matrix, 110, 154, 35, 8, 2);
  } else if (snapshot.thirtyDayCredits !== null) {
    fillRect(matrix, 110, 154, 35, 8, 1);
  }

  // 7D Trend: 7 calendar slots with solid dots (known) and hollow dots (missing)
  const series = snapshot.sevenDaySeries;
  if (series.length > 0) {
    const knownValues = series
      .map((s) => s.credits)
      .filter((c): c is number => c !== null);
    const minC = knownValues.length > 0 ? Math.min(...knownValues) : 0;
    const maxC = knownValues.length > 0 ? Math.max(...knownValues) : 1;

    const points: Array<{ x: number; y: number; known: boolean }> = [];
    for (let i = 0; i < Math.min(7, series.length); i += 1) {
      const x = 210 + i * 24;
      const cr = series[i].credits;
      let y = 135;
      if (cr !== null) {
        if (maxC > minC) {
          y = 145 - Math.round(((cr - minC) / (maxC - minC)) * 24);
        } else {
          y = 135;
        }
        points.push({ x, y, known: true });
      } else {
        points.push({ x, y: 135, known: false });
      }
    }

    // Connect ONLY consecutive known points
    for (let i = 0; i < points.length - 1; i += 1) {
      if (points[i].known && points[i + 1].known) {
        drawLine(matrix, points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, 1);
      }
    }

    // Draw markers for all 7 points
    for (const pt of points) {
      if (pt.known) {
        fillRect(matrix, pt.x - 2, pt.y - 2, 5, 5, 1);
      } else {
        drawHollowBox(matrix, pt.x - 2, pt.y - 2, 5, 5, 1);
      }
    }
  }

  // Reset Signal section
  fillRect(matrix, 16, 172, 368, 1, 1);
  const resetStatus = snapshot.resetSignalStatus;
  if (resetStatus === "scheduled" || resetStatus === "likely") {
    const confW = snapshot.resetSignalConfidence
      ? Math.round(snapshot.resetSignalConfidence * 40)
      : 0;
    fillRect(matrix, 16, 190, 140 + confW, 14, 2);
  } else if (resetStatus === "completed") {
    fillRect(matrix, 16, 190, 100, 14, 1);
  } else if (resetStatus === "unavailable") {
    fillRect(matrix, 16, 190, 160, 14, 2);
  }

  // Footer separator
  fillRect(matrix, 16, 255, 368, 1, 1);

  // Warning indicator at bottom right
  if (quotaIsLow || cov7Incomplete || cov30Incomplete) {
    fillRect(matrix, 372, 270, 8, 8, 2);
  }

  return matrix;
}

export function renderEinkMatrix(snapshot: EinkSnapshot): EinkPixelMatrix {
  if (typeof document !== "undefined") {
    try {
      const canvas = renderEinkCanvas(snapshot);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        return quantizeCanvas(canvas);
      }
    } catch {
      // Fallback to pure matrix renderer
    }
  }
  return renderSkeleton(snapshot);
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
  if (!ctx) {
    return canvas;
  }

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, EINK_WIDTH, EINK_HEIGHT);

  // 1. Header
  ctx.fillStyle = "#000000";
  ctx.font = "bold 15px 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";
  ctx.fillText("CODEX MONITOR", 16, 24);
  ctx.font = "bold 12px 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";
  ctx.fillText("CODEX", 345, 24);
  ctx.fillRect(16, 32, 368, 2);

  // 2. Quota Section
  ctx.font = "bold 12px 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";
  ctx.fillText("QUOTA", 16, 52);

  const quota = snapshot.quotaRemainingPercent;
  const quotaIsLow = quota !== null && quota <= 15;
  if (quota !== null) {
    ctx.fillStyle = quotaIsLow ? "#FF0000" : "#000000";
    ctx.font = "bold 18px 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";
    ctx.fillText(`${Math.round(quota)}%`, 345, 52);
  }

  // Bar outline and fill
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 1;
  ctx.strokeRect(16, 60, 368, 12);
  if (quota !== null && quota > 0) {
    ctx.fillStyle = quotaIsLow ? "#FF0000" : "#000000";
    ctx.fillRect(18, 62, Math.round((clamp(quota, 0, 100) / 100) * 364), 8);
  }

  // Subtitle
  ctx.fillStyle = "#000000";
  ctx.font = "11px 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";
  const cardStr = `Card x${snapshot.resetCardCount}`;
  const resetStr = snapshot.quotaResetAt ? `Reset in ${formatCountdown(snapshot.quotaResetAt)}` : "";
  ctx.fillText([resetStr, cardStr].filter(Boolean).join(" · "), 16, 86);

  // 3. Credits Section (Left Column)
  ctx.fillRect(16, 96, 368, 1);
  ctx.font = "11px 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";
  const lastDate = snapshot.latestCompleteDate ? `LAST ${formatDateShort(snapshot.latestCompleteDate)}` : "LAST --";
  const lastCredits = snapshot.latestCompleteCredits !== null ? formatCreditsShort(snapshot.latestCompleteCredits) : "--";
  ctx.fillText(lastDate, 16, 116);
  ctx.font = "bold 13px 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";
  ctx.fillText(lastCredits, 110, 116);

  // 7D Credits + Coverage
  ctx.font = "11px 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";
  ctx.fillText("7D", 16, 138);
  const c7 = snapshot.sevenDayCredits !== null ? formatCreditsShort(snapshot.sevenDayCredits) : "--";
  ctx.font = "bold 13px 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";
  ctx.fillText(c7, 45, 138);
  const cov7 = snapshot.sevenDayCoverage;
  const cov7Incomplete = cov7.completeDays < cov7.expectedDays;
  ctx.fillStyle = cov7Incomplete ? "#FF0000" : "#000000";
  ctx.font = "11px 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";
  ctx.fillText(`${cov7.completeDays}/${cov7.expectedDays}${cov7Incomplete ? " !" : ""}`, 110, 138);

  // 30D Credits + Coverage
  ctx.fillStyle = "#000000";
  ctx.fillText("30D", 16, 160);
  const c30 = snapshot.thirtyDayCredits !== null ? formatCreditsShort(snapshot.thirtyDayCredits) : "--";
  ctx.font = "bold 13px 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";
  ctx.fillText(c30, 45, 160);
  const cov30 = snapshot.thirtyDayCoverage;
  const cov30Incomplete = cov30.completeDays < cov30.expectedDays;
  ctx.fillStyle = cov30Incomplete ? "#FF0000" : "#000000";
  ctx.font = "11px 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";
  ctx.fillText(`${cov30.completeDays}/${cov30.expectedDays}${cov30Incomplete ? " !" : ""}`, 110, 160);

  // 4. 7D Trend (Right Column)
  ctx.fillStyle = "#000000";
  ctx.font = "bold 11px 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";
  ctx.fillText("7D TREND", 195, 114);

  const series = snapshot.sevenDaySeries;
  if (series.length > 0) {
    const knownValues = series
      .map((s) => s.credits)
      .filter((c): c is number => c !== null);
    const minC = knownValues.length > 0 ? Math.min(...knownValues) : 0;
    const maxC = knownValues.length > 0 ? Math.max(...knownValues) : 1;

    const points: Array<{ x: number; y: number; known: boolean }> = [];
    for (let i = 0; i < Math.min(7, series.length); i += 1) {
      const x = 200 + i * 26;
      const cr = series[i].credits;
      let y = 135;
      if (cr !== null) {
        if (maxC > minC) {
          y = 148 - Math.round(((cr - minC) / (maxC - minC)) * 26);
        } else {
          y = 135;
        }
        points.push({ x, y, known: true });
      } else {
        points.push({ x, y: 135, known: false });
      }
    }

    // Lines across consecutive known points
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    for (let i = 0; i < points.length - 1; i += 1) {
      if (points[i].known && points[i + 1].known) {
        ctx.beginPath();
        ctx.moveTo(points[i].x, points[i].y);
        ctx.lineTo(points[i + 1].x, points[i + 1].y);
        ctx.stroke();
      }
    }

    // Dots
    for (const pt of points) {
      if (pt.known) {
        ctx.fillStyle = "#000000";
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = "#FFFFFF";
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // 7D Delta (Only if current7 and previous7 are both complete)
  if (snapshot.sevenDayDeltaPercent !== null) {
    ctx.fillStyle = "#000000";
    ctx.font = "11px 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";
    const deltaSign = snapshot.sevenDayDeltaPercent >= 0 ? "+" : "";
    ctx.fillText(
      `vs prev 7d ${deltaSign}${snapshot.sevenDayDeltaPercent.toFixed(1)}%`,
      195,
      160,
    );
  }

  // 5. Reset Signal Section
  ctx.fillRect(16, 172, 368, 1);
  const sigStatus = snapshot.resetSignalStatus;
  if (sigStatus === "scheduled") {
    ctx.fillStyle = "#FF0000";
    ctx.font = "bold 13px 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";
    const effTime = snapshot.resetSignalEffectiveAt
      ? formatTimeShort(snapshot.resetSignalEffectiveAt)
      : "";
    ctx.fillText(`RESET SCHEDULED ${effTime}`, 16, 200);
  } else if (sigStatus === "likely") {
    ctx.fillStyle = "#FF0000";
    ctx.font = "bold 13px 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";
    const confPercent =
      snapshot.resetSignalConfidence !== null
        ? `${Math.round(snapshot.resetSignalConfidence * 100)}%`
        : "";
    ctx.fillText(`RESET SIGNAL ${confPercent}`, 16, 200);
  } else if (sigStatus === "completed") {
    ctx.fillStyle = "#000000";
    ctx.font = "bold 13px 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";
    ctx.fillText("RESET DONE", 16, 200);
  } else if (sigStatus === "unavailable") {
    ctx.fillStyle = "#FF0000";
    ctx.font = "bold 12px 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";
    ctx.fillText("RESET SIGNAL UNAVAILABLE", 16, 200);
  }

  // 6. Footer
  ctx.fillRect(16, 255, 368, 1);
  ctx.fillStyle = "#000000";
  ctx.font = "10px 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";
  const updated = snapshot.analyticsUpdatedAt
    ? `Updated ${formatTimeShort(snapshot.analyticsUpdatedAt)}`
    : "";
  ctx.fillText(updated, 16, 278);

  if (quotaIsLow || cov7Incomplete || cov30Incomplete) {
    ctx.fillStyle = "#FF0000";
    ctx.beginPath();
    ctx.arc(376, 275, 4, 0, Math.PI * 2);
    ctx.fill();
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
  const matrix = renderEinkMatrix(snapshot);
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
      setPixel(matrix, x + i, y + j, color);
    }
  }
}

function drawHollowBox(
  matrix: EinkPixelMatrix,
  x: number,
  y: number,
  w: number,
  h: number,
  color: EinkPixel,
) {
  for (let i = 0; i < w; i += 1) {
    setPixel(matrix, x + i, y, color);
    setPixel(matrix, x + i, y + h - 1, color);
  }
  for (let j = 0; j < h; j += 1) {
    setPixel(matrix, x, y + j, color);
    setPixel(matrix, x + w - 1, y + j, color);
  }
}

function drawLine(
  matrix: EinkPixelMatrix,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: EinkPixel,
) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let currX = x0;
  let currY = y0;

  while (true) {
    setPixel(matrix, currX, currY, color);
    if (currX === x1 && currY === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      currX += sx;
    }
    if (e2 < dx) {
      err += dx;
      currY += sy;
    }
  }
}

function setPixel(matrix: EinkPixelMatrix, x: number, y: number, color: EinkPixel) {
  if (y >= 0 && y < EINK_HEIGHT && x >= 0 && x < EINK_WIDTH) {
    matrix[y][x] = color;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatDateShort(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length >= 3) {
    return `${parts[1]}-${parts[2]}`;
  }
  return dateStr;
}

function formatTimeShort(isoStr: string): string {
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hours}:${minutes}`;
}

function formatCreditsShort(credits: number): string {
  if (credits >= 1000) {
    return `${(credits / 1000).toFixed(1)}K`;
  }
  return credits.toFixed(0);
}

function formatCountdown(resetsAt: string): string {
  const d = new Date(resetsAt);
  const diffMs = d.getTime() - Date.now();
  if (diffMs <= 0) return "soon";
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days > 0) return `${days}d ${remHours}h`;
  return `${hours}h`;
}

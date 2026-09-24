/**
 * Paint a LabelSpec onto a canvas at printer resolution and pack it to 1 bit.
 * Browser-only (needs a 2D canvas); the layout rules it paints are in
 * labelLayout.ts and tested there.
 */
import type { LabelSpec, Measure } from "./labelLayout";
import { packMonochrome, type MonoBitmap } from "./bitmap";

// A condensed-looking system sans that every till has. Bold for anything that
// must survive the thermal head's slight bleed.
const FONT_FAMILY = '"Helvetica Neue", Helvetica, Arial, sans-serif';

function font(size: number, bold: boolean): string {
  return `${bold ? "700" : "500"} ${size}px ${FONT_FAMILY}`;
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Canvas text measurement, shared by layout and paint so they agree. */
export const canvasMeasure: Measure = (text, fontPx, bold) => {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * fontPx * 0.6;
  measureCtx.font = font(fontPx, bold);
  return measureCtx.measureText(text).width;
};

export function paintLabel(spec: LabelSpec, canvas: HTMLCanvasElement): void {
  const { width, height } = spec.geometry;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";

  for (const item of spec.items) {
    switch (item.kind) {
      case "rect":
        ctx.fillStyle = "#000";
        ctx.fillRect(item.x, item.y, item.w, item.h);
        break;
      case "text": {
        ctx.font = font(item.size, item.bold);
        ctx.fillStyle = item.inverse ? "#fff" : "#000";
        ctx.textAlign = item.align === "center" ? "center" : "left";
        const x = item.align === "center" ? item.x + item.maxWidth / 2 : item.x;
        ctx.fillText(item.text, x, item.y);
        ctx.fillStyle = "#000";
        break;
      }
      case "qr":
        for (let r = 0; r < item.modules.length; r++) {
          const row = item.modules[r];
          for (let c = 0; c < row.length; c++) {
            if (row[c]) ctx.fillRect(item.x + c * item.scale, item.y + r * item.scale, item.scale, item.scale);
          }
        }
        break;
      case "bars": {
        // Draw runs so adjacent bar modules make one solid bar.
        let run = 0;
        for (let i = 0; i <= item.modules.length; i++) {
          if (i < item.modules.length && item.modules[i]) {
            run++;
          } else if (run > 0) {
            ctx.fillRect(item.x + (i - run) * item.moduleDots, item.y, run * item.moduleDots, item.h);
            run = 0;
          }
        }
        break;
      }
    }
  }
}

/** Paint and pack in one go; returns the canvas too so the UI can show exactly what will print. */
export function renderLabel(spec: LabelSpec, canvas: HTMLCanvasElement = document.createElement("canvas")): { canvas: HTMLCanvasElement; bitmap: MonoBitmap } {
  paintLabel(spec, canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser");
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { canvas, bitmap: packMonochrome(image.data, canvas.width, canvas.height) };
}

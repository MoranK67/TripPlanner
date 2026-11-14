// Small canvas helpers for the timetable renderer (ported from the prototype's export code).

/** The subset of the 2D context the helpers need (eases testing with a mock context). */
type TextMeasurer = Pick<CanvasRenderingContext2D, 'measureText'>;

/**
 * Canvas limits that work on every supported browser: iOS Safari refuses canvases above
 * 16 777 216 pixels in total, and browsers cap a side at 16 384 (some older ones at 32 767).
 */
export const MAX_CANVAS_AREA = 16_777_216;
export const MAX_CANVAS_SIDE = 16_384;
/** Preferred pixel ratio: sharp text when printed or zoomed. */
export const PREFERRED_CANVAS_SCALE = 2;

/**
 * Pixel ratio for a canvas of `width` × `height` CSS pixels: 2× when it fits, otherwise the largest
 * scale that keeps the bitmap inside the browser limits (may be below 1 for huge trips).
 */
export function canvasScale(width: number, height: number): number {
  if (!(width > 0 && height > 0)) return 1;
  return Math.min(
    PREFERRED_CANVAS_SCALE,
    Math.sqrt(MAX_CANVAS_AREA / (width * height)),
    MAX_CANVAS_SIDE / width,
    MAX_CANVAS_SIDE / height,
  );
}

/** Mixes two `#rrggbb` colours: `amount` 0 = `a`, 1 = `b`. Returns `rgb(r,g,b)`. */
export function mixHex(a: string, b: string, amount: number): string {
  const parse = (hex: string) =>
    [1, 3, 5].map((k) => Number.parseInt(hex.slice(k, k + 2), 16) || 0);
  const from = parse(a);
  const to = parse(b);
  const mixed = from.map((v, k) => Math.round(v * (1 - amount) + (to[k] ?? 0) * amount));
  return `rgb(${mixed.join(',')})`;
}

/** Adds a rounded-rectangle path (call `fill` / `stroke` / `clip` afterwards). */
export function roundRectPath(
  ctx: Pick<CanvasRenderingContext2D, 'beginPath' | 'moveTo' | 'arcTo' | 'closePath'>,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const ELLIPSIS = '…';

/** `text` cut with an ellipsis so it fits `maxWidth` in the current font. */
export function fitText(ctx: TextMeasurer, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  // Code points, so a cut never splits a surrogate pair (emoji).
  const chars = Array.from(text);
  while (chars.length > 1 && ctx.measureText(chars.join('') + ELLIPSIS).width > maxWidth) {
    chars.pop();
  }
  return chars.join('').trimEnd() + ELLIPSIS;
}

/**
 * Word-wraps `text` into at most `maxLines` lines of `maxWidth`. A word longer than a line and the
 * last line when text remains are cut with an ellipsis.
 */
export function wrapText(
  ctx: TextMeasurer,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || ctx.measureText(candidate).width <= maxWidth) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  const limit = Math.max(1, Math.floor(maxLines));
  if (lines.length > limit) {
    const cut = lines.slice(0, limit);
    cut[limit - 1] = fitText(ctx, `${cut[limit - 1] ?? ''}${ELLIPSIS}`, maxWidth);
    return cut;
  }
  return lines.map((l) => fitText(ctx, l, maxWidth));
}

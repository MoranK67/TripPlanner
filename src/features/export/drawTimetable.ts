// Draws one export page (the whole trip for PNG, up to 7 days for a PDF page) on a 2D canvas.
// Ported from the prototype's `drawSchedule`; all timetable logic (hour range, rows, disabled
// spans, block positions, pagination) comes from the domain layout model (DEC-016) — this file only
// turns row units into pixels and draws. Right-to-left like the app: the hour column is on the
// right and day 1 is the right-most day column.

import type { ExportDay, ExportLayout, ExportPage } from '@/domain';
import { fitText, mixHex, roundRectPath, wrapText } from './canvasHelpers';
import type { ExportTheme } from './theme';

/** Page geometry in CSS pixels (before the device scale). */
export const PAGE_GEOMETRY = {
  pad: 28,
  titleHeight: 66,
  headHeight: 52,
  timeWidth: 60,
  columnWidth: 160,
  rowHeight: 24,
  cardRadius: 16,
  blockRadius: 8,
  /** Gap around a block inside its column (prototype: 4 px each side, 1 px top, 2 px bottom). */
  blockInsetX: 4,
  blockInsetTop: 1,
  blockGap: 3,
} as const;

/** Words the renderer draws; built by the dialog from the i18n strings (`export.*`). */
export interface ExportText {
  /** Subtitle under the trip name for a page (dates, and "page X of Y" in a multi-page PDF). */
  subtitle(page: ExportPage): string;
  /** Second line of a day header, e.g. `5.11 · יום 1`. */
  dayCaption(day: ExportDay): string;
}

export interface PageSize {
  width: number;
  height: number;
}

/** Size of a page in CSS pixels. */
export function measurePage(layout: ExportLayout, page: ExportPage): PageSize {
  const g = PAGE_GEOMETRY;
  return {
    width: g.pad * 2 + g.timeWidth + page.days.length * g.columnWidth,
    height: g.pad * 2 + g.titleHeight + g.headHeight + layout.rows.length * g.rowHeight,
  };
}

/** The context methods / properties the renderer uses. */
export type DrawingContext = Pick<
  CanvasRenderingContext2D,
  | 'arcTo'
  | 'beginPath'
  | 'clip'
  | 'closePath'
  | 'fill'
  | 'fillRect'
  | 'fillText'
  | 'lineTo'
  | 'measureText'
  | 'moveTo'
  | 'rect'
  | 'restore'
  | 'save'
  | 'setLineDash'
  | 'stroke'
  | 'direction'
  | 'fillStyle'
  | 'font'
  | 'lineWidth'
  | 'strokeStyle'
  | 'textAlign'
  | 'textBaseline'
>;

/** Distance between hatch stripes along a row, ≈ the timetable's 12 px 45° pattern. */
const HATCH_STEP = 17;
const HATCH_WIDTH = 6;

/** Fills a rectangle with the disabled-cell hatch used by the timetable (FR-4.2). */
export function fillHatch(
  ctx: DrawingContext,
  theme: ExportTheme,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = theme.slotDisabled;
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = theme.slotDisabledHatch;
  ctx.lineWidth = HATCH_WIDTH;
  ctx.beginPath();
  for (let d = -h; d < w + h; d += HATCH_STEP) {
    ctx.moveTo(x + d, y + h);
    ctx.lineTo(x + d + h, y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws `page` at the origin of `ctx` (already scaled to CSS pixels). The caller sizes the canvas
 * with `measurePage` and loads the font first.
 */
export function drawPage(
  ctx: DrawingContext,
  layout: ExportLayout,
  page: ExportPage,
  text: ExportText,
  theme: ExportTheme,
): void {
  const g = PAGE_GEOMETRY;
  const { width: W, height: H } = measurePage(layout, page);
  const font = (weight: number, size: number) => `${weight} ${size}px ${theme.font}`;
  const days = page.days;
  const rowH = g.rowHeight;
  const gridH = layout.rows.length * rowH;

  ctx.direction = 'rtl';

  // Background and title.
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = theme.ink;
  ctx.font = font(700, 22);
  ctx.fillText(fitText(ctx, layout.tripName, W - g.pad * 2), W - g.pad, g.pad + 24);
  ctx.fillStyle = theme.inkSoft;
  ctx.font = font(400, 13);
  ctx.fillText(fitText(ctx, text.subtitle(page), W - g.pad * 2), W - g.pad, g.pad + 48);

  // Card.
  const gx = g.pad;
  const gy = g.pad + g.titleHeight;
  const gw = W - g.pad * 2;
  const gh = g.headHeight + gridH;
  const right = gx + gw;
  const top = gy + g.headHeight;
  const colX = (i: number) => right - g.timeWidth - (i + 1) * g.columnWidth;

  ctx.save();
  roundRectPath(ctx, gx, gy, gw, gh, g.cardRadius);
  ctx.fillStyle = theme.panel;
  ctx.fill();
  ctx.clip();

  // Outside-the-trip spans (first / last day).
  days.forEach((day, i) => {
    for (const span of day.disabled) {
      fillHatch(ctx, theme, colX(i), top + span.top * rowH, g.columnWidth, span.height * rowH);
    }
  });

  // Row lines: solid on full hours across the hour column, dashed on half hours.
  ctx.lineWidth = 1;
  for (const row of layout.rows) {
    if (row.index === 0) continue;
    const y = top + row.index * rowH + 0.5;
    ctx.strokeStyle = row.isHourStart ? theme.lineStrong : theme.line;
    ctx.setLineDash(row.isHourStart ? [] : [3, 3]);
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(row.isHourStart ? right : right - g.timeWidth, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = theme.lineStrong;
  ctx.beginPath();
  ctx.moveTo(gx, top + 0.5);
  ctx.lineTo(right, top + 0.5);
  ctx.stroke();

  // Column lines.
  ctx.strokeStyle = theme.line;
  days.forEach((_, i) => {
    const x = right - g.timeWidth - i * g.columnWidth + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x, gy + gh);
    ctx.stroke();
  });

  // Day headers.
  ctx.textAlign = 'center';
  days.forEach((day, i) => {
    const cx = colX(i) + g.columnWidth / 2;
    const maxW = g.columnWidth - 12;
    ctx.fillStyle = theme.ink;
    ctx.font = font(600, 14);
    ctx.fillText(fitText(ctx, day.weekdayLabel, maxW), cx, gy + 23);
    ctx.fillStyle = theme.inkSoft;
    ctx.font = font(400, 12);
    ctx.fillText(fitText(ctx, text.dayCaption(day), maxW), cx, gy + 41);
  });

  // Hour labels.
  ctx.fillStyle = theme.inkSoft;
  ctx.font = font(400, 11);
  for (const row of layout.rows) {
    if (row.label) ctx.fillText(row.label, right - g.timeWidth / 2, top + row.index * rowH + 15);
  }

  // Activity blocks.
  days.forEach((day, i) => drawDayBlocks(ctx, theme, day, colX(i), top, font));

  ctx.restore();
  ctx.strokeStyle = theme.lineStrong;
  roundRectPath(ctx, gx + 0.5, gy + 0.5, gw - 1, gh - 1, g.cardRadius);
  ctx.stroke();
}

function drawDayBlocks(
  ctx: DrawingContext,
  theme: ExportTheme,
  day: ExportDay,
  columnX: number,
  top: number,
  font: (weight: number, size: number) => string,
): void {
  const g = PAGE_GEOMETRY;
  const rowH = g.rowHeight;
  for (const block of day.blocks) {
    const x = columnX + g.blockInsetX;
    const y = top + block.top * rowH + g.blockInsetTop;
    const w = g.columnWidth - g.blockInsetX * 2;
    const h = block.height * rowH - g.blockGap;
    if (h <= 0) continue;

    ctx.save();
    roundRectPath(ctx, x, y, w, h, g.blockRadius);
    ctx.fillStyle = block.color;
    ctx.fill();
    ctx.strokeStyle = mixHex(block.color, theme.blockEdge, 0.16);
    ctx.stroke();
    ctx.clip();

    if (h < rowH * 1.5) {
      // One-slot block: time on the left, name on the right, one line (prototype `.short`).
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = font(400, 10.5);
      ctx.fillStyle = theme.blockInkSoft;
      ctx.fillText(block.timeLabel, x + 6, y + h / 2 + 1);
      const timeWidth = ctx.measureText(block.timeLabel).width;
      ctx.textAlign = 'right';
      ctx.font = font(600, 12);
      ctx.fillStyle = theme.blockInk;
      ctx.fillText(fitText(ctx, block.name, w - 18 - timeWidth), x + w - 8, y + h / 2 + 1);
    } else {
      ctx.textBaseline = 'top';
      ctx.textAlign = 'right';
      ctx.font = font(600, 13);
      ctx.fillStyle = theme.blockInk;
      const lineHeight = 17;
      const maxLines = Math.max(1, Math.floor((h - 10 - 15) / lineHeight));
      const lines = wrapText(ctx, block.name, w - 16, maxLines);
      lines.forEach((line, k) => ctx.fillText(line, x + w - 8, y + 6 + k * lineHeight));
      const timeY = y + 6 + lines.length * lineHeight + 1;
      if (timeY + 13 <= y + h) {
        ctx.font = font(400, 11.5);
        ctx.fillStyle = theme.blockInkSoft;
        ctx.fillText(block.timeLabel, x + w - 8, timeY);
      }
    }
    ctx.restore();
  }
}

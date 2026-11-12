// Export layout model (FR-7.1–7.3, PROJECT_PLAN M2.5). Turns a trip + its activities into a
// renderer-agnostic description of the timetable: which minutes and rows to draw, the day columns,
// disabled (outside-the-trip) spans, positioned activity blocks and PDF pages. Geometry is in
// *row units* (1 = one slot of SLOT_MINUTES) measured from the top of the shown range, so a canvas,
// PDF or print renderer only multiplies by its own row height / column width. Ported from the
// prototype's `fittedRange` / `drawSchedule` / `exportPDF`, without any pixel or text-measuring logic.
//
// Language: only domain-owned formatters are used (`minuteLabel`, `formatShortDate`,
// `formatWeekday`, `formatDurationHe`, see DEC-013). Words such as "יום N", "עד" and
// "עמוד X מתוך Y" belong to i18n, so the model exposes the numbers instead.

import { MINUTES_PER_DAY, SLOT_MINUTES } from './constants';
import { isPlaced } from './guards';
import {
  type DayBounds,
  dayBounds,
  formatDurationHe,
  formatShortDate,
  formatWeekday,
  minuteLabel,
  tripDays,
} from './time';
import type {
  Activity,
  HexColor,
  IsoDate,
  Minute,
  PlacedActivity,
  Trip,
  TripWindow,
} from './types';

// --- Constants -----------------------------------------------------------------------------

/** FR-7.2: a PDF page shows at most this many day columns. */
export const PDF_DAYS_PER_PAGE = 7;

/** FR-7.3: the "relevant hours" range before it is widened to fit placed activities (08:00–22:00). */
export const EXPORT_DEFAULT_START_MINUTE: Minute = 8 * 60;
export const EXPORT_DEFAULT_END_MINUTE: Minute = 22 * 60;

/** A4 page size in millimetres (portrait). */
export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;

// --- Types ---------------------------------------------------------------------------------

/** FR-7.3 hour range option: "relevant hours" (fitted) or "full day" (00:00–24:00). */
export type ExportHourRange = 'fitted' | 'full';

/** Half-open minute range `[startMinute, endMinute)` within one day. */
export type MinuteRange = DayBounds;

/** A vertical span inside a day column, in row units from the top of the shown range. */
export interface RowSpan {
  /** Row offset of the top edge (0 = first shown row). May be fractional for off-grid minutes. */
  top: number;
  /** Height in rows (> 0). */
  height: number;
}

/** One timetable row (one slot) of the shown range. */
export interface ExportRow {
  /** 0-based row index within the shown range. */
  index: number;
  startMinute: Minute;
  /** True on full hours: draw a solid line and the time label (prototype: dashed half-hour lines). */
  isHourStart: boolean;
  /** `HH:MM` on full hours, `null` on other rows (the prototype only labels full hours). */
  label: string | null;
}

/** A placed activity positioned in its day column. */
export interface ExportBlock extends RowSpan {
  activityId: string;
  name: string;
  color: HexColor;
  /** Real start/end of the activity (not clipped to the shown range). */
  startMinute: Minute;
  endMinute: Minute;
  durationMinutes: number;
  /** `09:00–10:30` (en dash), from the real start/end. */
  timeLabel: string;
  /** Hebrew duration, e.g. `שעתיים וחצי`. */
  durationLabel: string;
  /** The activity starts before / ends after the shown range, so the block is cut there. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

/** A disabled (outside the trip window) span of a day column, clipped to the shown range. */
export interface ExportDisabledSpan extends RowSpan, MinuteRange {}

/** One day column. */
export interface ExportDay {
  date: IsoDate;
  /** 0-based index of the day within the whole trip (stays correct across PDF pages). */
  tripDayIndex: number;
  /** 1-based day number for the "יום N" header (i18n key interpolation). */
  dayNumber: number;
  /** Weekday name, e.g. `יום שני`. */
  weekdayLabel: string;
  /** `D.M`, e.g. `5.11`. */
  shortDateLabel: string;
  /** Enabled minutes of this day (FR-4.2). */
  bounds: MinuteRange;
  /** Parts of the shown range outside `bounds` (at most two: before the start, after the end). */
  disabled: ExportDisabledSpan[];
  /** Placed activities of this day that are at least partly inside the shown range, by start time. */
  blocks: ExportBlock[];
}

/** One output page (PDF) — or the whole image for PNG, where all days are on one page. */
export interface ExportPage {
  /** 0-based page index. */
  index: number;
  /** 1-based page number for "עמוד X מתוך Y". */
  pageNumber: number;
  pageCount: number;
  /** Day columns on this page, in trip order; column `i` is `days[i]`. */
  days: ExportDay[];
}

/** A labelled point in time for the export subtitle (`5.11 10:00`). */
export interface ExportTimePoint {
  date: IsoDate;
  minute: Minute;
  shortDateLabel: string;
  timeLabel: string;
}

export interface ExportLayout {
  tripName: string;
  /** Trip start / end for the subtitle; the renderer joins them with the i18n word for "until". */
  start: ExportTimePoint;
  end: ExportTimePoint;
  dayCount: number;
  hourRange: ExportHourRange;
  /** Minutes shown on every page. */
  range: MinuteRange;
  /** Rows of the shown range, top to bottom; `rows.length` = grid height in rows. */
  rows: ExportRow[];
  /** Every trip day, in order (same objects as in `pages`). */
  days: ExportDay[];
  /** Days split into pages. Empty only if the trip window is invalid (end date before start). */
  pages: ExportPage[];
}

export interface ExportLayoutOptions {
  hourRange: ExportHourRange;
  /**
   * Maximum day columns per page. Use `PDF_DAYS_PER_PAGE` for PDF (FR-7.2); omit for PNG, which
   * puts every day on one page. Values below 1 or non-finite values also mean "one page".
   */
  daysPerPage?: number;
}

// --- Hour range ----------------------------------------------------------------------------

/** Placed activities whose date is a trip day (only those are drawn). */
function placedOnTripDays(window: TripWindow, activities: readonly Activity[]): PlacedActivity[] {
  return activities.filter(isPlaced).filter((a) => dayBounds(window, a.placement.date) !== null);
}

/**
 * "Relevant hours" range (FR-7.3), same rule as the prototype's `fittedRange`: start from
 * 08:00–22:00, widen it to include every placed activity of the trip (on any day), then round
 * outward to whole hours (never past 24:00). Activities on dates outside the trip are ignored
 * because they are not drawn.
 */
export function fittedExportRange(
  window: TripWindow,
  activities: readonly Activity[],
): MinuteRange {
  let start = EXPORT_DEFAULT_START_MINUTE;
  let end = EXPORT_DEFAULT_END_MINUTE;
  for (const a of placedOnTripDays(window, activities)) {
    start = Math.min(start, a.placement.startMinute);
    end = Math.max(end, a.placement.startMinute + a.durationMinutes);
  }
  return {
    startMinute: Math.max(0, Math.floor(start / 60) * 60),
    endMinute: Math.min(MINUTES_PER_DAY, Math.ceil(end / 60) * 60),
  };
}

/** The minute range to export for an hour-range option. */
export function exportMinuteRange(
  hourRange: ExportHourRange,
  window: TripWindow,
  activities: readonly Activity[],
): MinuteRange {
  return hourRange === 'full'
    ? { startMinute: 0, endMinute: MINUTES_PER_DAY }
    : fittedExportRange(window, activities);
}

/** Rows (slots) of a minute range, top to bottom. */
export function exportRows(range: MinuteRange): ExportRow[] {
  const count = Math.max(0, Math.ceil((range.endMinute - range.startMinute) / SLOT_MINUTES));
  return Array.from({ length: count }, (_, index) => {
    const startMinute = range.startMinute + index * SLOT_MINUTES;
    const isHourStart = startMinute % 60 === 0;
    return {
      index,
      startMinute,
      isHourStart,
      label: isHourStart ? minuteLabel(startMinute) : null,
    };
  });
}

// --- Geometry ------------------------------------------------------------------------------

/**
 * Row span of `[start, end)` clipped to `range`, or `null` if nothing of it is visible
 * (half-open: a span ending exactly at the range start is not visible).
 */
export function rowSpanInRange(range: MinuteRange, start: Minute, end: Minute): RowSpan | null {
  const from = Math.max(start, range.startMinute);
  const to = Math.min(end, range.endMinute);
  if (to <= from) return null;
  return {
    top: (from - range.startMinute) / SLOT_MINUTES,
    height: (to - from) / SLOT_MINUTES,
  };
}

function disabledSpans(range: MinuteRange, bounds: MinuteRange): ExportDisabledSpan[] {
  const candidates: MinuteRange[] = [
    { startMinute: range.startMinute, endMinute: Math.min(bounds.startMinute, range.endMinute) },
    { startMinute: Math.max(bounds.endMinute, range.startMinute), endMinute: range.endMinute },
  ];
  const spans: ExportDisabledSpan[] = [];
  for (const c of candidates) {
    const span = rowSpanInRange(range, c.startMinute, c.endMinute);
    if (span) spans.push({ ...c, ...span });
  }
  return spans;
}

function toBlock(range: MinuteRange, activity: PlacedActivity): ExportBlock | null {
  const startMinute = activity.placement.startMinute;
  const endMinute = startMinute + activity.durationMinutes;
  const span = rowSpanInRange(range, startMinute, endMinute);
  if (!span) return null;
  const block: ExportBlock = {
    ...span,
    activityId: activity.id,
    name: activity.name,
    color: activity.color,
    startMinute,
    endMinute,
    durationMinutes: activity.durationMinutes,
    timeLabel: `${minuteLabel(startMinute)}–${minuteLabel(endMinute)}`,
    durationLabel: formatDurationHe(activity.durationMinutes),
    clippedStart: startMinute < range.startMinute,
    clippedEnd: endMinute > range.endMinute,
  };
  return block;
}

/** Splits `items` into consecutive chunks of at most `size` (all in one chunk if `size` < 1). */
export function paginateDays<T>(items: readonly T[], size?: number): T[][] {
  if (items.length === 0) return [];
  const per =
    size !== undefined && Number.isFinite(size) && size >= 1 ? Math.floor(size) : Infinity;
  if (per === Infinity) return [items.slice()];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += per) pages.push(items.slice(i, i + per));
  return pages;
}

/** Plain UTF-16 code-unit order (locale-independent, unlike `localeCompare`). */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// --- Layout --------------------------------------------------------------------------------

/**
 * Builds the export layout for a trip (FR-7.1–7.3). Pure and deterministic; pass all of the trip's
 * activities (bank activities are ignored).
 */
export function buildExportLayout(
  trip: Pick<Trip, 'name' | 'window'>,
  activities: readonly Activity[],
  options: ExportLayoutOptions,
): ExportLayout {
  const { window } = trip;
  const range = exportMinuteRange(options.hourRange, window, activities);

  const byDate = new Map<IsoDate, ExportBlock[]>();
  for (const a of placedOnTripDays(window, activities)) {
    const block = toBlock(range, a);
    if (!block) continue;
    const list = byDate.get(a.placement.date) ?? [];
    list.push(block);
    byDate.set(a.placement.date, list);
  }

  const days: ExportDay[] = tripDays(window).map((date, tripDayIndex) => {
    // `date` comes from tripDays, so it is always a trip day.
    const bounds = dayBounds(window, date) ?? { startMinute: 0, endMinute: 0 };
    const blocks = (byDate.get(date) ?? []).sort(
      (a, b) => a.startMinute - b.startMinute || compareCodeUnits(a.activityId, b.activityId),
    );
    return {
      date,
      tripDayIndex,
      dayNumber: tripDayIndex + 1,
      weekdayLabel: formatWeekday(date),
      shortDateLabel: formatShortDate(date),
      bounds,
      disabled: disabledSpans(range, bounds),
      blocks,
    };
  });

  const chunks = paginateDays(days, options.daysPerPage);
  const pages: ExportPage[] = chunks.map((chunk, index) => ({
    index,
    pageNumber: index + 1,
    pageCount: chunks.length,
    days: chunk,
  }));

  return {
    tripName: trip.name,
    start: timePoint(window.startDate, window.startMinute),
    end: timePoint(window.endDate, window.endMinute),
    dayCount: days.length,
    hourRange: options.hourRange,
    range,
    rows: exportRows(range),
    days,
    pages,
  };
}

function timePoint(date: IsoDate, minute: Minute): ExportTimePoint {
  return { date, minute, shortDateLabel: formatShortDate(date), timeLabel: minuteLabel(minute) };
}

// --- Page fitting (PDF) --------------------------------------------------------------------

export type PageOrientation = 'portrait' | 'landscape';

/** FR-7.2 "orientation chosen per page": landscape when the content is at least as wide as tall. */
export function pageOrientation(contentWidth: number, contentHeight: number): PageOrientation {
  return contentWidth >= contentHeight ? 'landscape' : 'portrait';
}

export interface PagePlacement {
  orientation: PageOrientation;
  pageWidth: number;
  pageHeight: number;
  /** Uniform scale from content units to page units. */
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where to put a rendered page image on an A4 page (in mm), as in the prototype: orientation from
 * the content's aspect ratio, scaled to fit inside `marginMm`, centred horizontally, top-aligned.
 */
export function fitOnA4(contentWidth: number, contentHeight: number, marginMm = 8): PagePlacement {
  const orientation = pageOrientation(contentWidth, contentHeight);
  const pageWidth = orientation === 'landscape' ? A4_HEIGHT_MM : A4_WIDTH_MM;
  const pageHeight = orientation === 'landscape' ? A4_WIDTH_MM : A4_HEIGHT_MM;
  const valid = contentWidth > 0 && contentHeight > 0;
  const scale = valid
    ? Math.min(
        (pageWidth - 2 * marginMm) / contentWidth,
        (pageHeight - 2 * marginMm) / contentHeight,
      )
    : 0;
  const width = contentWidth * scale;
  const height = contentHeight * scale;
  return {
    orientation,
    pageWidth,
    pageHeight,
    scale,
    x: (pageWidth - width) / 2,
    y: marginMm,
    width,
    height,
  };
}

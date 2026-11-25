// Pixel layout of the timetable (FR-4.1–4.5). Pure functions so positions can be unit-tested
// without a browser; the grid component and the drag engine (M5.3) share them.

import { SLOT_HEIGHT_PX } from '@/components/ui';
import {
  minuteLabel,
  SLOT_MINUTES,
  SLOTS_PER_DAY,
  type DayBounds,
  type Minute,
  type TripWindow,
} from '@/domain';

/** Height of the sticky day header row (prototype: 56 px). */
export const HEADER_PX = 56;
/** Width of the sticky time column (prototype: 64 px). */
export const TIME_COL_PX = 64;
/** Minimum day column width (prototype: 150 px); columns stretch to fill short trips. */
export const COL_MIN_PX = 150;
/** Full height of one day: 48 half-hour rows (tablet / desktop scale). */
export const DAY_PX = SLOTS_PER_DAY * SLOT_HEIGHT_PX;

/**
 * The timetable's vertical scale. Tablet / desktop use the shared block scale (28 px per half
 * hour); the phone planner (PHONE-2) uses a denser one so a whole working day fits on screen.
 * Passed down as a value (context / props), never a global, so both layouts can coexist.
 */
export interface TimetableMetrics {
  /** Height of one half-hour row; also the bank's block scale (FR-3.3). */
  slotHeight: number;
  /** Height of the sticky day header row. */
  headerPx: number;
}

export const GRID_METRICS: TimetableMetrics = { slotHeight: SLOT_HEIGHT_PX, headerPx: HEADER_PX };

/** Phone half-hour height: about 10 hours on a 390 × 664 screen with the slim app header. */
export const PHONE_SLOT_HEIGHT_PX = 22;
/** Phone day-switcher row: 36 px buttons plus the line under it. */
export const PHONE_HEADER_PX = 40;
export const PHONE_METRICS: TimetableMetrics = {
  slotHeight: PHONE_SLOT_HEIGHT_PX,
  headerPx: PHONE_HEADER_PX,
};

/** Full height of one day at a given slot height. */
export function dayPx(slotHeight: number = SLOT_HEIGHT_PX): number {
  return SLOTS_PER_DAY * slotHeight;
}
/** Where the view opens when the trip starts at midnight (FR-4.4). */
export const DEFAULT_SCROLL_MINUTE: Minute = 8 * 60;

/** Pixel offset of a minute of the day from the top of a day column. */
export function minuteToPx(minute: Minute, slotHeight: number = SLOT_HEIGHT_PX): number {
  return (minute / SLOT_MINUTES) * slotHeight;
}

/** `top` of a placed block: one pixel below its slot line, as in the prototype. */
export function blockTop(startMinute: Minute, slotHeight: number = SLOT_HEIGHT_PX): number {
  return minuteToPx(startMinute, slotHeight) + 1;
}

/** Time range shown on a placed block (FR-4.5), e.g. `09:00–10:30`, `23:00–24:00`. */
export function timeRangeLabel(startMinute: Minute, durationMinutes: number): string {
  return `${minuteLabel(startMinute)}–${minuteLabel(startMinute + durationMinutes)}`;
}

/** A vertical run of disabled slots in a day column. */
export interface DisabledSpan {
  top: number;
  height: number;
}

/**
 * Disabled parts of a trip day (FR-4.2) from its enabled bounds (`dayBounds`): before the trip
 * start on the first day and after the trip end on the last day. Full days have none.
 */
export function disabledSpans(
  bounds: DayBounds | null,
  slotHeight: number = SLOT_HEIGHT_PX,
): DisabledSpan[] {
  const full = dayPx(slotHeight);
  if (!bounds) return [{ top: 0, height: full }];
  const spans: DisabledSpan[] = [];
  const startPx = minuteToPx(bounds.startMinute, slotHeight);
  const endPx = minuteToPx(bounds.endMinute, slotHeight);
  if (startPx > 0) spans.push({ top: 0, height: startPx });
  if (endPx < full) spans.push({ top: endPx, height: full - endPx });
  return spans;
}

/**
 * Initial vertical scroll (FR-4.4): the trip start time with one slot of context above it, as in
 * the prototype. A trip starting at 00:00 opens at 08:00 instead of the middle of the night.
 */
export function initialScrollTop(window: TripWindow, slotHeight: number = SLOT_HEIGHT_PX): number {
  const minute = window.startMinute > 0 ? window.startMinute : DEFAULT_SCROLL_MINUTE;
  return Math.max(0, minuteToPx(minute, slotHeight) - slotHeight);
}

/** First half-hour row at or below a scroll offset (where tap-to-place starts looking). */
export function slotAtScrollTop(scrollTop: number, slotHeight: number = SLOT_HEIGHT_PX): number {
  return Math.ceil(scrollTop / slotHeight);
}

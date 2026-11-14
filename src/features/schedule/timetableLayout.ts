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
/** Full height of one day: 48 half-hour rows. */
export const DAY_PX = SLOTS_PER_DAY * SLOT_HEIGHT_PX;
/** Where the view opens when the trip starts at midnight (FR-4.4). */
export const DEFAULT_SCROLL_MINUTE: Minute = 8 * 60;

/** Pixel offset of a minute of the day from the top of a day column. */
export function minuteToPx(minute: Minute): number {
  return (minute / SLOT_MINUTES) * SLOT_HEIGHT_PX;
}

/** `top` of a placed block: one pixel below its slot line, as in the prototype. */
export function blockTop(startMinute: Minute): number {
  return minuteToPx(startMinute) + 1;
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
export function disabledSpans(bounds: DayBounds | null): DisabledSpan[] {
  if (!bounds) return [{ top: 0, height: DAY_PX }];
  const spans: DisabledSpan[] = [];
  const startPx = minuteToPx(bounds.startMinute);
  const endPx = minuteToPx(bounds.endMinute);
  if (startPx > 0) spans.push({ top: 0, height: startPx });
  if (endPx < DAY_PX) spans.push({ top: endPx, height: DAY_PX - endPx });
  return spans;
}

/**
 * Initial vertical scroll (FR-4.4): the trip start time with one slot of context above it, as in
 * the prototype. A trip starting at 00:00 opens at 08:00 instead of the middle of the night.
 */
export function initialScrollTop(window: TripWindow): number {
  const minute = window.startMinute > 0 ? window.startMinute : DEFAULT_SCROLL_MINUTE;
  return Math.max(0, minuteToPx(minute) - SLOT_HEIGHT_PX);
}

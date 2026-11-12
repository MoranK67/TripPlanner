// Time utilities for the minute-based time model (PROJECT_PLAN §4.5).
// Dates are floating calendar dates (`YYYY-MM-DD`, no time zone); all calendar math is done on
// UTC epoch days so the device time zone and DST can never shift a day.

import { MAX_END_MINUTE, MINUTES_PER_DAY, SLOT_MINUTES, SLOTS_PER_DAY } from './constants';
import type { IsoDate, Minute, TripWindow } from './types';

const MS_PER_DAY = 86_400_000;

/** Enabled minute range of one trip day: half-open `[startMinute, endMinute)`. */
export interface DayBounds {
  startMinute: Minute;
  endMinute: Minute;
}

// --- Minutes and slots ---------------------------------------------------------------------

/**
 * `HH:MM` label for a minute of the day, e.g. 570 → `09:30`, 1440 → `24:00` (FR-2.4).
 * Not limited to the slot grid so a finer granularity keeps working.
 */
export function minuteLabel(minute: Minute): string {
  const total = Math.max(0, Math.min(MAX_END_MINUTE, Math.round(minute)));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/** Index of the slot containing `minute` (0 = 00:00–00:30). */
export function slotIndex(minute: Minute): number {
  return Math.floor(minute / SLOT_MINUTES);
}

/** First minute of slot `index`. */
export function slotStartMinute(index: number): Minute {
  return index * SLOT_MINUTES;
}

/** Start minute of every timetable row of a day: 0, 30, …, 1410 (FR-4.1). */
export function daySlotStarts(): Minute[] {
  return Array.from({ length: SLOTS_PER_DAY }, (_, i) => slotStartMinute(i));
}

// --- Calendar dates ------------------------------------------------------------------------

/**
 * Days since 1970-01-01 for an ISO date. Returns NaN for text that is not `YYYY-MM-DD`
 * (validate with `isIsoDate` first when the input is untrusted).
 */
export function toEpochDay(date: IsoDate): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return Number.NaN;
  // setUTCFullYear, unlike Date.UTC, does not map years 0–99 to 1900–1999.
  const d = new Date(0);
  d.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Math.round(d.getTime() / MS_PER_DAY);
}

/**
 * ISO date for a day count since 1970-01-01 (inverse of `toEpochDay`).
 * Throws `RangeError` for NaN or out-of-range input (e.g. from a malformed date); validate
 * dates with `isIsoDate` first.
 */
export function fromEpochDay(day: number): IsoDate {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * `date` moved by `days` calendar days (negative moves back).
 * Throws `RangeError` if `date` is malformed (see `fromEpochDay`).
 */
export function addDays(date: IsoDate, days: number): IsoDate {
  return fromEpochDay(toEpochDay(date) + days);
}

/** Calendar days from `from` to `to` (`to - from`, like Postgres `date - date`). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return toEpochDay(to) - toEpochDay(from);
}

/** Sort comparator for ISO dates (negative if `a` is earlier). */
export function compareDates(a: IsoDate, b: IsoDate): number {
  return toEpochDay(a) - toEpochDay(b);
}

/**
 * Today's calendar date on the device, as `YYYY-MM-DD`. Takes `now` as a parameter so the domain
 * stays deterministic; callers pass `new Date()`.
 */
export function localIsoDate(now: Date): IsoDate {
  const y = String(now.getFullYear()).padStart(4, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// --- Trip days ---------------------------------------------------------------------------

/** Number of calendar days the trip covers, both ends inclusive (FR-2.8). 0 if end < start. */
export function tripDayCount(window: TripWindow): number {
  const span = daysBetween(window.startDate, window.endDate);
  return Number.isFinite(span) && span >= 0 ? span + 1 : 0;
}

/** Every calendar day of the trip in order — one timetable column each (FR-4.1). */
export function tripDays(window: TripWindow): IsoDate[] {
  const first = toEpochDay(window.startDate);
  return Array.from({ length: tripDayCount(window) }, (_, i) => fromEpochDay(first + i));
}

/** True if `date` is one of the trip's days. */
export function isDateInTrip(window: TripWindow, date: IsoDate): boolean {
  const day = toEpochDay(date);
  return day >= toEpochDay(window.startDate) && day <= toEpochDay(window.endDate);
}

/**
 * Enabled minutes of a trip day (FR-4.2): the first day starts at the trip start, the last day
 * ends at the trip end, other days are 00:00–24:00. A single-day trip uses both. `null` if the
 * date is not a trip day. Mirrors the bounds checked by the DB trigger
 * `validate_activity_in_trip` (PROJECT_PLAN §6.3).
 */
export function dayBounds(window: TripWindow, date: IsoDate): DayBounds | null {
  if (!isDateInTrip(window, date)) return null;
  const day = toEpochDay(date);
  return {
    startMinute: day === toEpochDay(window.startDate) ? window.startMinute : 0,
    endMinute: day === toEpochDay(window.endDate) ? window.endMinute : MINUTES_PER_DAY,
  };
}

// --- Display formatting --------------------------------------------------------------------

/** Day of week, 0 = Sunday … 6 = Saturday. */
export function weekdayIndex(date: IsoDate): number {
  return new Date(toEpochDay(date) * MS_PER_DAY).getUTCDay();
}

/**
 * Weekday name for a day header (FR-4.3), e.g. `יום שני` in `he-IL`. Uses `Intl` with an explicit
 * locale so adding a UI language needs no new strings; same output as the prototype.
 */
export function formatWeekday(date: IsoDate, locale = 'he-IL'): string {
  return new Date(toEpochDay(date) * MS_PER_DAY).toLocaleDateString(locale, {
    weekday: 'long',
    timeZone: 'UTC',
  });
}

/**
 * Compact `D.M` date as in the prototype's day headers, e.g. `2026-11-05` → `5.11`.
 * Expects a valid ISO date; malformed input gives a meaningless label (`undefined.undefined`).
 */
export function formatShortDate(date: IsoDate): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d}.${m}`;
}

/** Full date for lists and dialogs, e.g. `12 בנובמבר 2026` in `he-IL`. */
export function formatLongDate(date: IsoDate, locale = 'he-IL'): string {
  return new Date(toEpochDay(date) * MS_PER_DAY).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Hebrew duration label, same wording as the prototype: `חצי שעה`, `שעה`, `שעה וחצי`, `שעתיים`,
 * `שעתיים וחצי`, `3 שעות`, `3 שעות וחצי`, … `24 שעות`. Off-grid values (not expected for stored
 * activities) fall back to minutes: `45 דקות`, `שעה ו-15 דקות`.
 *
 * Kept in the domain rather than i18n because Hebrew dual forms (`שעתיים`) and the `וחצי` suffix do
 * not fit key interpolation, and the import parser accepts exactly these phrases (round-trip tested).
 * A second UI language would add its own formatter next to this one.
 */
export function formatDurationHe(minutes: number): string {
  const total = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const hoursText = hours === 1 ? 'שעה' : hours === 2 ? 'שעתיים' : `${hours} שעות`;
  if (rest === 0) return hours === 0 ? '0 דקות' : hoursText;
  if (rest === 30) return hours === 0 ? 'חצי שעה' : `${hoursText} וחצי`;
  const restText = rest === 1 ? 'דקה אחת' : `${rest} דקות`;
  return hours === 0 ? restText : `${hoursText} ו-${restText}`;
}

// Pure helpers for the trip dialog (M4.2). Validation itself is `validateTripWindow` from the
// domain (DEC-023); these only shape the form state.

import {
  addDays,
  compareDates,
  MAX_END_MINUTE,
  MAX_START_MINUTE,
  MIN_END_MINUTE,
  SLOT_MINUTES,
  validateTripWindow,
  type IsoDate,
  type Minute,
  type TripWindow,
  type TripWindowError,
} from '@/domain';

/** The calendar selection: nothing, only a start day, or a complete range. */
export interface DayRange {
  from?: IsoDate;
  to?: IsoDate;
}

/** Prototype defaults for a new trip: today 10:00 until three days later at 20:00. */
export const DEFAULT_START_MINUTE = 600;
export const DEFAULT_END_MINUTE = 1200;
export const DEFAULT_TRIP_LENGTH_DAYS = 4;

export function defaultRange(today: IsoDate): Required<DayRange> {
  return { from: today, to: addDays(today, DEFAULT_TRIP_LENGTH_DAYS - 1) };
}

/**
 * FR-2.3: one calendar, first click = start day, second click = end day. A click after a complete
 * range starts a new one; a second click before the start swaps them (the earlier day starts);
 * clicking the start day again makes a one-day trip.
 */
export function nextRange(range: DayRange, day: IsoDate): DayRange {
  if (!range.from || range.to) return { from: day };
  if (compareDates(day, range.from) < 0) return { from: day, to: range.from };
  return { from: range.from, to: day };
}

/** Start-time options 00:00–23:30 (FR-2.4). */
export function startMinuteOptions(): Minute[] {
  return gridMinutes(0, MAX_START_MINUTE);
}

/** End-time options 00:30–24:00 (FR-2.4). */
export function endMinuteOptions(): Minute[] {
  return gridMinutes(MIN_END_MINUTE, MAX_END_MINUTE);
}

function gridMinutes(from: Minute, to: Minute): Minute[] {
  const result: Minute[] = [];
  for (let m = from; m <= to; m += SLOT_MINUTES) result.push(m);
  return result;
}

/** Form-level window problem: an incomplete calendar selection, or a domain `TripWindowError`. */
export type TripWindowFormError = TripWindowError | 'missing_dates' | 'missing_end';

export function windowFromForm(
  range: DayRange,
  startMinute: Minute,
  endMinute: Minute,
): TripWindow | null {
  if (!range.from || !range.to) return null;
  return { startDate: range.from, startMinute, endDate: range.to, endMinute };
}

export function tripWindowFormError(
  range: DayRange,
  startMinute: Minute,
  endMinute: Minute,
): TripWindowFormError | null {
  if (!range.from) return 'missing_dates';
  const window = windowFromForm(range, startMinute, endMinute);
  if (!window) return 'missing_end';
  return validateTripWindow(window);
}

const WINDOW_ERRORS: ReadonlySet<string> = new Set<TripWindowError>([
  'invalid_date',
  'invalid_start_minute',
  'invalid_end_minute',
  'end_not_after_start',
  'too_long',
]);

/** True if a server `validation` reason is a trip-window code (DEC-020: same as the domain). */
export function isTripWindowError(reason: string | null): reason is TripWindowError {
  return reason !== null && WINDOW_ERRORS.has(reason);
}

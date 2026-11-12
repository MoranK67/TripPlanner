// Small validation guards that mirror the DB check constraints (PROJECT_PLAN §6.2).
// Higher-level rules (canPlace, overlaps, trip-window bounds) live in the placement module (M2.3).

import {
  ACTIVITY_NAME_MAX,
  ACTIVITY_NAME_MIN,
  HEX_COLOR_PATTERN,
  ISO_DATE_PATTERN,
  MAX_ACTIVITY_MINUTES,
  MAX_END_MINUTE,
  MAX_START_MINUTE,
  MIN_ACTIVITY_MINUTES,
  MIN_END_MINUTE,
  PALETTE,
  SLOT_MINUTES,
  TRIP_NAME_MAX,
  TRIP_NAME_MIN,
} from './constants';
import type { Activity, BankActivity, HexColor, PaletteColor, PlacedActivity } from './types';

function isSlotAlignedInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max && value % SLOT_MINUTES === 0;
}

/** Any minute-of-day boundary: 0..1440 on the slot grid. */
export function isValidMinute(value: number): boolean {
  return isSlotAlignedInRange(value, 0, MAX_END_MINUTE);
}

/** A start time (trip start or activity start): 0..1410 on the slot grid. */
export function isValidStartMinute(value: number): boolean {
  return isSlotAlignedInRange(value, 0, MAX_START_MINUTE);
}

/** A trip end time on its last day: 30..1440 on the slot grid. */
export function isValidEndMinute(value: number): boolean {
  return isSlotAlignedInRange(value, MIN_END_MINUTE, MAX_END_MINUTE);
}

/** An activity duration: 30..1440 on the slot grid. */
export function isValidDuration(value: number): boolean {
  return isSlotAlignedInRange(value, MIN_ACTIVITY_MINUTES, MAX_ACTIVITY_MINUTES);
}

/**
 * Counts Unicode code points (as Postgres `char_length` does), not UTF-16 units, so client
 * validation matches the DB check. Multi-code-point emoji (e.g. with a variation selector)
 * count as several.
 */
export function nameLength(name: string): number {
  return [...name].length;
}

function isValidName(name: string, min: number, max: number): boolean {
  // Blank names are rejected even though the DB only checks length: a name of spaces is useless.
  return name.trim().length > 0 && nameLength(name) >= min && nameLength(name) <= max;
}

/** FR-2.2: 1..50 characters, not blank. */
export function isValidTripName(name: string): boolean {
  return isValidName(name, TRIP_NAME_MIN, TRIP_NAME_MAX);
}

/** FR-3.1: 1..60 characters, not blank. */
export function isValidActivityName(name: string): boolean {
  return isValidName(name, ACTIVITY_NAME_MIN, ACTIVITY_NAME_MAX);
}

/** Format check matching the DB (`^#[0-9A-Fa-f]{6}$`). */
export function isHexColor(value: string): value is HexColor {
  return HEX_COLOR_PATTERN.test(value);
}

/** Canonical form of a hex color (upper-case), as used by `PALETTE`. */
export function normalizeHexColor(value: string): string {
  return value.toUpperCase();
}

/**
 * True if the color is exactly one of the palette colors. Case-sensitive so the narrowed type
 * is correct at runtime; pass the value through `normalizeHexColor` first if it may be lower-case.
 */
export function isPaletteColor(value: string): value is PaletteColor {
  return (PALETTE as readonly string[]).includes(value);
}

/**
 * Palette color for a color cursor (FR-3.2): new activities take `paletteColorAt(trip.colorCursor)`
 * and the cursor advances by one. Wraps around; tolerates negative or non-integer cursors.
 */
export function paletteColorAt(cursor: number): PaletteColor {
  const size = PALETTE.length;
  const index = Number.isFinite(cursor) ? ((Math.trunc(cursor) % size) + size) % size : 0;
  return PALETTE[index] as PaletteColor;
}

/**
 * Strict calendar-date check for `YYYY-MM-DD` (rejects e.g. 2026-02-30, accepts 2028-02-29).
 * Years 0001–9999 are accepted, like Postgres `date` in that range.
 */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  if (y < 1) return false;
  // setUTCFullYear, unlike Date.UTC, does not map years 0–99 to 1900–1999.
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function isPlaced(activity: Activity): activity is PlacedActivity {
  return activity.placement !== null;
}

export function isInBank(activity: Activity): activity is BankActivity {
  return activity.placement === null;
}

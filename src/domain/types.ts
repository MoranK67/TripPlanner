// Shared domain types (PROJECT_PLAN §7.3). Framework-free; the data layer maps DB rows to these.
// DB column mapping is noted per field so `database.types.ts` rows can be mapped mechanically.

import type { PALETTE } from './constants';

/**
 * Minute of a day: integer 0..1440, multiple of SLOT_MINUTES (PROJECT_PLAN §4.5).
 * 1440 ("24:00") is only valid as an end. Plain `number` so DB `smallint` values map directly;
 * use the guards in `guards.ts` to validate.
 */
export type Minute = number;

/** Floating local calendar date `YYYY-MM-DD` (DB `date`), no time zone. */
export type IsoDate = string;

/** One of the 10 fixed palette colors (FR-3.2). */
export type PaletteColor = (typeof PALETTE)[number];

/** Hex color `#RRGGBB`. Stored colors are typed loosely because the palette may evolve. */
export type HexColor = string;

/** Trip time window. DB: `trips.start_date/start_minute/end_date/end_minute`. */
export interface TripWindow {
  startDate: IsoDate;
  /** 0..1410 */
  startMinute: Minute;
  endDate: IsoDate;
  /** 30..1440 */
  endMinute: Minute;
}

/** DB: `trips` row. */
export interface Trip {
  id: string;
  /** 1..50 characters (FR-2.2). */
  name: string;
  window: TripWindow;
  /** Index of the next palette color for new activities. DB: `color_cursor`. */
  colorCursor: number;
}

/** Trips list entry (PROJECT_PLAN §7.2 `tripsRepo.list`, FR-2.8). */
export interface TripSummary {
  id: string;
  name: string;
  window: TripWindow;
  /** Number of calendar days the trip covers (1..90). */
  dayCount: number;
}

/** Where a placed activity sits. DB: `activities.scheduled_date/start_minute`. */
export interface Placement {
  date: IsoDate;
  /** 0..1410; `startMinute + durationMinutes <= 1440` (no crossing midnight). */
  startMinute: Minute;
}

/** DB: `activities` row. */
export interface Activity {
  id: string;
  tripId: string;
  /** 1..60 characters (FR-3.1). */
  name: string;
  /** 30..1440, multiple of 30. */
  durationMinutes: number;
  color: HexColor;
  /** `null` = in the bank. */
  placement: Placement | null;
  /** Order within the bank (fractional). Meaningful only while unplaced. */
  bankPosition: number;
  /**
   * Group label (FEAT-2), e.g. `מרכז העיר` or `יום 3`: normalized (see `normalizeTag`), 1..30
   * characters; activities of a trip with the same tag (case-insensitive) share a colour.
   * `null` or missing = no tag. DB: `activities.tag`.
   * Always set by the data layer; optional so hand-made fixtures and optimistic objects may omit it.
   */
  tag?: string | null;
  /**
   * Creation time as returned by the DB (ISO timestamp, UTC). Used only to find a tag group's
   * oldest member (its colour is the group colour). Missing on optimistic objects. DB: `created_at`.
   */
  createdAt?: string;
}

/** An activity known to be in the timetable. */
export type PlacedActivity = Activity & { placement: Placement };

/** An activity known to be in the bank. */
export type BankActivity = Activity & { placement: null };

/** `tripsRepo.get` result (PROJECT_PLAN §7.2). */
export interface TripWithActivities {
  trip: Trip;
  activities: Activity[];
}

/** Input for creating a trip (`tripsRepo.create`) and for `tripsRepo.updateWindow`. */
export interface TripInput {
  name: string;
  window: TripWindow;
}

/** Input for creating an activity (`activitiesRepo.create`). Color defaults from the cursor. */
export interface ActivityInput {
  name: string;
  durationMinutes: number;
  color?: HexColor;
  /** FEAT-2. `null`/missing = no tag. Pass it through `normalizeTag` first. */
  tag?: string | null;
}

/** Editable activity fields (`activitiesRepo.update`, FR-3.5). */
export interface ActivityPatch {
  name?: string;
  durationMinutes?: number;
  color?: HexColor;
  /** FEAT-2. `null` (or a blank string) clears the tag; missing leaves it unchanged. */
  tag?: string | null;
  /**
   * FEAT-1, saved in the same atomic request: a placement places / moves the activity there
   * (validated with the new duration; never falls back to the bank), `null` returns it to the end
   * of the bank, missing keeps it (a placed activity whose new duration no longer fits then goes
   * to the bank, FR-3.6).
   */
  placement?: Placement | null;
}

/** One parsed line of a text import (FR-6.4). */
export type ImportRow =
  | {
      ok: true;
      name: string;
      durationMinutes: number;
      /** The source duration was rounded to the nearest slot (FR-6.3). */
      rounded: boolean;
      /** Optional third field (FEAT-2), normalized; `null` when absent or empty. */
      tag: string | null;
    }
  | {
      ok: false;
      raw: string;
      /** Machine-readable reason; the UI maps it to a Hebrew message. */
      reason: ImportRowError;
    };

/**
 * Why an import row was rejected. Extended by the parser task (M2.4) if needed; adding a member
 * is a contract change (the UI must map every code to a message).
 */
export type ImportRowError =
  /** No `;` or tab between the name and the duration. Added in M2.4. */
  | 'missing_separator'
  | 'missing_name'
  | 'name_too_long'
  | 'missing_duration'
  | 'invalid_duration'
  | 'duration_out_of_range'
  /** The third field (tag) is longer than TAG_MAX characters. Added in FEAT-2. */
  | 'tag_too_long'
  /** The third field (tag) contains control characters. Added in FEAT-2. */
  | 'tag_invalid';

// Placement from the activity dialog (FEAT-1): the user picks a day and a From/To time; the
// duration follows the range. The checks reuse the drag rules in `placement.ts`, so the dialog,
// drag, tap-to-place and the DB (PROJECT_PLAN §6.2/§6.3) agree.

import {
  MAX_ACTIVITY_MINUTES,
  MAX_END_MINUTE,
  MIN_ACTIVITY_MINUTES,
  SLOT_MINUTES,
} from './constants';
import { isIsoDate, isPlaced, isValidDuration, isValidStartMinute } from './guards';
import { canPlace, type PlacementContext } from './placement';
import { isDateInTrip } from './time';
import type { Activity, IsoDate, Minute, PlacedActivity, Placement } from './types';

/** What the dialog's Day / From / To fields describe. `endMinute` may be 1440 ("24:00"). */
export interface DialogPlacement {
  day: IsoDate;
  startMinute: Minute;
  endMinute: Minute;
}

/**
 * Why a dialog placement is rejected, in the order they are checked. The UI maps every code to a
 * Hebrew message under the matching field.
 */
export type DialogPlacementError =
  /** To is not after From. */
  | 'end_not_after_start'
  /** Shorter than MIN_ACTIVITY_MINUTES (only possible off the half-hour grid). */
  | 'too_short'
  /** Longer than MAX_ACTIVITY_MINUTES. */
  | 'too_long'
  /** From or To is not on the half-hour grid. */
  | 'off_grid'
  /** The day is not a valid date of this trip. */
  | 'invalid_day'
  /** Outside the trip hours of that day (first/last day bounds, or past 24:00). */
  | 'out_of_range'
  /** Overlaps another placed activity of the trip (half-open ranges). */
  | 'conflict_overlap';

export type DialogPlacementCheck =
  | {
      ok: true;
      /** What to save: the placement and the duration that follows from the range. */
      placement: Placement;
      durationMinutes: number;
    }
  | { ok: false; reason: Exclude<DialogPlacementError, 'conflict_overlap'> }
  | { ok: false; reason: 'conflict_overlap'; conflicts: PlacedActivity[] };

/** The activity being edited (`id`), or `id: null` for a new one. */
export interface DialogPlacementSubject {
  id: string | null;
  tripId: string;
}

function isOnGrid(minute: Minute): boolean {
  return Number.isInteger(minute) && minute % SLOT_MINUTES === 0;
}

/**
 * Duration implied by a From/To range (To − From), or `null` when that is not a storable duration
 * (To not after From, off the half-hour grid, or outside MIN..MAX_ACTIVITY_MINUTES). The dialog
 * updates its duration field with this when From or To changes.
 */
export function rangeToDuration(startMinute: Minute, endMinute: Minute): number | null {
  if (!isOnGrid(startMinute) || !isOnGrid(endMinute)) return null;
  const duration = endMinute - startMinute;
  return isValidDuration(duration) ? duration : null;
}

/**
 * To for a duration typed while placed (From stays): From + duration, or `null` if From is not a
 * valid start, the duration is not storable, or the end would pass 24:00 (no crossing midnight,
 * FR-4.6).
 */
export function durationToEnd(startMinute: Minute, durationMinutes: number): Minute | null {
  if (!isValidStartMinute(startMinute) || !isValidDuration(durationMinutes)) return null;
  const end = startMinute + durationMinutes;
  return end <= MAX_END_MINUTE ? end : null;
}

/** Day / From / To to pre-fill the dialog for a placed activity; `null` for a bank activity. */
export function activityToDialogPlacement(activity: Activity): DialogPlacement | null {
  if (!isPlaced(activity)) return null;
  const { date, startMinute } = activity.placement;
  return { day: date, startMinute, endMinute: startMinute + activity.durationMinutes };
}

/**
 * Validates the dialog's Day / From / To before save (FEAT-1). `context` is the trip window and
 * all of the trip's activities (the subject's own current placement is ignored, so moving it onto
 * a range overlapping its old one is fine). Range problems are reported first (they belong to the
 * time fields), then the day, then the `canPlace` rules: trip hours, then overlap.
 */
export function validateDialogPlacement(
  context: PlacementContext,
  subject: DialogPlacementSubject,
  input: DialogPlacement,
): DialogPlacementCheck {
  const { day, startMinute, endMinute } = input;
  const duration = endMinute - startMinute;
  if (!(duration > 0)) return { ok: false, reason: 'end_not_after_start' };
  if (duration < MIN_ACTIVITY_MINUTES) return { ok: false, reason: 'too_short' };
  if (duration > MAX_ACTIVITY_MINUTES) return { ok: false, reason: 'too_long' };
  if (!isOnGrid(startMinute) || !isOnGrid(endMinute)) return { ok: false, reason: 'off_grid' };
  if (!isIsoDate(day) || !isDateInTrip(context.window, day)) {
    return { ok: false, reason: 'invalid_day' };
  }

  const placement = { date: day, startMinute };
  // No real activity has an empty id, so a new activity never excludes an existing one.
  const check = canPlace(
    context,
    { id: subject.id ?? '', tripId: subject.tripId, durationMinutes: duration },
    placement,
  );
  if (check.ok) return { ok: true, placement, durationMinutes: duration };
  if (check.reason === 'conflict_overlap') return check;
  // On-grid, positive, ≤ 24 h ranges on a trip day only fail `canPlace` by leaving the day's
  // bounds (a negative From or a To past 24:00 are malformed for `canPlace`, out of range here).
  return { ok: false, reason: 'out_of_range' };
}

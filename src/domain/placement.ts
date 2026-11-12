// Placement rules (FR-4.2, FR-4.6, FR-2.5, FR-2.6). These mirror the DB exactly
// (PROJECT_PLAN §6.2/§6.3) so the UI can reject a drop before the server would:
//   - activities: start_minute 0..1410 on the grid, duration 30..1440 on the grid,
//     start_minute + duration_minutes <= 1440 (no crossing midnight);
//   - trigger validate_activity_in_trip: date within the trip, minutes within that day's bounds;
//   - EXCLUDE (trip_id =, scheduled_date =, int4range(start, start + duration) &&): ranges are
//     half-open, so an activity ending at 10:00 and one starting at 10:00 do not overlap;
//   - trips: (end_date, end_minute) > (start_date, start_minute), end_date - start_date <= 89.

import { MAX_TRIP_DAY_SPAN } from './constants';
import {
  isIsoDate,
  isPlaced,
  isValidDuration,
  isValidEndMinute,
  isValidStartMinute,
} from './guards';
import { dayBounds, daysBetween } from './time';
import type { Activity, Minute, PlacedActivity, Placement, TripWindow } from './types';

/**
 * Why a placement is rejected. Named after the matching `AppError` kinds (PROJECT_PLAN §4.6) so
 * the UI can reuse one message per kind for both the instant check and a server rejection.
 */
export type PlacementError = 'validation' | 'out_of_range' | 'conflict_overlap';

export type PlacementCheck =
  | { ok: true }
  | { ok: false; reason: Exclude<PlacementError, 'conflict_overlap'> }
  | { ok: false; reason: 'conflict_overlap'; conflicts: PlacedActivity[] };

/** What `canPlace` needs to know about the trip. Pass all of the trip's activities. */
export interface PlacementContext {
  window: TripWindow;
  activities: readonly Activity[];
}

/** The activity being placed or moved (an existing one, possibly with an edited duration). */
export type PlacementSubject = Pick<Activity, 'id' | 'tripId' | 'durationMinutes'>;

/** Half-open range overlap `[aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅`, like Postgres `int4range &&`. */
export function rangesOverlap(aStart: Minute, aEnd: Minute, bStart: Minute, bEnd: Minute): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function isWellFormed(target: Placement, durationMinutes: number): boolean {
  return (
    isIsoDate(target.date) &&
    isValidStartMinute(target.startMinute) &&
    isValidDuration(durationMinutes)
  );
}

/**
 * True if an activity of `durationMinutes` starting at `target` lies inside the trip window:
 * the date is a trip day and `[start, start + duration)` is within that day's enabled bounds
 * (FR-4.2), which also rules out crossing midnight (FR-4.6). Ignores other activities.
 * Malformed input (off-grid minutes, invalid duration or date) never fits.
 */
export function fitsDay(window: TripWindow, target: Placement, durationMinutes: number): boolean {
  if (!isWellFormed(target, durationMinutes)) return false;
  const bounds = dayBounds(window, target.date);
  if (!bounds) return false;
  const end = target.startMinute + durationMinutes;
  return target.startMinute >= bounds.startMinute && end <= bounds.endMinute;
}

/**
 * Placed activities of the same trip on `target.date` whose time range overlaps
 * `[target.startMinute, target.startMinute + subject.durationMinutes)`. The subject itself is
 * excluded, so moving an activity onto a range overlapping its old position is fine.
 */
export function findOverlaps(
  activities: readonly Activity[],
  subject: PlacementSubject,
  target: Placement,
): PlacedActivity[] {
  const end = target.startMinute + subject.durationMinutes;
  return activities.filter(
    (other): other is PlacedActivity =>
      isPlaced(other) &&
      other.id !== subject.id &&
      other.tripId === subject.tripId &&
      other.placement.date === target.date &&
      rangesOverlap(
        target.startMinute,
        end,
        other.placement.startMinute,
        other.placement.startMinute + other.durationMinutes,
      ),
  );
}

/**
 * Full placement check used for the drag preview (green/red, FR-5.2), tap-to-place and before
 * the optimistic update (§4.4). Checks in the order the DB would fail: malformed input →
 * outside the trip window → overlap.
 *
 * FR-3.6 (edited duration no longer fits): call with the new duration and the current placement,
 * e.g. `canPlace(ctx, { ...activity, durationMinutes: newDuration }, activity.placement)`.
 */
export function canPlace(
  context: PlacementContext,
  subject: PlacementSubject,
  target: Placement,
): PlacementCheck {
  if (!isWellFormed(target, subject.durationMinutes)) return { ok: false, reason: 'validation' };
  if (!fitsDay(context.window, target, subject.durationMinutes)) {
    return { ok: false, reason: 'out_of_range' };
  }
  const conflicts = findOverlaps(context.activities, subject, target);
  if (conflicts.length > 0) return { ok: false, reason: 'conflict_overlap', conflicts };
  return { ok: true };
}

/**
 * Placed activities that would no longer fit if the trip had `window` — they go back to the bank
 * when the window is edited (FR-2.6). Mirrors the DB trigger `unplace_out_of_range_activities`;
 * the count of this list is what the UI reports. Bank activities are never included.
 */
export function activitiesOutsideWindow(
  window: TripWindow,
  activities: readonly Activity[],
): PlacedActivity[] {
  return activities.filter(
    (activity): activity is PlacedActivity =>
      isPlaced(activity) && !fitsDay(window, activity.placement, activity.durationMinutes),
  );
}

// --- Trip window (FR-2.4, FR-2.5) --------------------------------------------------------

export type TripWindowError =
  | 'invalid_date'
  | 'invalid_start_minute'
  | 'invalid_end_minute'
  | 'end_not_after_start'
  | 'too_long';

/**
 * First reason the trip window is invalid, or `null` if it is valid. Mirrors the `trips` checks:
 * start minute 0..1410 and end minute 30..1440 on the grid; `(endDate, endMinute)` strictly
 * after `(startDate, startMinute)`; at most `MAX_TRIP_DAY_SPAN` (89) days from start to end date.
 * The trip form uses this as its single source of truth.
 */
export function validateTripWindow(window: TripWindow): TripWindowError | null {
  if (!isIsoDate(window.startDate) || !isIsoDate(window.endDate)) return 'invalid_date';
  if (!isValidStartMinute(window.startMinute)) return 'invalid_start_minute';
  if (!isValidEndMinute(window.endMinute)) return 'invalid_end_minute';
  const span = daysBetween(window.startDate, window.endDate);
  if (span < 0 || (span === 0 && window.endMinute <= window.startMinute)) {
    return 'end_not_after_start';
  }
  if (span > MAX_TRIP_DAY_SPAN) return 'too_long';
  return null;
}

/** FR-2.5: end after start (compared as date, then minute) and span ≤ 89 days. */
export function isValidTripWindow(window: TripWindow): boolean {
  return validateTripWindow(window) === null;
}

// Placement planning for a text import with day / start fields (FEAT-3). Pure: given the trip, its
// current activities and the parsed rows, it predicts where every row will go — the preview shows
// it before importing. The server (`import_activities`) applies the same rules in the same order
// and its outcome is authoritative (the timetable may change in between).

import { canPlace, rangesOverlap } from './placement';
import { addDays, tripDayCount } from './time';
import type { Activity, ImportPlacementIssue, ImportRow, Placement, TripWindow } from './types';

/**
 * Why a row that asked for a placement goes to the bank instead:
 * - `day_out_of_trip`: the day number is past the trip's last day;
 * - `outside_trip_hours`: the activity does not fit that day's enabled hours (first / last trip
 *   day bounds, or it would cross midnight);
 * - `overlaps_existing`: it overlaps an activity already in the timetable;
 * - `overlaps_import_row`: it overlaps an earlier row of the same import that was placed;
 * - `placement_incomplete` / `placement_invalid`: from the parser (see `ImportPlacementIssue`).
 */
export type ImportBankReason =
  | 'day_out_of_trip'
  | 'outside_trip_hours'
  | 'overlaps_existing'
  | 'overlaps_import_row'
  | ImportPlacementIssue;

/**
 * Where one valid import row will go. `placement` when it can be placed; otherwise `bank` with the
 * reason, or `bank: null` when the row asked for no placement (plain bank row, nothing to explain).
 */
export type ImportRowPlan =
  | { placement: Placement }
  | {
      bank: 'overlaps_existing';
      /** The existing activity it overlaps (the earliest one when several). */
      conflict: { activityName: string };
    }
  | {
      bank: 'overlaps_import_row';
      /**
       * The earlier row it overlaps: 1-based position in the `rows` passed in (invalid rows
       * included), i.e. the row's position in the import preview.
       */
      conflict: { rowNumber: number };
    }
  | { bank: Exclude<ImportBankReason, 'overlaps_existing' | 'overlaps_import_row'> }
  | { bank: null };

/** What the planner needs to know about the trip (a `Trip` fits). */
export interface ImportPlanTrip {
  id: string;
  window: TripWindow;
}

/**
 * Plans the placement of every import row (FEAT-3), one entry per input row in the same order;
 * `null` for an invalid row (it is not imported). Rows are processed in input order and an earlier
 * row wins: a row overlapping an earlier *placed* row goes to the bank. Checks, in the server's
 * order: parser issue → day number past the trip → outside the day's hours (`canPlace` bounds) →
 * overlap with an existing activity → overlap with an earlier import row. Ranges are half-open, so
 * a row may start exactly when another ends. Pass all of the trip's activities.
 */
export function planImportPlacements(
  trip: ImportPlanTrip,
  existingActivities: readonly Activity[],
  rows: readonly ImportRow[],
): (ImportRowPlan | null)[] {
  const dayCount = tripDayCount(trip.window);
  const placedRows: { rowNumber: number; placement: Placement; end: number }[] = [];
  const context = { window: trip.window, activities: existingActivities };

  return rows.map((row, index): ImportRowPlan | null => {
    if (!row.ok) return null;
    if (row.placementIssue !== null) return { bank: row.placementIssue };
    if (row.placement === null) return { bank: null };

    const { day, startMinute } = row.placement;
    if (!Number.isInteger(day) || day < 1) return { bank: 'placement_invalid' };
    if (day > dayCount) return { bank: 'day_out_of_trip' };
    const placement: Placement = { date: addDays(trip.window.startDate, day - 1), startMinute };

    // A fresh subject: no id, so no existing activity is treated as "itself".
    const subject = { id: '', tripId: trip.id, durationMinutes: row.durationMinutes };
    const check = canPlace(context, subject, placement);
    if (!check.ok) {
      if (check.reason === 'conflict_overlap') {
        const [first] = [...check.conflicts].sort(
          (a, b) => a.placement.startMinute - b.placement.startMinute,
        );
        return { bank: 'overlaps_existing', conflict: { activityName: first?.name ?? '' } };
      }
      // `validation` cannot happen for a parsed row (grid start, valid duration); kept defensive.
      return { bank: check.reason === 'out_of_range' ? 'outside_trip_hours' : 'placement_invalid' };
    }

    const end = startMinute + row.durationMinutes;
    const earlier = placedRows.find(
      (other) =>
        other.placement.date === placement.date &&
        rangesOverlap(startMinute, end, other.placement.startMinute, other.end),
    );
    if (earlier) return { bank: 'overlaps_import_row', conflict: { rowNumber: earlier.rowNumber } };

    placedRows.push({ rowNumber: index + 1, placement, end });
    return { placement };
  });
}

// What an import sends and what came of it (FEAT-3). Pure helpers for the import dialog: they
// build the RPC items from the preview rows and map the server's per-item outcomes back onto the
// preview rows, in the same shape as `planImportPlacements` so both read the same way.

import type { ImportedActivity } from '@/data';
import {
  addDays,
  type Activity,
  type ImportItemInput,
  type ImportRow,
  type ImportRowPlan,
  type ImportType,
  type TripWindow,
} from '@/domain';

/** The RPC items and, for each, the 0-based index of the preview row it came from. */
export interface ImportRequest {
  items: ImportItemInput[];
  rowIndexes: number[];
}

/**
 * The items to send for the valid preview rows, in order. Placement fields are used only for the
 * `placement` type: the day number becomes a date of the trip (day 1 = the start date). A day past
 * the trip is sent as is; the server banks it with `day_out_of_trip`, like the preview. Rows whose
 * placement fields the parser rejected send no placement (the preview shows the parser's reason).
 */
export function buildImportRequest(
  rows: readonly ImportRow[],
  type: ImportType,
  window: TripWindow,
): ImportRequest {
  const items: ImportItemInput[] = [];
  const rowIndexes: number[] = [];
  rows.forEach((row, index) => {
    if (!row.ok) return;
    const item: ImportItemInput = { name: row.name, durationMinutes: row.durationMinutes };
    if (row.tag !== null) item.tag = row.tag;
    if (type === 'placement' && row.placement !== null) {
      item.placement = {
        date: addDays(window.startDate, row.placement.day - 1),
        startMinute: row.placement.startMinute,
      };
    }
    items.push(item);
    rowIndexes.push(index);
  });
  return { items, rowIndexes };
}

/**
 * The server's outcome for every preview row (`null` for a row that was not sent). The server is
 * authoritative: the timetable may have changed since the preview. Mapping:
 * - `placed` → the activity's placement;
 * - `overlaps_existing` → the name of the activity it overlaps (from the trip's activities
 *   before the import; empty when unknown);
 * - `overlaps_import_row` → the server's 1-based index among the items SENT, converted to the
 *   preview row number (1-based among all preview rows, invalid rows included);
 * - no reason → the parser's placement issue, if any: such rows were sent without a placement,
 *   so the server had nothing to explain.
 */
export function serverRowPlans(
  rows: readonly ImportRow[],
  request: { readonly rowIndexes: readonly number[] },
  outcomes: readonly ImportedActivity[],
  activitiesBefore: readonly Activity[],
): (ImportRowPlan | null)[] {
  const plans: (ImportRowPlan | null)[] = rows.map(() => null);
  outcomes.forEach((outcome, i) => {
    const index = request.rowIndexes[i];
    if (index === undefined) return;
    plans[index] = outcomePlan(rows[index], outcome, request.rowIndexes, activitiesBefore);
  });
  return plans;
}

function outcomePlan(
  row: ImportRow | undefined,
  outcome: ImportedActivity,
  rowIndexes: readonly number[],
  activitiesBefore: readonly Activity[],
): ImportRowPlan {
  const { activity, placed, bankReason } = outcome;
  if (placed && activity.placement) return { placement: activity.placement };
  switch (bankReason) {
    case null: {
      const issue = row?.ok ? row.placementIssue : null;
      return { bank: issue ?? null };
    }
    case 'overlaps_existing': {
      const other = activitiesBefore.find((a) => a.id === outcome.conflictActivityId);
      return { bank: bankReason, conflict: { activityName: other?.name ?? '' } };
    }
    case 'overlaps_import_row': {
      const sent = outcome.conflictItem === null ? undefined : rowIndexes[outcome.conflictItem - 1];
      // 0 = unknown row (should not happen); the UI then shows the generic overlap reason.
      return { bank: bankReason, conflict: { rowNumber: sent === undefined ? 0 : sent + 1 } };
    }
    default:
      return { bank: bankReason };
  }
}

/** How many planned rows are placed and how many go to the bank (`null` entries are skipped). */
export function countDestinations(plans: readonly (ImportRowPlan | null)[]): {
  placed: number;
  banked: number;
} {
  let placed = 0;
  let banked = 0;
  for (const plan of plans) {
    if (plan === null) continue;
    if ('placement' in plan) placed += 1;
    else banked += 1;
  }
  return { placed, banked };
}

/**
 * Preview rows the preview expected to place but the server banked (the timetable changed in
 * between), as 0-based preview row indexes.
 */
export function unexpectedlyBanked(
  preview: readonly (ImportRowPlan | null)[],
  server: readonly (ImportRowPlan | null)[],
): number[] {
  const result: number[] = [];
  preview.forEach((plan, index) => {
    const outcome = server[index];
    if (plan && 'placement' in plan && outcome && !('placement' in outcome)) result.push(index);
  });
  return result;
}

// activitiesRepo (PROJECT_PLAN §7.2). All methods throw AppError.
//
// DB realities (DEC-019/DEC-020/DEC-022):
//   - placement changes only through RPCs place_activity / unplace_activity / update_activity;
//   - edits go through RPC update_activity (atomic FR-3.6; FEAT-1 also places / unplaces in the
//     same call), never a plain UPDATE;
//   - same tag ⇒ same colour is applied by the DB (FEAT-2): the returned colour is authoritative;
//   - color and bank_position are assigned by the insert trigger when omitted.

import type { Activity, ActivityInput, ActivityPatch, IsoDate, Minute } from '@/domain';
import { runDb, runDbRequired, safeClientGetter } from './execute';
import {
  activityFromRow,
  activityInsertFromInput,
  activityUpdateFromJson,
  importItemsFromInputs,
  updateActivityArgs,
} from './mapping';
import { getSupabase, type TypedSupabaseClient } from './supabaseClient';
import {
  assertActivityInput,
  assertActivityPatch,
  assertImportItems,
  assertPlacementTarget,
} from './validation';

/** Result of `activitiesRepo.update`. */
export interface ActivityUpdateResult {
  activity: Activity;
  /** The new duration no longer fitted the activity's slot, so it went back to the bank (FR-3.6). */
  returnedToBank: boolean;
}

export interface ActivitiesRepo {
  /**
   * New bank activity; color from the trip's cursor unless given (FR-3.2). With a tag another
   * activity of the trip already has, the DB gives it that group's colour instead (FEAT-2).
   * Errors: validation (reason name / duration_minutes / color / tag), not_found.
   */
  create(tripId: string, input: ActivityInput): Promise<Activity>;
  /**
   * RPC update_activity, one atomic request: name / duration / color / tag (FR-3.5, FEAT-2) and,
   * optionally, the placement (FEAT-1). Absent fields keep their value.
   *   - `placement` given: placed / moved there with the new duration. Errors: out_of_range
   *     (reason outside_trip_window), conflict_overlap (reason overlap); never sent to the bank.
   *   - `placement: null`: back to the end of the bank (already in the bank: position kept).
   *   - `placement` absent: if a placed activity's new duration would leave its day or overlap a
   *     neighbour, the RPC moves it to the bank (`returnedToBank`, FR-3.6).
   * A tag that joins a group gives the activity the group's colour even if `color` was passed:
   * use the returned activity, not the optimistic one.
   * Errors: validation (reason activity_id / name / duration_minutes / color / tag / placement /
   * scheduled_date / start_minute), out_of_range, conflict_overlap, not_found (activity / trip).
   */
  update(id: string, patch: ActivityPatch): Promise<ActivityUpdateResult>;
  /**
   * Deleting a missing activity is a no-op: the result cannot tell "deleted now" from "already
   * gone" (or not accessible — RLS hides other users' rows).
   */
  delete(id: string): Promise<void>;
  /** RPC place_activity: place or move. Errors: conflict_overlap, out_of_range, not_found. */
  place(id: string, date: IsoDate, startMinute: Minute): Promise<Activity>;
  /** RPC unplace_activity: back to the end of the bank (FR-3.7). */
  unplace(id: string): Promise<Activity>;
  /**
   * RPC import_activities: up to 200 bank activities in one transaction, in input order, with
   * optional tags (FEAT-2; same tag ⇒ same colour). Errors: validation `item:<n>:<field>`.
   */
  importMany(tripId: string, items: readonly ActivityInput[]): Promise<Activity[]>;
}

export function createActivitiesRepo(getClient: () => TypedSupabaseClient): ActivitiesRepo {
  const client = safeClientGetter(getClient);

  async function unplaceRow(id: string) {
    const db = client();
    const row = await runDbRequired(
      db,
      () => db.rpc('unplace_activity', { activity_id: id }),
      'activity',
    );
    return activityFromRow(row);
  }

  return {
    async create(tripId, input) {
      assertActivityInput(input);
      const db = client();
      const row = await runDbRequired(
        db,
        () =>
          db.from('activities').insert(activityInsertFromInput(tripId, input)).select().single(),
        'activity',
      );
      return activityFromRow(row);
    },

    async update(id, patch) {
      assertActivityPatch(patch);
      const db = client();
      // One code path, also for an empty patch: NULL arguments keep the current values. Without
      // a placement the RPC moves a placed activity to the bank atomically when the new duration
      // no longer fits (FR-3.6); with one it raises TP_OUT_OF_RANGE / TP_OVERLAP instead.
      const json = await runDb(db, () => db.rpc('update_activity', updateActivityArgs(id, patch)));
      return activityUpdateFromJson(json);
    },

    async delete(id) {
      const db = client();
      await runDb(db, () => db.from('activities').delete().eq('id', id));
    },

    async place(id, date, startMinute) {
      assertPlacementTarget({ date, startMinute });
      const db = client();
      const row = await runDbRequired(
        db,
        () =>
          db.rpc('place_activity', {
            activity_id: id,
            scheduled_date: date,
            start_minute: startMinute,
          }),
        'activity',
      );
      return activityFromRow(row);
    },

    async unplace(id) {
      return unplaceRow(id);
    },

    async importMany(tripId, items) {
      assertImportItems(items);
      if (items.length === 0) return [];
      const db = client();
      const rows = await runDb(db, () =>
        db.rpc('import_activities', { trip_id: tripId, items: importItemsFromInputs(items) }),
      );
      return (rows ?? []).map(activityFromRow);
    },
  };
}

export const activitiesRepo: ActivitiesRepo = createActivitiesRepo(getSupabase);

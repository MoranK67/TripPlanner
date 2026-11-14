// tripsRepo (PROJECT_PLAN §7.2). All methods throw AppError.

import type { Trip, TripInput, TripSummary, TripWithActivities } from '@/domain';
import { runDb, runDbRequired, safeClientGetter } from './execute';
import {
  TRIP_SUMMARY_COLUMNS,
  tripFromRow,
  tripInsertFromInput,
  tripSummaryFromRow,
  tripWithActivitiesFromRow,
  tripWindowUpdateFromJson,
  updateTripWindowArgs,
} from './mapping';
import { getSupabase, type TypedSupabaseClient } from './supabaseClient';
import { assertTripInput } from './validation';

/** Result of `tripsRepo.updateWindow`: `movedCount` activities went back to the bank (FR-2.6). */
export interface TripWindowUpdate {
  trip: Trip;
  movedCount: number;
}

export interface TripsRepo {
  /** All accessible trips, sorted by start (FR-2.8). */
  list(): Promise<TripSummary[]>;
  /** The trip with all its activities (placed and bank), bank order ascending. */
  get(tripId: string): Promise<TripWithActivities>;
  create(input: TripInput): Promise<Trip>;
  /** Name + window via RPC `update_trip_window`; out-of-window activities return to the bank. */
  updateWindow(tripId: string, input: TripInput): Promise<TripWindowUpdate>;
  /**
   * Deletes the trip and (by cascade) its activities. Deleting a missing trip is a no-op: the
   * result cannot tell "deleted now" from "already gone" (or not accessible under RLS).
   */
  delete(tripId: string): Promise<void>;
}

export function createTripsRepo(getClient: () => TypedSupabaseClient): TripsRepo {
  const client = safeClientGetter(getClient);
  return {
    async list() {
      const db = client();
      const rows = await runDb(db, () =>
        db
          .from('trips')
          .select(TRIP_SUMMARY_COLUMNS)
          .order('start_date', { ascending: true })
          .order('start_minute', { ascending: true })
          .order('name', { ascending: true }),
      );
      return (rows ?? []).map(tripSummaryFromRow);
    },

    async get(tripId) {
      const db = client();
      // One request, so the trip and its activities come from the same snapshot.
      const row = await runDbRequired(
        db,
        () =>
          db
            .from('trips')
            .select('*, activities(*)')
            .eq('id', tripId)
            .order('bank_position', { referencedTable: 'activities', ascending: true })
            .maybeSingle(),
        'trip',
      );
      return tripWithActivitiesFromRow(row);
    },

    async create(input) {
      assertTripInput(input);
      const db = client();
      const row = await runDbRequired(
        db,
        () => db.from('trips').insert(tripInsertFromInput(input)).select().single(),
        'trip',
      );
      return tripFromRow(row);
    },

    async updateWindow(tripId, input) {
      assertTripInput(input);
      const db = client();
      const json = await runDb(db, () =>
        db.rpc('update_trip_window', updateTripWindowArgs(tripId, input)),
      );
      return tripWindowUpdateFromJson(json);
    },

    async delete(tripId) {
      const db = client();
      await runDb(db, () => db.from('trips').delete().eq('id', tripId));
    },
  };
}

export const tripsRepo: TripsRepo = createTripsRepo(getSupabase);

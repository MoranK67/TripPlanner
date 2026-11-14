// backupRepo (PROJECT_PLAN §7.2, FR-8.1/FR-8.2, DEC-033). All methods throw AppError.
//
// importAll: add-only, all-or-nothing, one call to RPC `import_trips` (one transaction).
// Retry policy (DEC-032/DEC-033): the import is never re-sent after an error that may have
// committed. The only automatic re-run is runDb's single retry of 40P01 (deadlock) / 40001
// (serialization failure): Postgres reports those only after rolling the whole transaction
// back, so nothing was stored and running it again cannot duplicate trips. A network error or
// timeout may hide a commit, so it is reported with `retryable: false` — the UI must tell the
// user to check the trips list before importing again.

import type { BackupTrip, TripWithActivities } from '@/domain';
import { AppError, type AppErrorLocation } from './errors';
import { runDb, safeClientGetter } from './execute';
import {
  importTripsCountsFromJson,
  importTripsFromBackup,
  tripWithActivitiesFromRow,
  type ImportTripsCounts,
} from './mapping';
import { getSupabase, type TypedSupabaseClient } from './supabaseClient';
import { assertBackupTrips } from './validation';

export interface BackupRepo {
  /**
   * All of the user's trips with all their activities, for a backup file (FR-8.2). One request,
   * so every trip comes from the same snapshot. Trips are sorted like `tripsRepo.list`; each
   * trip's activities by bank position (`toBackupTrip` puts them in file order).
   */
  exportAll(): Promise<TripWithActivities[]>;
  /**
   * Creates every trip of a parsed backup (`parseBackup(...).trips`) with its activities, in one
   * transaction: either everything is stored or nothing is. Never touches existing trips.
   *
   * Errors (AppError). `location` holds 0-based indexes into `trips` (not file indexes: trips
   * the parser skipped are not in `trips`); `reason` is the bare code:
   *   - validation, no location: 'trips' (empty), 'too_many_trips', 'too_many_activities';
   *   - validation, trip location: 'name', a TripWindowError, 'color_cursor', 'trip' (malformed);
   *   - validation, activity location: 'name', 'duration_minutes', 'color', 'scheduled_date',
   *     'start_minute', 'item' (malformed);
   *   - conflict_overlap ('overlap') / out_of_range ('outside_trip_window'), activity location;
   *   - network (reason 'timeout' after the 15 s deadline), retryable false — see above;
   *   - auth_expired, unknown as for any request.
   * Validation errors are also raised before the request by the same rules (`assertBackupTrips`).
   */
  importAll(trips: readonly BackupTrip[]): Promise<ImportTripsCounts>;
}

/** `trip:<n>[:item:<m>][:<reason>]` (1-based) in TP_VALIDATION details. */
const VALIDATION_DETAIL = /^trip:(\d+)(?::item:(\d+))?(?::(.+))?$/;
/** `trip:<n>:item:<m> …` (1-based; 0 = not inside a trip / item) in TP_OVERLAP/OUT_OF_RANGE hints. */
const PLACEMENT_HINT = /^trip:(\d+):item:(\d+)\b/;

function toLocation(trip: string, item: string | undefined): AppErrorLocation | null {
  const tripNumber = Number(trip);
  if (tripNumber < 1) return null;
  const itemNumber = item === undefined ? 0 : Number(item);
  return { tripIndex: tripNumber - 1, activityIndex: itemNumber < 1 ? null : itemNumber - 1 };
}

function hintOf(cause: unknown): string | null {
  if (typeof cause !== 'object' || cause === null) return null;
  const hint = (cause as { hint?: unknown }).hint;
  return typeof hint === 'string' ? hint : null;
}

function withChanges(
  error: AppError,
  changes: { reason?: string | null; location?: AppErrorLocation | null; retryable?: boolean },
): AppError {
  return new AppError(error.kind, {
    reason: error.reason,
    retryable: error.retryable,
    code: error.code,
    status: error.status,
    cause: error.cause,
    location: error.location,
    ...changes,
  });
}

/** Rewrites an `import_trips` error to the shape documented on `BackupRepo.importAll`. */
export function toImportError(error: AppError): AppError {
  if (error.kind === 'network') {
    // The request may have reached the server and committed: never offer a blind retry.
    return error.retryable ? withChanges(error, { retryable: false }) : error;
  }
  if (error.code === 'TP_VALIDATION' && error.reason !== null) {
    const match = VALIDATION_DETAIL.exec(error.reason);
    if (match) {
      const [, trip = '', item, reason] = match;
      return withChanges(error, {
        reason: reason ?? (item === undefined ? 'trip' : 'item'),
        location: toLocation(trip, item),
      });
    }
    return error;
  }
  if (error.code === 'TP_OVERLAP' || error.code === 'TP_OUT_OF_RANGE') {
    const match = PLACEMENT_HINT.exec(hintOf(error.cause) ?? '');
    if (match) {
      const [, trip = '', item] = match;
      return withChanges(error, { location: toLocation(trip, item) });
    }
  }
  return error;
}

export function createBackupRepo(getClient: () => TypedSupabaseClient): BackupRepo {
  const client = safeClientGetter(getClient);
  return {
    async exportAll() {
      const db = client();
      const rows = await runDb(db, () =>
        db
          .from('trips')
          .select('*, activities(*)')
          .order('start_date', { ascending: true })
          .order('start_minute', { ascending: true })
          .order('name', { ascending: true })
          .order('bank_position', { referencedTable: 'activities', ascending: true }),
      );
      return (rows ?? []).map(tripWithActivitiesFromRow);
    },

    async importAll(trips) {
      assertBackupTrips(trips);
      const db = client();
      const payload = importTripsFromBackup(trips);
      const json = await runDb(db, () => db.rpc('import_trips', { trips: payload })).catch(
        (error: unknown) => {
          throw error instanceof AppError ? toImportError(error) : error;
        },
      );
      return importTripsCountsFromJson(json);
    },
  };
}

export const backupRepo: BackupRepo = createBackupRepo(getSupabase);

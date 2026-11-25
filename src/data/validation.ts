// Client-side pre-checks before a write (PROJECT_PLAN §4.6: inputs validated client-side and by
// the DB). They use the domain rules, so a bad input fails fast with the same `reason` codes the
// DB reports in TP_VALIDATION details ('name', 'duration_minutes', 'color', 'tag',
// TripWindowError, 'item:<n>:<field>', 'too_many_items', 'scheduled_date', 'start_minute').
// Backup import (assertBackupTrips) uses the import_trips contract instead: the bare reason plus
// an AppError `location` (see backupRepo.ts).

import {
  MAX_BACKUP_ACTIVITIES,
  MAX_BACKUP_TRIPS,
  MAX_IMPORT_ROWS,
  isHexColor,
  isIsoDate,
  isValidActivityName,
  isValidDuration,
  isValidStartMinute,
  isValidTripName,
  normalizeTag,
  validateTag,
  validateTripWindow,
  type ActivityInput,
  type ActivityPatch,
  type BackupTrip,
  type Placement,
  type TripInput,
} from '@/domain';
import { AppError, type AppErrorLocation } from './errors';

function fail(reason: string, location: AppErrorLocation | null = null): never {
  throw new AppError('validation', { reason, location });
}

export function assertTripInput(input: TripInput): void {
  if (!isValidTripName(input.name)) fail('name');
  const windowError = validateTripWindow(input.window);
  if (windowError !== null) fail(windowError);
}

function activityFieldError(fields: ActivityPatch): string | null {
  if (fields.name !== undefined && !isValidActivityName(fields.name)) return 'name';
  if (fields.durationMinutes !== undefined && !isValidDuration(fields.durationMinutes)) {
    return 'duration_minutes';
  }
  if (fields.color !== undefined && !isHexColor(fields.color)) return 'color';
  // The tag is checked as it will be sent (normalized); blank means "no tag" and is fine.
  const tag = normalizeTag(fields.tag);
  if (tag !== null && validateTag(tag) !== null) return 'tag';
  return null;
}

export function assertActivityPatch(patch: ActivityPatch): void {
  const error = activityFieldError(patch);
  if (error !== null) fail(error);
  if (patch.placement) assertPlacementTarget(patch.placement);
}

export function assertActivityInput(input: ActivityInput): void {
  const error = activityFieldError(input);
  if (error !== null) fail(error);
}

/** FR-6.5: at most 200 items; every item valid. Reasons use the RPC's 1-based `item:<n>:…`. */
export function assertImportItems(items: readonly ActivityInput[]): void {
  if (items.length > MAX_IMPORT_ROWS) fail('too_many_items');
  items.forEach((item, index) => {
    const error = activityFieldError(item);
    if (error !== null) fail(`item:${index + 1}:${error}`);
  });
}

/** Well-formedness only; window and overlap are checked by `canPlace` and by the RPC. */
export function assertPlacementTarget(target: Placement): void {
  if (!isIsoDate(target.date)) fail('scheduled_date');
  if (!isValidStartMinute(target.startMinute)) fail('start_minute');
}

/**
 * Pre-check of a backup import (FR-8.1/FR-8.2, DEC-033), in the same order and with the same
 * reasons as RPC `import_trips` (supabase/migrations/20261114120000_m6_import_trips.sql), so a
 * bad input fails the same way with or without the round trip:
 *   'trips' (empty), 'too_many_trips', 'too_many_activities' — no location;
 *   per trip: 'name', TripWindowError, 'color_cursor' — location { tripIndex, null };
 *   per activity: 'name', 'duration_minutes', 'color', 'scheduled_date', 'start_minute' —
 *   location { tripIndex, activityIndex }.
 * Placements are only checked for well-formedness; window and overlap are the RPC's job
 * (`parseBackup` has already sent bad placements to the bank).
 */
export function assertBackupTrips(trips: readonly BackupTrip[]): void {
  if (trips.length === 0) fail('trips');
  if (trips.length > MAX_BACKUP_TRIPS) fail('too_many_trips');
  const activityCount = trips.reduce((sum, trip) => sum + trip.activities.length, 0);
  if (activityCount > MAX_BACKUP_ACTIVITIES) fail('too_many_activities');

  trips.forEach((trip, tripIndex) => {
    const tripAt = { tripIndex, activityIndex: null };
    if (!isValidTripName(trip.name)) fail('name', tripAt);
    const windowError = validateTripWindow(trip.window);
    if (windowError !== null) fail(windowError, tripAt);
    if (!Number.isInteger(trip.colorCursor) || trip.colorCursor < 0) fail('color_cursor', tripAt);

    trip.activities.forEach((activity, activityIndex) => {
      const at = { tripIndex, activityIndex };
      const error = activityFieldError(activity);
      if (error !== null) fail(error, at);
      if (activity.placement !== null) {
        if (!isIsoDate(activity.placement.date)) fail('scheduled_date', at);
        if (!isValidStartMinute(activity.placement.startMinute)) fail('start_minute', at);
      }
    });
  });
}

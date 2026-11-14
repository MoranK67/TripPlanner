// Hebrew messages for backup files (FR-8.1, FR-8.2): every parse error, warning and import error
// reason maps to an i18n key under `backup.*`. The maps are full `Record`s over the domain's code
// unions, so a new code fails the typecheck until it gets a Hebrew message.

import type { TFunction } from 'i18next';
import { toAppError } from '@/data';
import {
  ACTIVITY_NAME_MAX,
  MAX_BACKUP_ACTIVITIES,
  MAX_BACKUP_TRIPS,
  MAX_TRIP_DAYS,
  TRIP_NAME_MAX,
  type BackupFormat,
  type BackupParseError,
  type BackupTrip,
  type BackupWarning,
  type BackupWarningCode,
  type TripWindowError,
} from '@/domain';
import { errorMessage } from '@/i18n/errors';

/** Values every backup message may interpolate. */
export const BACKUP_MESSAGE_PARAMS = {
  tripNameMax: TRIP_NAME_MAX,
  activityNameMax: ACTIVITY_NAME_MAX,
  maxTrips: MAX_BACKUP_TRIPS,
  maxActivities: MAX_BACKUP_ACTIVITIES,
  maxDays: MAX_TRIP_DAYS,
} as const;

export const BACKUP_FORMAT_KEYS: Readonly<Record<BackupFormat, string>> = {
  prototype: 'backup.formats.prototype',
  app: 'backup.formats.app',
};

export const BACKUP_PARSE_ERROR_KEYS: Readonly<Record<BackupParseError, string>> = {
  too_large: 'backup.parseErrors.too_large',
  invalid_json: 'backup.parseErrors.invalid_json',
  unknown_format: 'backup.parseErrors.unknown_format',
  unsupported_version: 'backup.parseErrors.unsupported_version',
  invalid_structure: 'backup.parseErrors.invalid_structure',
  no_trips: 'backup.parseErrors.no_trips',
  no_valid_trips: 'backup.parseErrors.no_valid_trips',
  too_many_trips: 'backup.parseErrors.too_many_trips',
  too_many_activities: 'backup.parseErrors.too_many_activities',
};

export const BACKUP_WARNING_KEYS: Readonly<Record<BackupWarningCode, string>> = {
  trip_invalid: 'backup.warnings.trip_invalid',
  trip_name_invalid: 'backup.warnings.trip_name_invalid',
  trip_window_invalid: 'backup.warnings.trip_window_invalid',
  activity_invalid: 'backup.warnings.activity_invalid',
  activity_name_invalid: 'backup.warnings.activity_name_invalid',
  activity_duration_invalid: 'backup.warnings.activity_duration_invalid',
  activity_color_replaced: 'backup.warnings.activity_color_replaced',
  placement_invalid: 'backup.warnings.placement_invalid',
  placement_out_of_range: 'backup.warnings.placement_out_of_range',
  placement_overlap: 'backup.warnings.placement_overlap',
};

/** `backupRepo.importAll` validation reasons without a location (see BackupRepo docs). */
export type ImportGeneralReason = 'trips' | 'too_many_trips' | 'too_many_activities';
/** Reasons with a trip location. */
export type ImportTripReason = 'trip' | 'name' | 'color_cursor' | TripWindowError;
/** Reasons with an activity location (validation, `overlap`, `outside_trip_window`). */
export type ImportActivityReason =
  | 'item'
  | 'name'
  | 'duration_minutes'
  | 'color'
  | 'scheduled_date'
  | 'start_minute'
  | 'overlap'
  | 'outside_trip_window';

export const IMPORT_GENERAL_REASON_KEYS: Readonly<Record<ImportGeneralReason, string>> = {
  trips: 'backup.importErrors.general.trips',
  too_many_trips: 'backup.importErrors.general.too_many_trips',
  too_many_activities: 'backup.importErrors.general.too_many_activities',
};

export const IMPORT_TRIP_REASON_KEYS: Readonly<Record<ImportTripReason, string>> = {
  trip: 'backup.importErrors.trip.trip',
  name: 'backup.importErrors.trip.name',
  color_cursor: 'backup.importErrors.trip.color_cursor',
  invalid_date: 'backup.importErrors.trip.invalid_date',
  invalid_start_minute: 'backup.importErrors.trip.invalid_start_minute',
  invalid_end_minute: 'backup.importErrors.trip.invalid_end_minute',
  end_not_after_start: 'backup.importErrors.trip.end_not_after_start',
  too_long: 'backup.importErrors.trip.too_long',
};

export const IMPORT_ACTIVITY_REASON_KEYS: Readonly<Record<ImportActivityReason, string>> = {
  item: 'backup.importErrors.activity.item',
  name: 'backup.importErrors.activity.name',
  duration_minutes: 'backup.importErrors.activity.duration_minutes',
  color: 'backup.importErrors.activity.color',
  scheduled_date: 'backup.importErrors.activity.scheduled_date',
  start_minute: 'backup.importErrors.activity.start_minute',
  overlap: 'backup.importErrors.activity.overlap',
  outside_trip_window: 'backup.importErrors.activity.outside_trip_window',
};

function keyFor<K extends string>(map: Readonly<Record<K, string>>, reason: string | null) {
  return reason !== null && Object.prototype.hasOwnProperty.call(map, reason)
    ? map[reason as K]
    : undefined;
}

function hasText(name: string | null | undefined): name is string {
  return typeof name === 'string' && name.trim() !== '';
}

/** `טיול "רומא"`, or `טיול מספר 3` when the file has no usable name. */
function tripLabel(name: string | null | undefined, index: number, t: TFunction): string {
  return hasText(name)
    ? t('backup.where.trip', { name })
    : t('backup.where.tripNumber', { n: index + 1 });
}

function placeLabel(
  tripName: string | null | undefined,
  tripIndex: number,
  activityName: string | null | undefined,
  activityIndex: number | null,
  t: TFunction,
): string {
  const trip = tripLabel(tripName, tripIndex, t);
  if (activityIndex === null) return trip;
  const activity = hasText(activityName)
    ? t('backup.where.activity', { name: activityName })
    : t('backup.where.activityNumber', { n: activityIndex + 1 });
  return t('backup.where.activityInTrip', { activity, trip });
}

/** One warning as a Hebrew line: `<where>: <what happens>`. Indexes are file positions. */
export function warningMessage(warning: BackupWarning, t: TFunction): string {
  return t('backup.where.line', {
    where: placeLabel(
      warning.tripName,
      warning.tripIndex,
      warning.activityName,
      warning.activityIndex,
      t,
    ),
    message: t(BACKUP_WARNING_KEYS[warning.code], BACKUP_MESSAGE_PARAMS),
  });
}

export function parseErrorMessage(error: BackupParseError, t: TFunction): string {
  return t(BACKUP_PARSE_ERROR_KEYS[error], BACKUP_MESSAGE_PARAMS);
}

/** "3 טיולים" / "שתי אטרקציות" / "בלי אטרקציות". */
export function tripCountLabel(count: number, t: TFunction): string {
  return t('backup.count.trips', { count });
}

export function activityCountLabel(count: number, t: TFunction): string {
  return count === 0 ? t('backup.count.noActivities') : t('backup.count.activities', { count });
}

/**
 * Hebrew message for a failed `backupRepo.importAll(trips)`. A network error may hide a commit
 * (DEC-033), so it says the outcome is unknown and asks the user to check the trips list before
 * importing again. Other errors rolled everything back; a `location` names the trip / activity.
 */
export function importErrorMessage(
  error: unknown,
  trips: readonly BackupTrip[],
  t: TFunction,
): string {
  const appError = toAppError(error);
  if (appError.kind === 'network') {
    return t('backup.import.uncertain', {
      reason: t(
        appError.reason === 'timeout' ? 'backup.import.timeout' : 'backup.import.connectionLost',
      ),
    });
  }

  let detail: string;
  const location = appError.location;
  if (location) {
    const trip = trips[location.tripIndex];
    const activity =
      location.activityIndex === null ? undefined : trip?.activities[location.activityIndex];
    const key =
      location.activityIndex === null
        ? keyFor(IMPORT_TRIP_REASON_KEYS, appError.reason)
        : keyFor(IMPORT_ACTIVITY_REASON_KEYS, appError.reason);
    detail = t('backup.where.line', {
      where: placeLabel(trip?.name, location.tripIndex, activity?.name, location.activityIndex, t),
      message: key ? t(key, BACKUP_MESSAGE_PARAMS) : errorMessage(appError, t),
    });
  } else {
    const key =
      appError.kind === 'validation'
        ? keyFor(IMPORT_GENERAL_REASON_KEYS, appError.reason)
        : undefined;
    detail = key ? t(key, BACKUP_MESSAGE_PARAMS) : errorMessage(appError, t);
  }
  return t('backup.import.failed', { reason: detail });
}

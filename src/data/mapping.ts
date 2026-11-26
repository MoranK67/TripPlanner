// Row ⇄ domain mapping (PROJECT_PLAN §7.3, DEC-009). snake_case DB rows become the camelCase
// domain types; nothing outside src/data sees a DB row.
//
// Writes only ever contain columns the `authenticated` role may write (column-level UPDATE
// grants, DEC-019): activities name/duration_minutes/color/tag; placement goes through the RPCs.
// Tags are always sent as `normalizeTag` output (FEAT-2): the DB only trims, so a client that
// sent other spellings would group differently from what the UI previews.

import {
  normalizeHexColor,
  normalizeTag,
  tripDayCount,
  type Activity,
  type ActivityInput,
  type ActivityPatch,
  type BackupTrip,
  type ImportBankReason,
  type ImportItemInput,
  type Placement,
  type Trip,
  type TripInput,
  type TripSummary,
  type TripWindow,
  type TripWithActivities,
} from '@/domain';
import type { Database, Json } from './database.types';
import { AppError } from './errors';

type PublicSchema = Database['public'];
export type TripRow = PublicSchema['Tables']['trips']['Row'];
export type TripInsert = PublicSchema['Tables']['trips']['Insert'];
export type ActivityRow = PublicSchema['Tables']['activities']['Row'];
export type ActivityInsert = PublicSchema['Tables']['activities']['Insert'];
export type UpdateActivityArgs = PublicSchema['Functions']['update_activity']['Args'];
export type UpdateTripWindowArgs = PublicSchema['Functions']['update_trip_window']['Args'];

/** Columns selected for the trips list (no need for the cursor or timestamps). */
export const TRIP_SUMMARY_COLUMNS = 'id, name, start_date, start_minute, end_date, end_minute';
export type TripSummaryRow = Pick<
  TripRow,
  'id' | 'name' | 'start_date' | 'start_minute' | 'end_date' | 'end_minute'
>;

/**
 * One item of the `import_activities` RPC payload (snake_case, as the RPC expects). FEAT-3: the
 * placement keys are sent together, only when a placement is requested.
 */
export interface ImportItemJson {
  [key: string]: Json | undefined;
  name: string;
  duration_minutes: number;
  color?: string;
  tag?: string;
  scheduled_date?: string;
  start_minute?: number;
}

type ImportActivitiesGeneratedRow =
  PublicSchema['Functions']['import_activities']['Returns'][number];

/**
 * One `import_activities` result row (FEAT-3): the activity columns plus the per-item outcome.
 * Typegen marks every column of a `RETURNS TABLE` non-null; these really can be NULL (bank rows,
 * no tag, placed rows, no conflict), so they are overridden here rather than in the generated file.
 */
export type ImportActivitiesRow = Omit<
  ImportActivitiesGeneratedRow,
  | 'scheduled_date'
  | 'start_minute'
  | 'tag'
  | 'bank_reason'
  | 'conflict_activity_id'
  | 'conflict_item'
> & {
  scheduled_date: string | null;
  start_minute: number | null;
  tag: string | null;
  bank_reason: string | null;
  conflict_activity_id: string | null;
  conflict_item: number | null;
};

/** Outcome of one imported item (`activitiesRepo.importMany`, FEAT-3), in input order. */
export interface ImportedActivity {
  /** The created activity, placed or in the bank. */
  activity: Activity;
  /** The requested placement was applied. `false` also when none was requested. */
  placed: boolean;
  /**
   * Why a requested placement was not applied (same codes as `planImportPlacements`). `null` when
   * placed, when no placement was requested, or for a code this client does not know yet.
   */
  bankReason: ImportBankReason | null;
  /** `overlaps_existing` / `overlaps_import_row`: the id of the activity it overlaps. */
  conflictActivityId: string | null;
  /** `overlaps_import_row`: 1-based index of the earlier item (in the items sent) it overlaps. */
  conflictItem: number | null;
}

/** One activity of an `import_trips` trip (snake_case, as the RPC expects). */
export interface ImportTripActivityJson {
  [key: string]: Json;
  name: string;
  duration_minutes: number;
  color: string;
  scheduled_date: string | null;
  start_minute: number | null;
  tag: string | null;
}

/** One trip of the `import_trips` payload (see the header of the M6 import migration). */
export interface ImportTripJson {
  [key: string]: Json;
  name: string;
  start_date: string;
  start_minute: number;
  end_date: string;
  end_minute: number;
  color_cursor: number;
  activities: ImportTripActivityJson[];
}

/** `import_trips` result, summed: how many trips and activities were created. */
export interface ImportTripsCounts {
  trips: number;
  activities: number;
}

/** A `trips` row with its embedded activities (`select('*, activities(*)')`). */
export type TripWithActivitiesRow = TripRow & { activities: ActivityRow[] };

function invalidResponse(cause: unknown): AppError {
  return new AppError('unknown', { reason: 'invalid_response', cause });
}

// --- Reads ----------------------------------------------------------------------------------

export function tripWindowFromRow(row: TripSummaryRow): TripWindow {
  return {
    startDate: row.start_date,
    startMinute: row.start_minute,
    endDate: row.end_date,
    endMinute: row.end_minute,
  };
}

export function tripFromRow(row: TripRow): Trip {
  return {
    id: row.id,
    name: row.name,
    window: tripWindowFromRow(row),
    colorCursor: row.color_cursor,
  };
}

export function tripSummaryFromRow(row: TripSummaryRow): TripSummary {
  const window = tripWindowFromRow(row);
  return { id: row.id, name: row.name, window, dayCount: tripDayCount(window) };
}

/**
 * `scheduled_date`/`start_minute` are both set (placed) or both NULL (bank) — guaranteed by the
 * `activities_placement_complete` check. A half-set pair means the row is not what we expect.
 */
export function placementFromRow(
  row: Pick<ActivityRow, 'scheduled_date' | 'start_minute'>,
): Placement | null {
  if (row.scheduled_date === null && row.start_minute === null) return null;
  if (row.scheduled_date === null || row.start_minute === null) throw invalidResponse(row);
  return { date: row.scheduled_date, startMinute: row.start_minute };
}

export function activityFromRow(row: ActivityRow): Activity {
  return {
    id: row.id,
    tripId: row.trip_id,
    name: row.name,
    durationMinutes: row.duration_minutes,
    // The DB accepts any hex case; the domain's canonical form is upper-case (DEC-009).
    color: normalizeHexColor(row.color),
    placement: placementFromRow(row),
    bankPosition: row.bank_position,
    tag: row.tag ?? null,
    createdAt: row.created_at,
  };
}

export function tripWithActivitiesFromRow(row: TripWithActivitiesRow): TripWithActivities {
  const { activities, ...tripRow } = row;
  return { trip: tripFromRow(tripRow), activities: activities.map(activityFromRow) };
}

// --- Writes ---------------------------------------------------------------------------------

/** `owner_id` defaults to `auth.uid()` in the DB; `color_cursor` starts at 0. */
export function tripInsertFromInput(input: TripInput): TripInsert {
  return {
    name: input.name,
    start_date: input.window.startDate,
    start_minute: input.window.startMinute,
    end_date: input.window.endDate,
    end_minute: input.window.endMinute,
  };
}

export function updateTripWindowArgs(tripId: string, input: TripInput): UpdateTripWindowArgs {
  return {
    trip_id: tripId,
    start_date: input.window.startDate,
    start_minute: input.window.startMinute,
    end_date: input.window.endDate,
    end_minute: input.window.endMinute,
    name: input.name,
  };
}

/** `color` and `bank_position` are left out unless given: the insert trigger assigns them. */
export function activityInsertFromInput(tripId: string, input: ActivityInput): ActivityInsert {
  const insert: ActivityInsert = {
    trip_id: tripId,
    name: input.name,
    duration_minutes: input.durationMinutes,
  };
  if (input.color !== undefined) insert.color = normalizeHexColor(input.color);
  const tag = normalizeTag(input.tag);
  if (tag !== null) insert.tag = tag;
  return insert;
}

/**
 * RPC `update_activity` arguments (FR-3.5, DEC-022, FEAT-1/2). Absent fields are omitted, so the
 * RPC's NULL default keeps the current value; an empty patch sends only `activity_id`.
 * `tag: null` (or blank) clears the tag, which the RPC expects as `''`. `placement` sends
 * `scheduled_date` + `start_minute`; `placement: null` sends `to_bank: true`.
 */
export function updateActivityArgs(id: string, patch: ActivityPatch): UpdateActivityArgs {
  const args: UpdateActivityArgs = { activity_id: id };
  if (patch.name !== undefined) args.name = patch.name;
  if (patch.durationMinutes !== undefined) args.duration_minutes = patch.durationMinutes;
  if (patch.color !== undefined) args.color = normalizeHexColor(patch.color);
  if (patch.tag !== undefined) args.tag = normalizeTag(patch.tag) ?? '';
  if (patch.placement === null) {
    args.to_bank = true;
  } else if (patch.placement !== undefined) {
    args.scheduled_date = patch.placement.date;
    args.start_minute = patch.placement.startMinute;
  }
  return args;
}

/**
 * RPC `import_activities` items. `scheduled_date` + `start_minute` are sent only for an item with
 * a placement (FEAT-3); without one the RPC behaves exactly as before. The placement is not
 * validated here: the RPC banks a malformed one with `placement_invalid` instead of failing.
 */
export function importItemsFromInputs(items: readonly ImportItemInput[]): ImportItemJson[] {
  return items.map((item) => {
    const json: ImportItemJson = { name: item.name, duration_minutes: item.durationMinutes };
    if (item.color !== undefined) json.color = normalizeHexColor(item.color);
    const tag = normalizeTag(item.tag);
    if (tag !== null) json.tag = tag;
    if (item.placement) {
      json.scheduled_date = item.placement.date;
      json.start_minute = item.placement.startMinute;
    }
    return json;
  });
}

const IMPORT_BANK_REASONS: ReadonlySet<string> = new Set<ImportBankReason>([
  'placement_incomplete',
  'placement_invalid',
  'day_out_of_trip',
  'outside_trip_hours',
  'overlaps_existing',
  'overlaps_import_row',
]);

function isImportBankReason(value: string): value is ImportBankReason {
  return IMPORT_BANK_REASONS.has(value);
}

/**
 * Maps one `import_activities` result row. An unknown `bank_reason` (a newer server) becomes
 * `null` rather than an error: the import is already committed, so failing here would invite a
 * duplicate retry. A placed row must carry a placement.
 */
export function importedActivityFromRow(row: ImportActivitiesRow): ImportedActivity {
  const activity = activityFromRow(row);
  if (row.placed && activity.placement === null) throw invalidResponse(row);
  const reason = row.bank_reason;
  return {
    activity,
    placed: row.placed,
    bankReason: reason !== null && isImportBankReason(reason) ? reason : null,
    conflictActivityId: row.conflict_activity_id,
    conflictItem: row.conflict_item,
  };
}

/**
 * RPC `import_trips` payload: the backup trips in order, camelCase → snake_case. A bank activity
 * sends `scheduled_date`/`start_minute` as null; colours are sent upper-case (DEC-009).
 */
export function importTripsFromBackup(trips: readonly BackupTrip[]): ImportTripJson[] {
  return trips.map((trip) => ({
    name: trip.name,
    start_date: trip.window.startDate,
    start_minute: trip.window.startMinute,
    end_date: trip.window.endDate,
    end_minute: trip.window.endMinute,
    color_cursor: trip.colorCursor,
    activities: trip.activities.map((activity) => ({
      name: activity.name,
      duration_minutes: activity.durationMinutes,
      color: normalizeHexColor(activity.color),
      scheduled_date: activity.placement?.date ?? null,
      start_minute: activity.placement?.startMinute ?? null,
      tag: normalizeTag(activity.tag),
    })),
  }));
}

// --- update_trip_window result (jsonb) ------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isTripRowJson(value: unknown): value is TripRow {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.start_date === 'string' &&
    isInteger(value.start_minute) &&
    typeof value.end_date === 'string' &&
    isInteger(value.end_minute) &&
    isInteger(value.color_cursor)
  );
}

function isActivityRowJson(value: unknown): value is ActivityRow {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.trip_id === 'string' &&
    typeof value.name === 'string' &&
    isInteger(value.duration_minutes) &&
    typeof value.color === 'string' &&
    (value.scheduled_date === null || typeof value.scheduled_date === 'string') &&
    (value.start_minute === null || isInteger(value.start_minute)) &&
    typeof value.bank_position === 'number' &&
    Number.isFinite(value.bank_position) &&
    (value.tag === undefined || value.tag === null || typeof value.tag === 'string')
  );
}

/**
 * `update_activity` returns jsonb `{ activity: <activities row>, returned_to_bank: <bool> }`
 * (DEC-022). `returnedToBank` = the new duration no longer fitted, so the RPC moved it (FR-3.6);
 * never true for an explicit placement or `placement: null`.
 */
export function activityUpdateFromJson(json: Json | null): {
  activity: Activity;
  returnedToBank: boolean;
} {
  if (
    !isRecord(json) ||
    !isActivityRowJson(json.activity) ||
    typeof json.returned_to_bank !== 'boolean'
  ) {
    throw invalidResponse(json);
  }
  return { activity: activityFromRow(json.activity), returnedToBank: json.returned_to_bank };
}

/** `update_trip_window` returns jsonb `{ trip: <trips row>, moved_count: <int> }` (DEC-019). */
export function tripWindowUpdateFromJson(json: Json | null): { trip: Trip; movedCount: number } {
  if (!isRecord(json) || !isTripRowJson(json.trip) || !isInteger(json.moved_count)) {
    throw invalidResponse(json);
  }
  return { trip: tripFromRow(json.trip), movedCount: json.moved_count };
}

/**
 * `import_trips` returns jsonb `{ trips: [{ trip: <trips row>, activity_count: <int> }] }`
 * (DEC-033). Only the counts are needed: the caller refetches the trips list.
 */
export function importTripsCountsFromJson(json: Json | null): ImportTripsCounts {
  if (!isRecord(json) || !Array.isArray(json.trips)) throw invalidResponse(json);
  let activities = 0;
  for (const entry of json.trips) {
    if (!isRecord(entry) || !isTripRowJson(entry.trip) || !isInteger(entry.activity_count)) {
      throw invalidResponse(json);
    }
    activities += entry.activity_count;
  }
  return { trips: json.trips.length, activities };
}

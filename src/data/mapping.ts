// Row ⇄ domain mapping (PROJECT_PLAN §7.3, DEC-009). snake_case DB rows become the camelCase
// domain types; nothing outside src/data sees a DB row.
//
// Writes only ever contain columns the `authenticated` role may write (column-level UPDATE
// grants, DEC-019): activities name/duration_minutes/color; placement goes through the RPCs.

import {
  normalizeHexColor,
  tripDayCount,
  type Activity,
  type ActivityInput,
  type ActivityPatch,
  type Placement,
  type Trip,
  type TripInput,
  type TripSummary,
  type TripWindow,
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

/** One item of the `import_activities` RPC payload (snake_case, as the RPC expects). */
export interface ImportItemJson {
  [key: string]: Json;
  name: string;
  duration_minutes: number;
}

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
  };
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
  return insert;
}

/**
 * RPC `update_activity` arguments (FR-3.5, DEC-022). Absent fields are omitted, so the RPC's
 * NULL default keeps the current value; an empty patch sends only `activity_id`.
 */
export function updateActivityArgs(id: string, patch: ActivityPatch): UpdateActivityArgs {
  const args: UpdateActivityArgs = { activity_id: id };
  if (patch.name !== undefined) args.name = patch.name;
  if (patch.durationMinutes !== undefined) args.duration_minutes = patch.durationMinutes;
  if (patch.color !== undefined) args.color = normalizeHexColor(patch.color);
  return args;
}

export function importItemsFromInputs(items: readonly ActivityInput[]): ImportItemJson[] {
  return items.map((item) => {
    const json: ImportItemJson = { name: item.name, duration_minutes: item.durationMinutes };
    if (item.color !== undefined) json.color = normalizeHexColor(item.color);
    return json;
  });
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
    Number.isFinite(value.bank_position)
  );
}

/**
 * `update_activity` returns jsonb `{ activity: <activities row>, returned_to_bank: <bool> }`
 * (DEC-022). `returnedToBank` = the new duration no longer fitted, so the RPC moved it (FR-3.6).
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

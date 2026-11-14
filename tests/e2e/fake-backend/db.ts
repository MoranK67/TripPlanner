// In-memory stand-in for the Supabase project used by the E2E suite (M4.5).
//
// It mirrors the parts of the real schema the app talks to: auth users and sessions, the
// `trips` and `activities` tables (with the insert trigger's colour / bank-position defaults)
// and the RPCs update_trip_window, update_activity, place_activity, unplace_activity and
// import_activities. Business errors use the DB error contract (header of
// supabase/migrations/20261112140400_m1_hardening.sql): message = TP_* code, details = reason.
//
// Pure Node code: no Playwright imports, so it can be unit-tested or reused by other runners.

export const PALETTE = [
  '#FFD6E0',
  '#FFE3C2',
  '#FFF1B5',
  '#D6F2C9',
  '#C8EBE3',
  '#CDE5FF',
  '#DAD4FA',
  '#F3D3F2',
  '#FCD5C8',
  '#E6E1DA',
] as const;

export interface FakeUser {
  id: string;
  email: string;
  password: string;
}

export interface TripRow {
  id: string;
  owner_id: string;
  name: string;
  start_date: string;
  start_minute: number;
  end_date: string;
  end_minute: number;
  color_cursor: number;
  timezone: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivityRow {
  id: string;
  trip_id: string;
  name: string;
  duration_minutes: number;
  color: string;
  scheduled_date: string | null;
  start_minute: number | null;
  bank_position: number;
  created_at: string;
  updated_at: string;
}

/** PostgREST's error JSON. */
export interface PgError {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
}

/** A failed DB operation: HTTP status + PostgREST error body. */
export class DbFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: PgError,
  ) {
    super(body.message);
  }
}

/** TP_* business error (SQLSTATE P0001 → HTTP 400, TP_OVERLAP 23P01 → 400). */
export function tpError(code: string, details: string): DbFailure {
  return new DbFailure(400, {
    code: code === 'TP_OVERLAP' ? '23P01' : 'P0001',
    message: code,
    details,
    hint: null,
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

let idCounter = 0;
/** Deterministic, valid UUIDs (v4 layout) so runs are reproducible. */
export function nextUuid(): string {
  idCounter += 1;
  const hex = idCounter.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

const MINUTES_PER_DAY = 1440;
const MAX_TRIP_DAYS = 90;

function epochDay(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export interface TripWindowArgs {
  start_date: unknown;
  start_minute: unknown;
  end_date: unknown;
  end_minute: unknown;
}

/** Same rules and reasons as update_trip_window / the trips check constraints. */
export function tripWindowError(w: TripWindowArgs): string | null {
  if (!isIsoDate(w.start_date) || !isIsoDate(w.end_date)) return 'invalid_date';
  const sm = w.start_minute;
  const em = w.end_minute;
  if (typeof sm !== 'number' || !Number.isInteger(sm) || sm < 0 || sm > 1410 || sm % 30 !== 0) {
    return 'invalid_start_minute';
  }
  if (typeof em !== 'number' || !Number.isInteger(em) || em < 30 || em > 1440 || em % 30 !== 0) {
    return 'invalid_end_minute';
  }
  const start = epochDay(w.start_date) * MINUTES_PER_DAY + sm;
  const end = epochDay(w.end_date) * MINUTES_PER_DAY + em;
  if (end <= start) return 'end_not_after_start';
  // Day count: the last day only counts if the trip runs into it (an end at 00:00 cannot occur).
  if (epochDay(w.end_date) - epochDay(w.start_date) + 1 > MAX_TRIP_DAYS) return 'too_long';
  return null;
}

/** private.fits_trip_window: inside the window and within one calendar day. */
function fitsTripWindow(trip: TripRow, date: string, startMinute: number, duration: number) {
  if (startMinute + duration > MINUTES_PER_DAY) return false;
  const abs = epochDay(date) * MINUTES_PER_DAY + startMinute;
  const tripStart = epochDay(trip.start_date) * MINUTES_PER_DAY + trip.start_minute;
  const tripEnd = epochDay(trip.end_date) * MINUTES_PER_DAY + trip.end_minute;
  return abs >= tripStart && abs + duration <= tripEnd;
}

function overlaps(a: ActivityRow, date: string, startMinute: number, duration: number) {
  if (a.scheduled_date !== date || a.start_minute === null) return false;
  return (
    a.start_minute < startMinute + duration && startMinute < a.start_minute + a.duration_minutes
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface SeedTrip {
  id?: string;
  name: string;
  start_date: string;
  start_minute?: number;
  end_date: string;
  end_minute?: number;
  color_cursor?: number;
  owner?: string;
}

export interface SeedActivity {
  id?: string;
  name: string;
  duration_minutes?: number;
  color?: string;
  scheduled_date?: string;
  start_minute?: number;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

/**
 * The fake database plus auth state. One instance per test (see fixtures.ts), so tests never
 * share data.
 */
export class FakeDb {
  readonly users: FakeUser[] = [];
  readonly trips: TripRow[] = [];
  readonly activities: ActivityRow[] = [];
  /** Live access tokens → user id. */
  readonly accessTokens = new Map<string, string>();
  readonly refreshTokens = new Map<string, string>();

  addUser(email: string, password: string): FakeUser {
    const user = { id: nextUuid(), email, password };
    this.users.push(user);
    return user;
  }

  // --- seeding --------------------------------------------------------------------------------

  seedTrip(owner: FakeUser, seed: SeedTrip, activities: SeedActivity[] = []): TripRow {
    const row: TripRow = {
      id: seed.id ?? nextUuid(),
      owner_id: owner.id,
      name: seed.name,
      start_date: seed.start_date,
      start_minute: seed.start_minute ?? 600,
      end_date: seed.end_date,
      end_minute: seed.end_minute ?? 1200,
      color_cursor: seed.color_cursor ?? 0,
      timezone: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    this.trips.push(row);
    for (const a of activities) {
      const inserted = this.insertActivity(owner.id, {
        trip_id: row.id,
        name: a.name,
        duration_minutes: a.duration_minutes ?? 60,
        ...(a.color ? { color: a.color } : {}),
      });
      if (a.scheduled_date !== undefined && a.start_minute !== undefined) {
        inserted.scheduled_date = a.scheduled_date;
        inserted.start_minute = a.start_minute;
      }
      if (a.id) inserted.id = a.id;
    }
    return row;
  }

  // --- access ---------------------------------------------------------------------------------

  /** RLS: a user sees only their own trips (and those trips' activities). */
  visibleTrips(userId: string | null): TripRow[] {
    return userId === null ? [] : this.trips.filter((t) => t.owner_id === userId);
  }

  visibleActivities(userId: string | null): ActivityRow[] {
    const tripIds = new Set(this.visibleTrips(userId).map((t) => t.id));
    return this.activities.filter((a) => tripIds.has(a.trip_id));
  }

  private ownTrip(userId: string, tripId: unknown): TripRow {
    const trip = isUuid(tripId)
      ? this.trips.find((t) => t.id === tripId && t.owner_id === userId)
      : undefined;
    if (!trip) throw tpError('TP_NOT_FOUND', 'trip');
    return trip;
  }

  private ownActivity(userId: string, activityId: unknown): ActivityRow {
    if (!isUuid(activityId)) throw tpError('TP_VALIDATION', 'activity_id');
    const activity = this.visibleActivities(userId).find((a) => a.id === activityId);
    if (!activity) throw tpError('TP_NOT_FOUND', 'activity');
    return activity;
  }

  private maxBankPosition(tripId: string): number {
    return this.activities
      .filter((a) => a.trip_id === tripId)
      .reduce((max, a) => Math.max(max, a.bank_position), 0);
  }

  // --- table writes ---------------------------------------------------------------------------

  insertTrip(userId: string, body: Record<string, unknown>): TripRow {
    const name = body.name;
    if (typeof name !== 'string' || name.length < 1 || name.length > 50) {
      throw new DbFailure(400, {
        code: '23514',
        message: 'new row for relation "trips" violates check constraint "trips_name_length"',
        details: null,
        hint: null,
      });
    }
    const windowError = tripWindowError(body as unknown as TripWindowArgs);
    if (windowError) {
      throw new DbFailure(400, {
        code: '23514',
        message: `new row for relation "trips" violates check constraint "trips_${windowError}"`,
        details: null,
        hint: null,
      });
    }
    const row: TripRow = {
      id: nextUuid(),
      owner_id: userId,
      name,
      start_date: body.start_date as string,
      start_minute: body.start_minute as number,
      end_date: body.end_date as string,
      end_minute: body.end_minute as number,
      color_cursor: 0,
      timezone: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    this.trips.push(row);
    return row;
  }

  deleteTrips(userId: string, ids: (id: string) => boolean): void {
    const doomed = new Set(
      this.visibleTrips(userId)
        .filter((t) => ids(t.id))
        .map((t) => t.id),
    );
    remove(this.trips, (t) => doomed.has(t.id));
    // ON DELETE CASCADE
    remove(this.activities, (a) => doomed.has(a.trip_id));
  }

  /** INSERT + BEFORE INSERT trigger activities_10_assign_defaults. */
  insertActivity(userId: string, body: Record<string, unknown>): ActivityRow {
    const trip = this.visibleTrips(userId).find((t) => t.id === body.trip_id);
    if (!trip) {
      throw new DbFailure(403, {
        code: '42501',
        message: 'new row violates row-level security policy for table "activities"',
        details: null,
        hint: null,
      });
    }
    const name = body.name;
    if (typeof name !== 'string' || name.trim().length < 1 || name.length > 60) {
      throw new DbFailure(400, {
        code: '23514',
        message:
          'new row for relation "activities" violates check constraint "activities_name_length"',
        details: null,
        hint: null,
      });
    }
    const duration = body.duration_minutes;
    if (typeof duration !== 'number' || duration < 30 || duration > 1440 || duration % 30 !== 0) {
      throw new DbFailure(400, {
        code: '23514',
        message:
          'new row for relation "activities" violates check constraint "activities_duration_valid"',
        details: null,
        hint: null,
      });
    }
    const color =
      typeof body.color === 'string' ? body.color : PALETTE[trip.color_cursor % PALETTE.length]!;
    // Every insert advances the cursor, whether or not a colour was given.
    trip.color_cursor = (trip.color_cursor + 1) % PALETTE.length;
    const row: ActivityRow = {
      id: nextUuid(),
      trip_id: trip.id,
      name,
      duration_minutes: duration,
      color,
      scheduled_date: null,
      start_minute: null,
      bank_position:
        typeof body.bank_position === 'number'
          ? body.bank_position
          : this.maxBankPosition(trip.id) + 1,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    this.activities.push(row);
    return row;
  }

  deleteActivities(userId: string, ids: (id: string) => boolean): void {
    const visible = new Set(this.visibleActivities(userId).map((a) => a.id));
    remove(this.activities, (a) => visible.has(a.id) && ids(a.id));
  }

  // --- RPCs -----------------------------------------------------------------------------------

  rpc(userId: string, fn: string, args: Record<string, unknown>): unknown {
    switch (fn) {
      case 'update_trip_window':
        return this.updateTripWindow(userId, args);
      case 'update_activity':
        return this.updateActivity(userId, args);
      case 'place_activity':
        return this.placeActivity(userId, args);
      case 'unplace_activity':
        return this.unplaceActivity(userId, args);
      case 'import_activities':
        return this.importActivities(userId, args);
      default:
        throw new DbFailure(404, {
          code: 'PGRST202',
          message: `Could not find the function public.${fn} in the schema cache`,
          details: null,
          hint: null,
        });
    }
  }

  /** Name + window; activities that no longer fit go back to the end of the bank. */
  private updateTripWindow(userId: string, args: Record<string, unknown>) {
    if (!isUuid(args.trip_id)) throw tpError('TP_VALIDATION', 'trip_id');
    const windowError = tripWindowError(args as unknown as TripWindowArgs);
    if (windowError) throw tpError('TP_VALIDATION', windowError);
    if (
      args.name !== undefined &&
      args.name !== null &&
      (typeof args.name !== 'string' || args.name.length < 1 || args.name.length > 50)
    ) {
      throw tpError('TP_VALIDATION', 'name');
    }
    const trip = this.ownTrip(userId, args.trip_id);
    trip.start_date = args.start_date as string;
    trip.start_minute = args.start_minute as number;
    trip.end_date = args.end_date as string;
    trip.end_minute = args.end_minute as number;
    if (typeof args.name === 'string') trip.name = args.name;
    trip.updated_at = nowIso();

    const moved = this.activities
      .filter(
        (a) =>
          a.trip_id === trip.id &&
          a.scheduled_date !== null &&
          a.start_minute !== null &&
          !fitsTripWindow(trip, a.scheduled_date, a.start_minute, a.duration_minutes),
      )
      .sort(
        (a, b) =>
          epochDay(a.scheduled_date!) - epochDay(b.scheduled_date!) ||
          a.start_minute! - b.start_minute!,
      );
    const base = this.maxBankPosition(trip.id);
    moved.forEach((a, i) => {
      a.scheduled_date = null;
      a.start_minute = null;
      a.bank_position = base + i + 1;
      a.updated_at = nowIso();
    });
    return { trip: { ...trip }, moved_count: moved.length };
  }

  /**
   * Edits name / duration / colour. A placed activity whose new duration no longer fits (or now
   * overlaps a neighbour) moves to the bank: `returned_to_bank: true`.
   * `forceReturnedToBank` lets a test force that answer once, e.g. for a bank activity.
   */
  forceReturnedToBank = false;

  private updateActivity(userId: string, args: Record<string, unknown>) {
    if (!isUuid(args.activity_id)) throw tpError('TP_VALIDATION', 'activity_id');
    const { name, duration_minutes: duration, color } = args;
    if (name != null && (typeof name !== 'string' || name.length < 1 || name.length > 60)) {
      throw tpError('TP_VALIDATION', 'name');
    }
    if (
      duration != null &&
      (typeof duration !== 'number' || duration < 30 || duration > 1440 || duration % 30 !== 0)
    ) {
      throw tpError('TP_VALIDATION', 'duration_minutes');
    }
    if (color != null && (typeof color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(color))) {
      throw tpError('TP_VALIDATION', 'color');
    }
    const activity = this.ownActivity(userId, args.activity_id);
    const trip = this.ownTrip(userId, activity.trip_id);
    const newDuration = typeof duration === 'number' ? duration : activity.duration_minutes;

    // Like the DB: the fit is checked only when the duration actually changes. A rename or
    // recolour never moves a placed activity, even if it sits outside the window today.
    let returned = false;
    if (
      activity.scheduled_date !== null &&
      activity.start_minute !== null &&
      newDuration !== activity.duration_minutes
    ) {
      const date = activity.scheduled_date;
      const start = activity.start_minute;
      const fits =
        fitsTripWindow(trip, date, start, newDuration) &&
        !this.activities.some(
          (o) =>
            o.id !== activity.id && o.trip_id === trip.id && overlaps(o, date, start, newDuration),
        );
      if (!fits) returned = true;
    }

    if (typeof name === 'string') activity.name = name;
    activity.duration_minutes = newDuration;
    if (typeof color === 'string') activity.color = color;
    activity.updated_at = nowIso();
    if (this.forceReturnedToBank) {
      this.forceReturnedToBank = false;
      returned = true;
    }
    if (returned) {
      const base = this.maxBankPosition(trip.id);
      activity.scheduled_date = null;
      activity.start_minute = null;
      activity.bank_position = base + 1;
    }
    return { activity: { ...activity }, returned_to_bank: returned };
  }

  private placeActivity(userId: string, args: Record<string, unknown>) {
    const activity = this.ownActivity(userId, args.activity_id);
    if (!isIsoDate(args.scheduled_date)) throw tpError('TP_VALIDATION', 'scheduled_date');
    const start = args.start_minute;
    if (typeof start !== 'number' || start < 0 || start > 1410 || start % 30 !== 0) {
      throw tpError('TP_VALIDATION', 'start_minute');
    }
    const trip = this.ownTrip(userId, activity.trip_id);
    const date = args.scheduled_date;
    if (!fitsTripWindow(trip, date, start, activity.duration_minutes)) {
      throw tpError('TP_OUT_OF_RANGE', 'outside_trip_window');
    }
    const clash = this.activities.some(
      (o) =>
        o.id !== activity.id &&
        o.trip_id === trip.id &&
        overlaps(o, date, start, activity.duration_minutes),
    );
    if (clash) throw tpError('TP_OVERLAP', 'overlap');
    activity.scheduled_date = date;
    activity.start_minute = start;
    activity.updated_at = nowIso();
    return { ...activity };
  }

  private unplaceActivity(userId: string, args: Record<string, unknown>) {
    const activity = this.ownActivity(userId, args.activity_id);
    if (activity.scheduled_date !== null) {
      activity.bank_position = this.maxBankPosition(activity.trip_id) + 1;
      activity.scheduled_date = null;
      activity.start_minute = null;
      activity.updated_at = nowIso();
    }
    return { ...activity };
  }

  private importActivities(userId: string, args: Record<string, unknown>) {
    if (!isUuid(args.trip_id)) throw tpError('TP_VALIDATION', 'trip_id');
    const items = args.items;
    if (!Array.isArray(items)) throw tpError('TP_VALIDATION', 'items');
    if (items.length > 200) throw tpError('TP_LIMIT', 'too_many_items');
    this.ownTrip(userId, args.trip_id);
    items.forEach((item: unknown, i) => {
      const n = i + 1;
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw tpError('TP_VALIDATION', `item:${n}`);
      }
      const { name, duration_minutes: d, color } = item as Record<string, unknown>;
      if (typeof name !== 'string' || name.trim().length < 1 || name.length > 60) {
        throw tpError('TP_VALIDATION', `item:${n}:name`);
      }
      if (typeof d !== 'number' || d < 30 || d > 1440 || d % 30 !== 0) {
        throw tpError('TP_VALIDATION', `item:${n}:duration_minutes`);
      }
      if (color != null && (typeof color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(color))) {
        throw tpError('TP_VALIDATION', `item:${n}:color`);
      }
    });
    // All validated first: one transaction, nothing half-imported.
    return items.map((item) =>
      this.insertActivity(userId, { trip_id: args.trip_id, ...(item as Record<string, unknown>) }),
    );
  }
}

function remove<T>(list: T[], predicate: (item: T) => boolean): void {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (predicate(list[i]!)) list.splice(i, 1);
  }
}

// Backup files (FR-8.1, FR-8.2): parse the prototype's backup and our own full backup into one
// id-less domain shape, and serialise our own format.
//
// --- Prototype backup (written by the "גיבוי" button in prototype/index.html) ------------------
// {
//   "format": "trip-planner-prototype-backup", "version": 1,
//   "exportedAt": "<ISO timestamp>",
//   "trips": [{
//     "id": string, "name": string,
//     "startDate": "YYYY-MM-DD", "startSlot": 0..47, "endDate": "YYYY-MM-DD", "endSlot": 1..48,
//     "colorIdx": number (not wrapped),
//     "items": [{ "id": string, "name": string, "duration": minutes, "color": "#RRGGBB",
//                 "day": "YYYY-MM-DD" | null, "slot": 0..47 | null }]
//   }]
// }
// A slot is half an hour (minute = slot × 30). An item is in the bank when `day` is empty; bank
// order is the order of the bank items in `items`.
//
// --- App backup (serializeBackup) -------------------------------------------------------------
// {
//   "format": "trip-planner-backup", "version": 2, "exportedAt": "<ISO timestamp>",
//   "trips": [{
//     "name": string,
//     "window": { "startDate", "startMinute", "endDate", "endMinute" },
//     "colorCursor": 0..9,
//     "activities": [{ "name": string, "durationMinutes": number, "color": "#RRGGBB",
//                      "placement": { "date": "YYYY-MM-DD", "startMinute": number } | null,
//                      "tag": string | null }]
//   }]
// }
// Version 2 (FEAT-2) added `tag`. Version 1 files (no tags) are still read; their activities get
// `tag: null`. A version-2 activity without the `tag` key also gets `null`.
// No ids: an import always creates new rows. Placed activities come first (timetable order),
// then the bank in bank order; bank order is the order of the unplaced entries.
//
// --- Validation policy ------------------------------------------------------------------------
// File-level problems (not JSON, unknown marker, wrong version, too big) reject the file. Inside
// a valid file, damage is contained and reported as warnings instead of failing everything:
//   - a trip that cannot be stored (not an object, bad name, bad window) is skipped;
//   - an activity that cannot be stored (bad name / duration) is skipped;
//   - an invalid colour is replaced by a palette colour;
//   - an invalid tag (not text, too long, control characters) is dropped (the activity is kept);
//   - a placement that is malformed, outside the trip window or overlaps an earlier activity
//     sends the activity to the bank (the same thing the app does when a window edit or a longer
//     duration no longer fits, FR-2.6 / FR-3.6), so no activity is lost to a placement problem.
// The UI shows the warnings in its preview before anything is written.

import {
  MAX_BACKUP_ACTIVITIES,
  MAX_BACKUP_TEXT_LENGTH,
  MAX_BACKUP_TRIPS,
  PALETTE_SIZE,
  SLOT_MINUTES,
} from './constants';
import {
  isHexColor,
  isInBank,
  isPlaced,
  isValidActivityName,
  isValidDuration,
  isValidTripName,
  normalizeHexColor,
  paletteColorAt,
} from './guards';
import { canPlace, validateTripWindow } from './placement';
import { normalizeTag, validateTag } from './tags';
import { compareDates } from './time';
import type {
  Activity,
  HexColor,
  IsoDate,
  Placement,
  TripWindow,
  TripWithActivities,
} from './types';

export const APP_BACKUP_FORMAT = 'trip-planner-backup';
/** Version written by `createBackupFile`. 2 = with tags (FEAT-2). */
export const APP_BACKUP_VERSION = 2;
/** App backup versions `parseBackup` reads (1 = before tags). */
export const APP_BACKUP_READABLE_VERSIONS: readonly number[] = [1, 2];
export const PROTOTYPE_BACKUP_FORMAT = 'trip-planner-prototype-backup';
export const PROTOTYPE_BACKUP_VERSION = 1;

export type BackupFormat = 'prototype' | 'app';

/** An activity in a backup. `placement === null` means in the bank. */
export interface BackupActivity {
  name: string;
  durationMinutes: number;
  color: HexColor;
  placement: Placement | null;
  /** Normalized tag (FEAT-2) or `null`. */
  tag: string | null;
}

/** A trip in a backup, ready for import. Activities keep file order (bank order = their order). */
export interface BackupTrip {
  name: string;
  window: TripWindow;
  /** 0..PALETTE_SIZE-1. */
  colorCursor: number;
  activities: BackupActivity[];
}

/** Our own backup file (FR-8.2), exactly as serialised. */
export interface AppBackupFile {
  format: typeof APP_BACKUP_FORMAT;
  version: typeof APP_BACKUP_VERSION;
  exportedAt: string;
  trips: BackupTrip[];
}

/** Why a whole backup file is rejected. The UI maps every code to a Hebrew message. */
export type BackupParseError =
  /** Longer than MAX_BACKUP_TEXT_LENGTH. */
  | 'too_large'
  | 'invalid_json'
  /** Valid JSON but no known `format` marker. */
  | 'unknown_format'
  /** Known format, version this build cannot read (e.g. written by a newer app). */
  | 'unsupported_version'
  /** `trips` is not an array. */
  | 'invalid_structure'
  /** The file contains no trips at all. */
  | 'no_trips'
  /** Every trip was skipped (see `warnings`). */
  | 'no_valid_trips'
  /** More than MAX_BACKUP_TRIPS valid trips. */
  | 'too_many_trips'
  /** More than MAX_BACKUP_ACTIVITIES valid activities in total. */
  | 'too_many_activities';

/** A contained problem inside a valid file. The UI maps every code to a Hebrew message. */
export type BackupWarningCode =
  /** Trip skipped: not an object, or its activities are not a list. */
  | 'trip_invalid'
  /** Trip skipped: name missing, blank or longer than 50 characters. */
  | 'trip_name_invalid'
  /** Trip skipped: dates/times invalid, end not after start, or longer than 90 days. */
  | 'trip_window_invalid'
  /** Activity skipped: not an object. */
  | 'activity_invalid'
  /** Activity skipped: name missing, blank or longer than 60 characters. */
  | 'activity_name_invalid'
  /** Activity skipped: duration not 30..1440 minutes in half hours. */
  | 'activity_duration_invalid'
  /** Activity kept with a palette colour instead of its invalid colour. */
  | 'activity_color_replaced'
  /** Activity kept without its tag: the tag was not text, too long or had control characters. */
  | 'activity_tag_dropped'
  /** Activity kept in the bank: its placement was malformed. */
  | 'placement_invalid'
  /** Activity kept in the bank: its placement is outside the trip window. */
  | 'placement_out_of_range'
  /** Activity kept in the bank: it overlaps an activity placed earlier in the file. */
  | 'placement_overlap';

export interface BackupWarning {
  code: BackupWarningCode;
  /** 0-based index of the trip in the file. */
  tripIndex: number;
  /** The trip's name if the file has one as text (also for skipped trips). */
  tripName: string | null;
  /** 0-based index of the activity within its trip; `null` for trip-level warnings. */
  activityIndex: number | null;
  activityName: string | null;
}

export type BackupParseResult =
  | {
      ok: true;
      format: BackupFormat;
      version: number;
      /** `exportedAt` from the file if it is text, else `null` (informational only). */
      exportedAt: string | null;
      trips: BackupTrip[];
      /** Total activities over all trips. */
      activityCount: number;
      warnings: BackupWarning[];
    }
  | {
      ok: false;
      error: BackupParseError;
      /** Only non-empty for `no_valid_trips` (why each trip was skipped). */
      warnings: BackupWarning[];
    };

// --- Parsing -------------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Format-neutral view of one raw trip; fields are still untrusted. */
interface TripCandidate {
  name: unknown;
  startDate: unknown;
  startMinute: unknown;
  endDate: unknown;
  endMinute: unknown;
  colorCursor: unknown;
  activities: unknown;
  /** Maps one raw activity of this format to the neutral view (`null` = not an object). */
  readActivity: (raw: unknown) => ActivityCandidate | null;
}

interface ActivityCandidate {
  name: unknown;
  durationMinutes: unknown;
  color: unknown;
  /** `undefined`/`null` = no tag. */
  tag: unknown;
  /** `null` = in the bank; `'malformed'` = present but unusable. */
  placement: null | 'malformed' | { date: unknown; startMinute: unknown };
}

/** Prototype slots are half hours; anything that is not a number stays as is (and fails later). */
function slotToMinute(slot: unknown): unknown {
  return typeof slot === 'number' ? slot * SLOT_MINUTES : slot;
}

function readPrototypeActivity(raw: unknown): ActivityCandidate | null {
  if (!isRecord(raw)) return null;
  // The prototype treats any empty `day` as "in the bank" (`!item.day`).
  const inBank = raw.day === null || raw.day === undefined || raw.day === '';
  return {
    name: raw.name,
    durationMinutes: raw.duration,
    color: raw.color,
    tag: null,
    placement: inBank ? null : { date: raw.day, startMinute: slotToMinute(raw.slot) },
  };
}

function readPrototypeTrip(raw: JsonRecord): TripCandidate {
  return {
    name: raw.name,
    startDate: raw.startDate,
    startMinute: slotToMinute(raw.startSlot),
    endDate: raw.endDate,
    endMinute: slotToMinute(raw.endSlot),
    colorCursor: raw.colorIdx,
    activities: raw.items,
    readActivity: readPrototypeActivity,
  };
}

function readAppActivity(raw: unknown): ActivityCandidate | null {
  if (!isRecord(raw)) return null;
  const placement = raw.placement;
  return {
    name: raw.name,
    durationMinutes: raw.durationMinutes,
    color: raw.color,
    tag: raw.tag,
    placement:
      placement === null || placement === undefined
        ? null
        : isRecord(placement)
          ? { date: placement.date, startMinute: placement.startMinute }
          : 'malformed',
  };
}

function readAppTrip(raw: JsonRecord): TripCandidate {
  const window = isRecord(raw.window) ? raw.window : {};
  return {
    name: raw.name,
    startDate: window.startDate,
    startMinute: window.startMinute,
    endDate: window.endDate,
    endMinute: window.endMinute,
    colorCursor: raw.colorCursor,
    activities: raw.activities,
    readActivity: readAppActivity,
  };
}

/** Wraps any cursor into 0..PALETTE_SIZE-1 (the prototype never wraps); invalid → 0. */
function normalizeColorCursor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return ((Math.trunc(value) % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
}

function readWindow(candidate: TripCandidate): TripWindow | null {
  const { startDate, startMinute, endDate, endMinute } = candidate;
  if (
    typeof startDate !== 'string' ||
    typeof endDate !== 'string' ||
    typeof startMinute !== 'number' ||
    typeof endMinute !== 'number'
  ) {
    return null;
  }
  const window = { startDate, startMinute, endDate, endMinute };
  return validateTripWindow(window) === null ? window : null;
}

const PLACEMENT_WARNING = {
  validation: 'placement_invalid',
  out_of_range: 'placement_out_of_range',
  conflict_overlap: 'placement_overlap',
} as const satisfies Record<string, BackupWarningCode>;

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Validates one trip; returns `null` (with a warning) if it must be skipped. */
function validateTrip(
  candidate: TripCandidate,
  tripIndex: number,
  warnings: BackupWarning[],
): BackupTrip | null {
  const tripName = textOrNull(candidate.name);
  const warn = (code: BackupWarningCode, activityIndex: number | null = null, name?: unknown) =>
    warnings.push({
      code,
      tripIndex,
      tripName,
      activityIndex,
      activityName: textOrNull(name),
    });

  if (tripName === null || !isValidTripName(tripName)) {
    warn('trip_name_invalid');
    return null;
  }
  const window = readWindow(candidate);
  if (window === null) {
    warn('trip_window_invalid');
    return null;
  }
  const rawActivities = candidate.activities ?? [];
  if (!Array.isArray(rawActivities)) {
    warn('trip_invalid');
    return null;
  }

  const activities: BackupActivity[] = [];
  // Already accepted placements, as Activities so `canPlace` can check overlaps (ids are the
  // file index; only placed entries matter).
  const placed: Activity[] = [];

  rawActivities.forEach((raw: unknown, activityIndex) => {
    const activity = candidate.readActivity(raw);
    if (activity === null) {
      warn('activity_invalid', activityIndex);
      return;
    }
    const { name, durationMinutes } = activity;
    if (typeof name !== 'string' || !isValidActivityName(name)) {
      warn('activity_name_invalid', activityIndex, name);
      return;
    }
    if (typeof durationMinutes !== 'number' || !isValidDuration(durationMinutes)) {
      warn('activity_duration_invalid', activityIndex, name);
      return;
    }

    let color: HexColor;
    if (typeof activity.color === 'string' && isHexColor(activity.color)) {
      color = normalizeHexColor(activity.color);
    } else {
      color = paletteColorAt(activityIndex);
      warn('activity_color_replaced', activityIndex, name);
    }

    let tag: string | null = null;
    if (activity.tag !== null && activity.tag !== undefined) {
      const normalized = typeof activity.tag === 'string' ? normalizeTag(activity.tag) : null;
      if (normalized !== null && validateTag(normalized) === null) {
        tag = normalized;
      } else if (normalized !== null || typeof activity.tag !== 'string') {
        // A blank string is just "no tag"; anything else unusable is reported.
        warn('activity_tag_dropped', activityIndex, name);
      }
    }

    let placement: Placement | null = null;
    const target = activity.placement;
    if (target === 'malformed') {
      warn('placement_invalid', activityIndex, name);
    } else if (target !== null) {
      if (typeof target.date !== 'string' || typeof target.startMinute !== 'number') {
        warn('placement_invalid', activityIndex, name);
      } else {
        const subject = { id: String(activityIndex), tripId: '', durationMinutes };
        const at = { date: target.date, startMinute: target.startMinute };
        const check = canPlace({ window, activities: placed }, subject, at);
        if (check.ok) {
          placement = at;
          placed.push({ ...subject, name, color, placement: at, bankPosition: 0, tag });
        } else {
          warn(PLACEMENT_WARNING[check.reason], activityIndex, name);
        }
      }
    }

    activities.push({ name, durationMinutes, color, placement, tag });
  });

  return {
    name: tripName,
    window,
    colorCursor: normalizeColorCursor(candidate.colorCursor),
    activities,
  };
}

function failure(error: BackupParseError, warnings: BackupWarning[] = []): BackupParseResult {
  return { ok: false, error, warnings };
}

/**
 * Parses a backup file's text (FR-8.1 prototype backup, FR-8.2 app backup). Pure: the caller
 * reads the file. See the module header for the formats and the validation policy.
 */
export function parseBackup(text: string): BackupParseResult {
  if (text.length > MAX_BACKUP_TEXT_LENGTH) return failure('too_large');

  let data: unknown;
  try {
    // Some editors save JSON with a byte-order mark, which JSON.parse rejects.
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return failure('invalid_json');
  }
  if (!isRecord(data)) return failure('unknown_format');

  let format: BackupFormat;
  let supportedVersions: readonly number[];
  let readTrip: (raw: JsonRecord) => TripCandidate;
  if (data.format === APP_BACKUP_FORMAT) {
    format = 'app';
    supportedVersions = APP_BACKUP_READABLE_VERSIONS;
    readTrip = readAppTrip;
  } else if (data.format === PROTOTYPE_BACKUP_FORMAT) {
    format = 'prototype';
    supportedVersions = [PROTOTYPE_BACKUP_VERSION];
    readTrip = readPrototypeTrip;
  } else {
    return failure('unknown_format');
  }
  const version = data.version;
  if (typeof version !== 'number' || !supportedVersions.includes(version)) {
    return failure('unsupported_version');
  }

  const rawTrips = data.trips;
  if (!Array.isArray(rawTrips)) return failure('invalid_structure');
  if (rawTrips.length === 0) return failure('no_trips');

  const warnings: BackupWarning[] = [];
  const trips: BackupTrip[] = [];
  rawTrips.forEach((raw: unknown, tripIndex) => {
    if (!isRecord(raw)) {
      warnings.push({
        code: 'trip_invalid',
        tripIndex,
        tripName: null,
        activityIndex: null,
        activityName: null,
      });
      return;
    }
    const trip = validateTrip(readTrip(raw), tripIndex, warnings);
    if (trip) trips.push(trip);
  });

  if (trips.length === 0) return failure('no_valid_trips', warnings);
  if (trips.length > MAX_BACKUP_TRIPS) return failure('too_many_trips');
  const activityCount = trips.reduce((sum, trip) => sum + trip.activities.length, 0);
  if (activityCount > MAX_BACKUP_ACTIVITIES) return failure('too_many_activities');

  return {
    ok: true,
    format,
    version,
    exportedAt: textOrNull(data.exportedAt),
    trips,
    activityCount,
    warnings,
  };
}

// --- Serialising -----------------------------------------------------------------------------

/**
 * A stored trip in backup shape: placed activities first in timetable order, then the bank in
 * bank order (so the bank order survives an import that appends in file order).
 */
export function toBackupTrip({ trip, activities }: TripWithActivities): BackupTrip {
  const placed = activities
    .filter(isPlaced)
    .sort(
      (a, b) =>
        compareDates(a.placement.date, b.placement.date) ||
        a.placement.startMinute - b.placement.startMinute,
    );
  const bank = activities.filter(isInBank).sort((a, b) => a.bankPosition - b.bankPosition);
  return {
    name: trip.name,
    window: { ...trip.window },
    colorCursor: normalizeColorCursor(trip.colorCursor),
    activities: [...placed, ...bank].map((a) => ({
      name: a.name,
      durationMinutes: a.durationMinutes,
      color: a.color,
      placement: a.placement
        ? { date: a.placement.date, startMinute: a.placement.startMinute }
        : null,
      tag: normalizeTag(a.tag),
    })),
  };
}

/** Our backup file object (FR-8.2). `exportedAt` is passed in to keep the domain deterministic. */
export function createBackupFile(
  trips: readonly TripWithActivities[],
  exportedAt: Date,
): AppBackupFile {
  return {
    format: APP_BACKUP_FORMAT,
    version: APP_BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    trips: trips.map(toBackupTrip),
  };
}

/** Backup file text (pretty-printed JSON, readable by `parseBackup`). */
export function serializeBackup(trips: readonly TripWithActivities[], exportedAt: Date): string {
  return `${JSON.stringify(createBackupFile(trips, exportedAt), null, 2)}\n`;
}

/** `trip-planner-backup-YYYY-MM-DD.json` — the same name the prototype uses. */
export function backupFileName(date: IsoDate): string {
  return `trip-planner-backup-${date}.json`;
}

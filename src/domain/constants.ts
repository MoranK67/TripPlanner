// Domain constants. Every limit here mirrors a DB check constraint (PROJECT_PLAN §6.2)
// or a functional requirement (§2); keep both sides in sync when changing one.

// --- Time grid (PROJECT_PLAN §4.5) -------------------------------------------------------

/** Length of one timetable slot. The data model stores minutes, so this can change later. */
export const SLOT_MINUTES = 30;
export const MINUTES_PER_DAY = 24 * 60;
export const SLOTS_PER_DAY = MINUTES_PER_DAY / SLOT_MINUTES;

/** Latest start of anything on a day (23:30). DB: `start_minute` 0–1410. */
export const MAX_START_MINUTE = MINUTES_PER_DAY - SLOT_MINUTES;
/** Earliest trip end on its last day (00:30). DB: `trips.end_minute` 30–1440. */
export const MIN_END_MINUTE = SLOT_MINUTES;
/** "24:00" — end of the day (FR-2.4). */
export const MAX_END_MINUTE = MINUTES_PER_DAY;

// --- Trips (FR-2.2, FR-2.5) --------------------------------------------------------------

/** Maximum trip length in calendar days (inclusive of both ends). */
export const MAX_TRIP_DAYS = 90;
/** DB: `end_date - start_date <= 89`. */
export const MAX_TRIP_DAY_SPAN = MAX_TRIP_DAYS - 1;
export const TRIP_NAME_MIN = 1;
export const TRIP_NAME_MAX = 50;

// --- Activities (FR-3.1) -----------------------------------------------------------------

export const ACTIVITY_NAME_MIN = 1;
export const ACTIVITY_NAME_MAX = 60;
/** DB: `duration_minutes` 30–1440, multiple of 30. */
export const MIN_ACTIVITY_MINUTES = SLOT_MINUTES;
export const MAX_ACTIVITY_MINUTES = MINUTES_PER_DAY;

/**
 * Activity tag length (FEAT-2), in code points like Postgres `char_length`. DB: `activities.tag`
 * is null or trimmed, 1–30 characters, no control characters.
 */
export const TAG_MIN = 1;
export const TAG_MAX = 30;

// --- Import (FR-6.5) ---------------------------------------------------------------------

export const MAX_IMPORT_ROWS = 200;

// --- Backup files (FR-8.1, FR-8.2) -------------------------------------------------------

/**
 * Most trips one backup file may import. Counts valid trips; meant to be mirrored by the
 * backup-import RPC so one all-or-nothing import stays well inside the request timeout.
 */
export const MAX_BACKUP_TRIPS = 50;
/** Most activities (all trips together) one backup file may import. Mirrored by the RPC. */
export const MAX_BACKUP_ACTIVITIES = 2000;
/** Larger backup text is refused before `JSON.parse` (characters, ~5 MB). */
export const MAX_BACKUP_TEXT_LENGTH = 5_000_000;

// --- Colors (FR-3.2, FR-9.3) -------------------------------------------------------------

/**
 * Pastel activity palette, in assignment order. Same values and order as the prototype's
 * `COLORS` and as `--color-pastel-*` in styles/tokens.css. Upper-case hex is the canonical form.
 */
export const PALETTE = [
  '#FFD6E0', // pink
  '#FFE3C2', // peach
  '#FFF1B5', // butter
  '#D6F2C9', // mint
  '#C8EBE3', // sage
  '#CDE5FF', // sky
  '#DAD4FA', // lavender
  '#F3D3F2', // lilac
  '#FCD5C8', // coral
  '#E6E1DA', // stone
] as const;

export const PALETTE_SIZE = PALETTE.length;

/** Color format accepted by the DB (`activities.color`). The palette itself is client-enforced. */
export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** Calendar date format used everywhere in the domain (`YYYY-MM-DD`, no time zone). */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

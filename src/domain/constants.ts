/** Length of one timetable slot. The data model stores minutes, so this can change later. */
export const SLOT_MINUTES = 30;
export const MINUTES_PER_DAY = 24 * 60;
export const SLOTS_PER_DAY = MINUTES_PER_DAY / SLOT_MINUTES;

export const MAX_TRIP_DAYS = 90;
export const MAX_IMPORT_ROWS = 200;
export const TRIP_NAME_MAX = 50;
export const ACTIVITY_NAME_MAX = 60;
export const MIN_ACTIVITY_MINUTES = SLOT_MINUTES;
export const MAX_ACTIVITY_MINUTES = MINUTES_PER_DAY;

/** Pastel activity palette (same values as --color-pastel-* in styles/tokens.css). */
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

// Tap-to-place (FR-5.5) and keyboard placement (FR-5.6): the mode's state machine and the slot
// validity it highlights. Pure functions, so they are unit-tested without a DOM. The placement
// rules themselves are `canPlace` from the domain; nothing here re-implements them.

import {
  canPlace,
  isPlaced,
  SLOT_MINUTES,
  SLOTS_PER_DAY,
  type Activity,
  type IsoDate,
  type PlacementCheck,
  type PlacementSubject,
  type TripWindow,
} from '@/domain';

/** A start slot on a trip day: `dayIndex` 0 = first trip day, `slot` 0 = 00:00, 47 = 23:30. */
export interface SlotCursor {
  dayIndex: number;
  slot: number;
}

/** How the mode was entered; decides whether focus may scroll the view. */
export type PlacingVia = 'pointer' | 'keyboard';

/** `null` = idle. Otherwise one activity is "picked up" and waits for a slot. */
export type PlacingState = {
  id: string;
  cursor: SlotCursor;
  via: PlacingVia;
} | null;

export type PlacingAction =
  /** Pick up an activity. Picking up the one already picked up puts it down again (cancel). */
  | { type: 'select'; id: string; cursor: SlotCursor; via: PlacingVia }
  /** The keyboard cursor moved (arrow keys) or the phone switched days. */
  | { type: 'move'; cursor: SlotCursor }
  /** Leave the mode: placed, returned to the bank, cancelled, or no longer possible. */
  | { type: 'end' };

export function placingReducer(state: PlacingState, action: PlacingAction): PlacingState {
  switch (action.type) {
    case 'select':
      if (state?.id === action.id) return null;
      return { id: action.id, cursor: clampCursor(action.cursor), via: action.via };
    case 'move':
      if (!state) return state;
      return { ...state, cursor: clampCursor(action.cursor) };
    case 'end':
      return null;
  }
}

function clampCursor(cursor: SlotCursor): SlotCursor {
  return {
    dayIndex: Math.max(0, cursor.dayIndex),
    slot: Math.max(0, Math.min(SLOTS_PER_DAY - 1, cursor.slot)),
  };
}

/** Placed activities per date (other days never conflict, so each day is checked on its own). */
export function placedByDate(activities: readonly Activity[]): Map<IsoDate, Activity[]> {
  const map = new Map<IsoDate, Activity[]>();
  for (const a of activities) {
    if (!isPlaced(a)) continue;
    const list = map.get(a.placement.date);
    if (list) list.push(a);
    else map.set(a.placement.date, [a]);
  }
  return map;
}

/**
 * `canPlace` for every start slot of one day (48 checks). Only that day's activities are passed:
 * overlaps are per date, so the result equals a check against the whole trip, at a fraction of
 * the cost on a 90-day trip (NFR-3).
 */
export function dayChecks(
  window: TripWindow,
  dayActivities: readonly Activity[],
  subject: PlacementSubject,
  date: IsoDate,
): PlacementCheck[] {
  const context = { window, activities: dayActivities };
  return Array.from({ length: SLOTS_PER_DAY }, (_, slot) =>
    canPlace(context, subject, { date, startMinute: slot * SLOT_MINUTES }),
  );
}

/** A run of consecutive valid start slots `[start, end)` — drawn as one highlight. */
export interface SlotRun {
  start: number;
  end: number;
}

export function validRuns(checks: readonly PlacementCheck[]): SlotRun[] {
  const runs: SlotRun[] = [];
  let start = -1;
  checks.forEach((check, slot) => {
    if (check.ok && start < 0) start = slot;
    if (!check.ok && start >= 0) {
      runs.push({ start, end: slot });
      start = -1;
    }
  });
  if (start >= 0) runs.push({ start, end: checks.length });
  return runs;
}

/**
 * Where the keyboard cursor starts on a day: the first valid slot at or after `from` (the first
 * row in view), else the first valid slot of the day, else `from` itself.
 */
export function firstValidSlot(checks: readonly PlacementCheck[], from: number): number {
  const start = Math.max(0, Math.min(SLOTS_PER_DAY - 1, from));
  for (let s = start; s < checks.length; s += 1) if (checks[s]?.ok) return s;
  const any = checks.findIndex((c) => c.ok);
  return any >= 0 ? any : start;
}

/** Cursor keys of the slot grid. */
export type CursorKey =
  'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End' | 'PageUp' | 'PageDown';

const PAGE_SLOTS = 4; // two hours

export function isCursorKey(key: string): key is CursorKey {
  return [
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Home',
    'End',
    'PageUp',
    'PageDown',
  ].includes(key);
}

/**
 * The cursor after a key press. Up/down = half an hour, PageUp/PageDown = two hours, Home/End =
 * first/last slot of the day; left/right change the day in reading direction — in RTL the later
 * days lie to the left (FR-4.1). Stays inside the day and the trip.
 */
export function moveCursor(
  cursor: SlotCursor,
  key: CursorKey,
  direction: 'rtl' | 'ltr',
  dayCount: number,
): SlotCursor {
  const lastSlot = SLOTS_PER_DAY - 1;
  const slot = (s: number) => ({ ...cursor, slot: Math.max(0, Math.min(lastSlot, s)) });
  const day = (delta: number) => ({
    ...cursor,
    dayIndex: Math.max(0, Math.min(dayCount - 1, cursor.dayIndex + delta)),
  });
  switch (key) {
    case 'ArrowUp':
      return slot(cursor.slot - 1);
    case 'ArrowDown':
      return slot(cursor.slot + 1);
    case 'PageUp':
      return slot(cursor.slot - PAGE_SLOTS);
    case 'PageDown':
      return slot(cursor.slot + PAGE_SLOTS);
    case 'Home':
      return slot(0);
    case 'End':
      return slot(lastSlot);
    case 'ArrowLeft':
      return day(direction === 'rtl' ? 1 : -1);
    case 'ArrowRight':
      return day(direction === 'rtl' ? -1 : 1);
  }
}

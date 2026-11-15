// Parser for typed clock times / durations in the HHMM style (UX-5). Pure, so it is table-tested.

import { SLOT_MINUTES } from '@/domain';

/** Why a typed time was rejected. */
export type HhmmError = 'empty' | 'format' | 'minutes' | 'below_min' | 'above_max';

export type HhmmResult =
  | { minutes: number; rounded: boolean; error?: undefined }
  | { error: HhmmError; minutes?: undefined; rounded?: undefined };

export interface HhmmOptions {
  /** Smallest allowed value in minutes, checked after rounding. */
  min: number;
  /** Largest allowed value in minutes, checked after rounding (1440 = 24:00 is allowed). */
  max: number;
  /** Rounding step in minutes; defaults to the timetable slot (30). */
  step?: number;
}

const WITH_COLON = /^(\d{1,2}):(\d{2})$/;
const HOURS_ONLY = /^\d{1,2}$/;
const COMPACT = /^\d{3,4}$/;

/**
 * Parses a typed time and rounds it to the nearest `step` (ties round up).
 * Accepted: `HHMM` (`0130`), `HMM` (`930`), `H:MM` / `HH:MM` (`9:30`, `09:30`) and
 * `H` / `HH` (whole hours: `8`, `22`). Surrounding spaces are ignored. Minutes must be 00–59.
 * The range is checked on the rounded value, so `0010` with `min: 30` is an error, not 30.
 */
export function parseHhmm(
  text: string,
  { min, max, step = SLOT_MINUTES }: HhmmOptions,
): HhmmResult {
  const s = text.trim();
  if (s === '') return { error: 'empty' };

  let hours: number;
  let mins: number;
  const colon = WITH_COLON.exec(s);
  if (colon) {
    hours = Number(colon[1]);
    mins = Number(colon[2]);
  } else if (HOURS_ONLY.test(s)) {
    hours = Number(s);
    mins = 0;
  } else if (COMPACT.test(s)) {
    hours = Number(s.slice(0, -2));
    mins = Number(s.slice(-2));
  } else {
    return { error: 'format' };
  }
  if (mins >= 60) return { error: 'minutes' };

  const exact = hours * 60 + mins;
  const minutes = Math.floor((exact + step / 2) / step) * step;
  if (minutes < min) return { error: 'below_min' };
  if (minutes > max) return { error: 'above_max' };
  return { minutes, rounded: minutes !== exact };
}

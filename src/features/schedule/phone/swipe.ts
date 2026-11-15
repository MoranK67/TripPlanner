// Day-switch swipe on the phone's single-day timetable (M7.1). Pure, so the thresholds are
// unit-tested without touch emulation.
//
// A swipe must not be confused with the other touch gestures on the timetable:
//   - long press (≥ 280 ms, ≤ 8 px) starts a drag — the caller ignores gestures in which a drag
//     started;
//   - a vertical swipe scrolls the hours — rejected here by the angle test (and the browser fires
//     `pointercancel` once it starts panning, which ends the gesture anyway);
//   - a slow horizontal move is not a swipe — rejected by the time limit.

import type { Direction } from '../drag/geometry';

/** Minimum horizontal travel (px). */
export const SWIPE_MIN_PX = 48;
/** Maximum gesture time (ms): a deliberate flick, not a slow pan. */
export const SWIPE_MAX_MS = 700;
/** The horizontal travel must be at least this many times the vertical travel. */
export const SWIPE_RATIO = 1.5;

/**
 * Day change for a finished touch gesture: +1 = next day, −1 = previous day, 0 = not a swipe.
 * Days run from the inline start, so in RTL the next day lies to the left and is revealed by
 * swiping right (like turning a page in a Hebrew book); in LTR the other way round.
 */
export function swipeDayDelta(
  dx: number,
  dy: number,
  elapsedMs: number,
  direction: Direction,
): -1 | 0 | 1 {
  if (elapsedMs > SWIPE_MAX_MS) return 0;
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < SWIPE_RATIO * Math.abs(dy)) return 0;
  const towardsEnd = direction === 'rtl' ? dx > 0 : dx < 0;
  return towardsEnd ? 1 : -1;
}

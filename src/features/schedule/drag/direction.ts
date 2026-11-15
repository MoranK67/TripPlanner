import type { Direction } from './geometry';

/**
 * Reading direction of the timetable, as the browser computes it. Hebrew is the app's language,
 * so anything that is not explicitly `ltr` (e.g. no computed style in jsdom) counts as `rtl`.
 */
export function readDirection(el: Element | null): Direction {
  if (!el) return 'rtl';
  const computed = getComputedStyle(el).direction || document.documentElement.dir;
  return computed === 'ltr' ? 'ltr' : 'rtl';
}

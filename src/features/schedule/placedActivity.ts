/**
 * Focus targets of placed activities in the timetable (UX-2).
 *
 * Every placed block in the grid (all-days and phone single-day view) carries
 * `data-activity-id="<activity id>"` on its root element; its focus target is the block's open
 * button. Bank blocks do not carry the attribute.
 */

/** Attribute on the root element of each placed block in the timetable grid. */
export const PLACED_ACTIVITY_ATTR = 'data-activity-id';

/**
 * The open button of the placed block of activity `id` inside `root`, or `null` if that activity is
 * not drawn there (e.g. on another day in the phone view, or not placed).
 */
export function findPlacedActivityButton(
  id: string,
  root: ParentNode = document,
): HTMLButtonElement | null {
  for (const el of root.querySelectorAll<HTMLElement>(`[${PLACED_ACTIVITY_ATTR}]`)) {
    if (el.dataset.activityId !== id) continue;
    // The open button; the × is marked `data-no-drag`.
    return el.querySelector<HTMLButtonElement>('button:not([data-no-drag])');
  }
  return null;
}

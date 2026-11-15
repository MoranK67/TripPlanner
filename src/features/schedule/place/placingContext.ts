// Tap-to-place mode (FR-5.5) as seen by the parts around the drag root: the bar under the
// timetable and the phone's bank sheet. A context of its own (not DragRootContext), so entering
// or leaving the mode re-renders only these consumers — never the bank list or the grid.

import { createContext, useContext } from 'react';
import type { Activity } from '@/domain';

export interface PlacingContextValue {
  /** The activity waiting for a slot, or `null` when the mode is off. */
  activity: Activity | null;
  /** Leave the mode without changes; focus returns to where it was. */
  cancel: () => void;
  /** Return the picked-up placed activity to the bank (FR-3.7). */
  unplace: () => void;
  /**
   * Leave the mode and open the activity's edit dialog (a tap no longer opens it while the mode
   * picks blocks up). `openPlaced` is the timetable's opener, used for a placed activity.
   */
  edit: (openPlaced?: (activity: Activity) => void) => void;
}

export const PlacingContext = createContext<PlacingContextValue | null>(null);

/** `null` outside a TimetableDragRoot. */
export function usePlacing(): PlacingContextValue | null {
  return useContext(PlacingContext);
}

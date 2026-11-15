import { createContext, useContext } from 'react';

/**
 * How the planner shows the timetable: `grid` = all days side by side (tablet/desktop), `day` = one
 * day at a time with a day switcher (phones, M7.1). Set by `PlannerLayout` from the breakpoint.
 */
export type PlannerMode = 'grid' | 'day';

export const PlannerModeContext = createContext<PlannerMode>('grid');

export function usePlannerMode(): PlannerMode {
  return useContext(PlannerModeContext);
}

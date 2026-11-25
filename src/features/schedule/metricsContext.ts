import { createContext, useContext } from 'react';
import { GRID_METRICS, type TimetableMetrics } from './timetableLayout';

/**
 * The timetable's vertical scale for everything below it. `PlannerLayout` provides the phone's
 * denser metrics (PHONE-2); anywhere else the tablet / desktop scale applies.
 */
export const TimetableMetricsContext = createContext<TimetableMetrics>(GRID_METRICS);

export function useTimetableMetrics(): TimetableMetrics {
  return useContext(TimetableMetricsContext);
}

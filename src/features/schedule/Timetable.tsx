import type { Activity, Trip } from '@/domain';
import { TimetableGrid } from './TimetableGrid';

export interface TimetableProps {
  trip: Trip;
  /** All activities of the trip (bank + placed); only placed ones are drawn. */
  activities: Activity[];
  /** Clicking (or Enter/Space on) a placed block — open the edit dialog (FR-3.5). */
  onOpenActivity: (activity: Activity) => void;
  /** Optional × on placed blocks; the caller confirms before deleting (FR-3.4). */
  onDeleteActivity?: (activity: Activity) => void;
  className?: string;
}

/**
 * The trip timetable (FR-4.1–4.5): day columns right-to-left, 48 half-hour rows, disabled slots
 * outside the trip window, sticky day headers and time column, opens at the trip start.
 * Fills its flex-column parent and scrolls on its own. Placement by drag/tap/keyboard: M5.3+.
 */
export function Timetable({
  trip,
  activities,
  onOpenActivity,
  onDeleteActivity,
  className,
}: TimetableProps) {
  return (
    <TimetableGrid
      tripWindow={trip.window}
      activities={activities}
      scrollKey={trip.id}
      onOpenActivity={onOpenActivity}
      onDeleteActivity={onDeleteActivity}
      className={className}
    />
  );
}

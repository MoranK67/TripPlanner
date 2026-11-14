import type { Activity, Trip } from '@/domain';
import { DRAG_SOURCE_CLASS, useDragRoot } from './drag/dragContext';
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
 * Fills its flex-column parent and scrolls on its own. Inside a `TimetableDragRoot` its placed
 * blocks can be dragged (FR-5.1–5.4); tap and keyboard placement follow in M5.6/M7.2.
 */
export function Timetable({
  trip,
  activities,
  onOpenActivity,
  onDeleteActivity,
  className,
}: TimetableProps) {
  const drag = useDragRoot();
  return (
    <TimetableGrid
      tripWindow={trip.window}
      activities={activities}
      scrollKey={trip.id}
      onOpenActivity={onOpenActivity}
      onDeleteActivity={onDeleteActivity}
      scrollerRef={drag?.scrollerRef}
      columnsRef={drag?.columnsRef}
      blockClassName={drag ? DRAG_SOURCE_CLASS : undefined}
      className={className}
    />
  );
}

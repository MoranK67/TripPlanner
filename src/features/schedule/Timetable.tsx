import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { tripDays, type Activity, type IsoDate, type Trip } from '@/domain';
import { DRAG_SOURCE_CLASS, useDragRoot } from './drag/dragContext';
import { DaySwitcher } from './phone/DaySwitcher';
import { usePlannerMode } from './phone/plannerMode';
import { PlacingBar } from './place/PlacingBar';
import { swipeDayDelta } from './phone/swipe';
import { TimetableGrid, type GestureHandlers } from './TimetableGrid';

export interface TimetableProps {
  trip: Trip;
  /** All activities of the trip (bank + placed); only placed ones are drawn. */
  activities: Activity[];
  /** Clicking (or Enter/Space on) a placed block — open the edit dialog (FR-3.5). */
  onOpenActivity: (activity: Activity) => void;
  /** Optional × on placed blocks; the caller confirms before deleting (FR-3.4). */
  onDeleteActivity?: (activity: Activity) => void;
  /**
   * One day at a time with a day switcher and swipe (phones, M7.1) instead of all days side by
   * side. Defaults to the surrounding `PlannerLayout`'s choice (by screen width).
   */
  singleDay?: boolean;
  className?: string;
}

/**
 * The trip timetable (FR-4.1–4.5): day columns right-to-left, 48 half-hour rows, disabled slots
 * outside the trip window, sticky day headers and time column, opens at the trip start.
 * Fills its flex-column parent and scrolls on its own. Inside a `TimetableDragRoot` its placed
 * blocks can be dragged (FR-5.1–5.4), and placed without a drag (tap-to-place / keyboard, M7.2):
 * a bar under the grid shows the activity waiting for a slot.
 *
 * On phones (`singleDay`) it shows one day: the sticky header becomes a day switcher, a quick
 * horizontal swipe changes the day, and the vertical scroll position is kept across days.
 */
export function Timetable({
  trip,
  activities,
  onOpenActivity,
  onDeleteActivity,
  singleDay,
  className,
}: TimetableProps) {
  const { t } = useTranslation();
  const hintId = useId();
  const drag = useDragRoot();
  const mode = usePlannerMode();
  const oneDay = singleDay ?? mode === 'day';
  const common = {
    tripWindow: trip.window,
    activities,
    scrollKey: trip.id,
    onOpenActivity,
    onDeleteActivity,
    scrollerRef: drag?.scrollerRef,
    columnsRef: drag?.columnsRef,
    blockClassName: drag ? DRAG_SOURCE_CLASS : undefined,
    describedBy: drag ? hintId : undefined,
    className,
  };
  const grid = oneDay ? (
    <SingleDayTimetable key={trip.id} {...common} />
  ) : (
    <TimetableGrid {...common} />
  );
  if (!drag) return grid;
  return (
    <>
      {grid}
      {/* How to place without dragging (NFR-7), read when entering the timetable. */}
      <p id={hintId} className="sr-only">
        {t('schedule.place.keyboardHint')}
      </p>
      <PlacingBar onOpenActivity={onOpenActivity} />
    </>
  );
}

type GridProps = Parameters<typeof TimetableGrid>[0];

/**
 * Phone view (M7.1): the same grid with `dayCount = 1` (ADR-002). Keyed by trip, so another trip
 * opens at its first day. The drag root is told which day is visible, so drops land on it.
 */
function SingleDayTimetable(props: GridProps) {
  const drag = useDragRoot();
  const days = useMemo(() => tripDays(props.tripWindow), [props.tripWindow]);
  const lastIndex = days.length - 1;
  const [requested, setRequested] = useState(0);
  // A shorter trip window (edited dates) may remove the day that was shown.
  const index = Math.min(requested, lastIndex);

  const lastRef = useRef(lastIndex);
  useLayoutEffect(() => {
    lastRef.current = lastIndex;
  });
  const shift = useCallback((delta: -1 | 1) => {
    setRequested((i) =>
      Math.max(0, Math.min(Math.min(i, lastRef.current) + delta, lastRef.current)),
    );
  }, []);

  // Hit-testing and the drop preview use the visible day (dayCount = 1, offset = index).
  const setView = drag?.setView;
  useLayoutEffect(() => {
    if (!setView) return;
    setView({ start: index, count: 1, shift });
    return () => setView(null);
  }, [setView, index, shift]);

  const gestureHandlers = useDaySwipe(shift, drag?.isDragging);

  const renderDayHeader = useCallback(
    (_date: IsoDate, dayIndex: number, headingId: string) => (
      <DaySwitcher days={days} index={dayIndex} onChange={setRequested} headingId={headingId} />
    ),
    [days],
  );

  return (
    <TimetableGrid
      {...props}
      firstDay={index}
      dayCount={1}
      renderDayHeader={renderDayHeader}
      gestureHandlers={gestureHandlers}
    />
  );
}

/**
 * Day swipe on the timetable (touch only). The gesture ends on pointerup; a vertical swipe makes
 * the browser scroll and fire pointercancel, which drops the gesture. A long press that turned into
 * a drag is not a swipe: React's handler runs before the drag engine's window listener, so the
 * drag is still active when the finger lifts.
 */
function useDaySwipe(
  shift: (delta: -1 | 1) => void,
  isDragging: (() => boolean) | undefined,
): GestureHandlers {
  const draggingRef = useRef(isDragging);
  useLayoutEffect(() => {
    draggingRef.current = isDragging;
  });
  const gesture = useRef<{ id: number; x: number; y: number; time: number } | null>(null);
  return useMemo<GestureHandlers>(
    () => ({
      onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
        gesture.current =
          e.pointerType === 'touch' && e.isPrimary
            ? { id: e.pointerId, x: e.clientX, y: e.clientY, time: performance.now() }
            : null;
      },
      onPointerUp: (e: PointerEvent<HTMLDivElement>) => {
        const g = gesture.current;
        gesture.current = null;
        if (!g || g.id !== e.pointerId || draggingRef.current?.()) return;
        const direction = getComputedStyle(e.currentTarget).direction === 'ltr' ? 'ltr' : 'rtl';
        const delta = swipeDayDelta(
          e.clientX - g.x,
          e.clientY - g.y,
          performance.now() - g.time,
          direction,
        );
        if (delta !== 0) shift(delta);
      },
      onPointerCancel: () => {
        gesture.current = null;
      },
      // A gesture that leaves the timetable is not a swipe (touch only leaves after pointerup).
      onPointerLeave: () => {
        gesture.current = null;
      },
    }),
    [shift],
  );
}

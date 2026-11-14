import {
  memo,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type Ref,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityBlock, cx, SLOT_HEIGHT_PX } from '@/components/ui';
import {
  dayBounds,
  formatShortDate,
  formatWeekday,
  minuteLabel,
  MINUTES_PER_DAY,
  tripDays,
  type Activity,
  type IsoDate,
  type Minute,
  type TripWindow,
} from '@/domain';
import {
  blockTop,
  COL_MIN_PX,
  DAY_PX,
  disabledSpans,
  HEADER_PX,
  initialScrollTop,
  TIME_COL_PX,
  timeRangeLabel,
} from './timetableLayout';

export interface TimetableGridProps {
  tripWindow: TripWindow;
  /** All activities of the trip; only placed ones on a trip day are drawn. */
  activities: Activity[];
  /** When this changes (e.g. another trip) the view scrolls back to the trip start (FR-4.4). */
  scrollKey: string;
  onOpenActivity: (activity: Activity) => void;
  onDeleteActivity?: (activity: Activity) => void;
  /** Hooks for the drag engine: the scroll container and the day-columns layer. */
  scrollerRef?: RefObject<HTMLDivElement>;
  /** Object or callback ref; a callback lets the drag root portal its drop preview into the layer. */
  columnsRef?: Ref<HTMLDivElement>;
  /** Extra classes for placed blocks (drag affordances). Must be a stable string. */
  blockClassName?: string;
  className?: string;
}

const HOUR_PX = 2 * SLOT_HEIGHT_PX;

/**
 * 48 half-hour rows drawn as two repeating backgrounds on one layer instead of 48 × days cell
 * elements (NFR-3): a strong line on the hour, a light one on the half hour (prototype `.slot`).
 */
const linesStyle: CSSProperties = {
  backgroundImage: [
    `repeating-linear-gradient(to bottom, transparent 0 ${HOUR_PX - 1}px, var(--color-line-strong) ${HOUR_PX - 1}px ${HOUR_PX}px)`,
    `repeating-linear-gradient(to bottom, transparent 0 ${SLOT_HEIGHT_PX - 1}px, var(--color-line) ${SLOT_HEIGHT_PX - 1}px ${SLOT_HEIGHT_PX}px)`,
  ].join(','),
};

/** Prototype `.slot.off` hatch (DEC-018 tokens). */
const disabledStyle: CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(45deg, var(--color-slot-disabled-hatch) 0 6px, var(--color-slot-disabled) 6px 12px)',
};

const HOURS = Array.from({ length: 24 }, (_, h) => minuteLabel(h * 60));

/**
 * The timetable grid (FR-4.1–4.5): one column per trip day, right-to-left in Hebrew, with a sticky
 * day header row and a sticky time column inside a single scroll container. Placed activities are
 * absolutely positioned ActivityBlocks — the only focus targets in the grid.
 *
 * Internal to the schedule feature: `Timetable` is the public wrapper and passes the drag root's
 * hooks (`scrollerRef`, `columnsRef`, `blockClassName`).
 */
export const TimetableGrid = memo(function TimetableGrid({
  tripWindow,
  activities,
  scrollKey,
  onOpenActivity,
  onDeleteActivity,
  scrollerRef,
  columnsRef,
  blockClassName,
  className,
}: TimetableGridProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const ownScrollerRef = useRef<HTMLDivElement>(null);
  const scroller = scrollerRef ?? ownScrollerRef;

  const days = useMemo(() => tripDays(tripWindow), [tripWindow]);
  const byDay = useMemo(() => groupByDay(activities), [activities]);

  // Stable callbacks so a parent re-render (new inline handlers) does not re-render every column.
  const openRef = useRef(onOpenActivity);
  const deleteRef = useRef(onDeleteActivity);
  useLayoutEffect(() => {
    openRef.current = onOpenActivity;
    deleteRef.current = onDeleteActivity;
  });
  const open = useCallback((a: Activity) => openRef.current(a), []);
  const remove = useCallback((a: Activity) => deleteRef.current?.(a), []);
  const canDelete = onDeleteActivity !== undefined;

  // FR-4.4: open at the trip start, at the first day (scrollLeft 0 is the inline start in RTL too).
  // Only when the trip changes, so editing activities never moves the view.
  const windowRef = useRef(tripWindow);
  useLayoutEffect(() => {
    windowRef.current = tripWindow;
  });
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = initialScrollTop(windowRef.current);
    el.scrollLeft = 0;
  }, [scrollKey, scroller]);

  return (
    <div
      ref={scroller}
      role="region"
      aria-label={t('schedule.timetable.label')}
      // Focusable so keyboard users can scroll to empty days and hours (WCAG 2.1.1).
      tabIndex={0}
      data-testid="timetable-scroller"
      className={cx(
        'min-h-0 flex-1 overflow-auto overscroll-contain rounded-[var(--radius-card)] border border-line bg-panel shadow-[var(--shadow-card)]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink',
        className,
      )}
    >
      <div
        className="grid"
        style={{
          // Columns are 150 px wide, stretched only when a short trip leaves free space. (Not
          // `width: max-content`, which lets fr tracks grow to their content's width.)
          width: `max(100%, ${TIME_COL_PX + days.length * COL_MIN_PX}px)`,
          gridTemplateColumns: `${TIME_COL_PX}px repeat(${days.length}, minmax(${COL_MIN_PX}px, 1fr))`,
          gridTemplateRows: `${HEADER_PX}px ${DAY_PX}px`,
        }}
      >
        <div className="sticky start-0 top-0 z-[5] border-b border-line-strong bg-panel" />
        {days.map((date, i) => (
          <div
            key={date}
            className="sticky top-0 z-[3] border-s border-b border-line border-b-line-strong bg-panel px-1.5 py-2 text-center"
          >
            <h3 id={`${headingId}-${i}`} className="m-0 font-normal">
              <span className="block text-sm font-semibold">{formatWeekday(date)}</span>
              <span className="mt-0.5 block text-xs text-ink-soft">
                {formatShortDate(date)} · {t('schedule.timetable.dayN', { n: i + 1 })}
              </span>
            </h3>
          </div>
        ))}
        <div className="sticky start-0 z-[2] bg-panel" aria-hidden="true">
          {HOURS.map((label) => (
            <div
              key={label}
              className="pt-[3px] text-center text-[11px] text-ink-soft"
              style={{ height: HOUR_PX }}
            >
              {label}
            </div>
          ))}
        </div>
        <div
          ref={columnsRef}
          data-testid="timetable-columns"
          // `isolate`: blocks stay below the sticky header and time column when scrolled.
          className="relative isolate grid"
          style={{
            gridColumn: `2 / span ${days.length}`,
            gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
          }}
        >
          {days.map((date, i) => {
            const bounds = dayBounds(tripWindow, date);
            return (
              <DayColumn
                key={date}
                date={date}
                headingId={`${headingId}-${i}`}
                startMinute={bounds?.startMinute ?? 0}
                endMinute={bounds?.endMinute ?? MINUTES_PER_DAY}
                activities={byDay.get(date) ?? NO_ACTIVITIES}
                onOpen={open}
                onDelete={canDelete ? remove : undefined}
                blockClassName={blockClassName}
              />
            );
          })}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[1]"
            style={linesStyle}
          />
        </div>
      </div>
    </div>
  );
});

const NO_ACTIVITIES: Activity[] = [];

/** Placed activities per date, each list sorted by start time (keyboard order = time order). */
function groupByDay(activities: Activity[]): Map<IsoDate, Activity[]> {
  const map = new Map<IsoDate, Activity[]>();
  for (const a of activities) {
    if (!a.placement) continue;
    const list = map.get(a.placement.date);
    if (list) list.push(a);
    else map.set(a.placement.date, [a]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.placement?.startMinute ?? 0) - (b.placement?.startMinute ?? 0));
  }
  return map;
}

interface DayColumnProps {
  date: IsoDate;
  headingId: string;
  startMinute: Minute;
  endMinute: Minute;
  activities: Activity[];
  onOpen: (activity: Activity) => void;
  onDelete: ((activity: Activity) => void) | undefined;
  blockClassName: string | undefined;
}

/** Re-render a column only if its own activities (by identity) or bounds changed (NFR-3). */
function sameColumn(prev: DayColumnProps, next: DayColumnProps): boolean {
  return (
    prev.date === next.date &&
    prev.headingId === next.headingId &&
    prev.startMinute === next.startMinute &&
    prev.endMinute === next.endMinute &&
    prev.onOpen === next.onOpen &&
    prev.onDelete === next.onDelete &&
    prev.blockClassName === next.blockClassName &&
    prev.activities.length === next.activities.length &&
    prev.activities.every((a, i) => a === next.activities[i])
  );
}

const DayColumn = memo(function DayColumn({
  date,
  headingId,
  startMinute,
  endMinute,
  activities,
  onOpen,
  onDelete,
  blockClassName,
}: DayColumnProps) {
  const spans = disabledSpans({ startMinute, endMinute });
  return (
    <div
      role="group"
      aria-labelledby={headingId}
      data-day={date}
      className="relative min-w-0 border-s border-line"
    >
      {spans.map((s) => (
        <div
          key={s.top}
          aria-hidden="true"
          data-disabled-slots=""
          className="absolute inset-x-0"
          style={{ ...disabledStyle, top: s.top, height: s.height }}
        />
      ))}
      {activities.map((a) => {
        const start = a.placement?.startMinute ?? 0;
        return (
          <ActivityBlock
            key={a.id}
            // The drag engine finds blocks by this attribute (event delegation).
            data-drag-id={a.id}
            className={cx('inset-x-1 z-[2]', blockClassName)}
            // Inline, because ActivityBlock's own `relative` class beats an `absolute` class.
            style={{ position: 'absolute', top: blockTop(start) }}
            name={a.name}
            durationMinutes={a.durationMinutes}
            color={a.color}
            meta={timeRangeLabel(start, a.durationMinutes)}
            onOpen={() => onOpen(a)}
            onDelete={onDelete && (() => onDelete(a))}
          />
        );
      })}
    </div>
  );
}, sameColumn);

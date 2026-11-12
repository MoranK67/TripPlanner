// SPIKE (M5.1) — throwaway dev page, not product code. Delete this folder once M5.3 lands.
// Evaluates the prototype pointer engine ported to React (usePointerDrag + geometry.ts) on a
// realistic grid: RTL, sticky day header + time column inside one scroll container, background-drawn
// slot lines, disabled slots, 7/30/90-day trips, bank ↔ grid, auto-scroll, long-press touch.
// Data lives in memory only; placement rules come from @/domain (canPlace).

import {
  memo,
  Profiler,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ActivityBlock,
  activityBlockHeight,
  blockSlots,
  Button,
  cx,
  HeaderActions,
  SidebarLayout,
  SLOT_HEIGHT_PX,
  useToast,
} from '@/components/ui';
import {
  canPlace,
  dayBounds,
  formatShortDate,
  formatWeekday,
  minuteLabel,
  SLOT_MINUTES,
  SLOTS_PER_DAY,
  tripDays,
  type Activity,
  type IsoDate,
  type PlacementCheck,
  type TripWindow,
} from '@/domain';
import { SAMPLE_KEYS, seedActivities, spikeWindow } from './spikeData';
import { autoScrollStep, hitTestSlot, contains, type Direction, type Rect } from './geometry';
import {
  usePointerDrag,
  useDragState,
  type DragFrameStats,
  type DragStore,
} from './usePointerDrag';

const HEADER_PX = 56;
const TIME_COL_PX = 64;
const COL_MIN_PX = 150;
const DAY_PX = SLOTS_PER_DAY * SLOT_HEIGHT_PX;
const DAY_OPTIONS = [7, 30, 90] as const;

type SpikeTarget =
  { kind: 'bank' } | { kind: 'grid'; dayIndex: number; slot: number; check: PlacementCheck };

function sameTarget(a: SpikeTarget | null, b: SpikeTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'bank' || b.kind === 'bank') return a.kind === b.kind;
  return a.dayIndex === b.dayIndex && a.slot === b.slot && a.check.ok === b.check.ok;
}

function readDirection(el: Element): Direction {
  const computed = getComputedStyle(el).direction || document.documentElement.dir;
  return computed === 'rtl' ? 'rtl' : 'ltr';
}

/** Scroll container's client box minus the sticky header and the sticky time column. */
function visibleDropArea(scroller: HTMLElement, direction: Direction): Rect {
  const r = scroller.getBoundingClientRect();
  const left = r.left + scroller.clientLeft;
  const top = r.top + scroller.clientTop;
  const right = left + scroller.clientWidth;
  const bottom = top + scroller.clientHeight;
  return direction === 'rtl'
    ? { left, top: top + HEADER_PX, right: right - TIME_COL_PX, bottom }
    : { left: left + TIME_COL_PX, top: top + HEADER_PX, right, bottom };
}

const blockClass =
  'cursor-grab touch-manipulation select-none [-webkit-touch-callout:none] data-dragging:opacity-30';

/** Page wrapper: the trip length picker remounts the planner with fresh data. */
export function DndSpikePage() {
  const { t } = useTranslation();
  const [dayCount, setDayCount] = useState<number>(30);
  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-testid="dnd-spike">
      <HeaderActions>
        <span className="text-sm text-ink-soft">{t('schedule.spike.daysLabel')}</span>
        {DAY_OPTIONS.map((n) => (
          <Button
            key={n}
            size="sm"
            variant={n === dayCount ? 'primary' : 'soft'}
            aria-pressed={n === dayCount}
            onClick={() => setDayCount(n)}
          >
            {t('schedule.spike.days', { count: n })}
          </Button>
        ))}
      </HeaderActions>
      <SpikePlanner key={dayCount} dayCount={dayCount} />
    </div>
  );
}

export function SpikePlanner({ dayCount }: { dayCount: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const tripWindow = useMemo(() => spikeWindow(dayCount), [dayCount]);
  const days = useMemo(() => tripDays(tripWindow), [tripWindow]);
  const [activities, setActivities] = useState(() =>
    seedActivities(tripWindow, (i) =>
      t(`devUi.sampleNames.${SAMPLE_KEYS[i % SAMPLE_KEYS.length] ?? 'a'}`),
    ),
  );
  const [stats, setStats] = useState<(DragFrameStats & { gridCommits: number }) | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const bankRef = useRef<HTMLDivElement>(null);
  const activitiesRef = useRef(activities);
  const directionRef = useRef<Direction>('rtl');
  const gridCommitsRef = useRef(0);
  useEffect(() => {
    activitiesRef.current = activities;
  }, [activities]);

  const byId = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);

  const resolveTarget = (sourceId: string, pointer: { x: number; y: number }, grabY: number) => {
    const bank = bankRef.current;
    if (bank && contains(bank.getBoundingClientRect(), pointer)) return { kind: 'bank' } as const;
    const scroller = scrollerRef.current;
    const columns = columnsRef.current;
    const subject = activitiesRef.current.find((a) => a.id === sourceId);
    if (!scroller || !columns || !subject) return null;
    const hit = hitTestSlot(
      {
        viewport: visibleDropArea(scroller, directionRef.current),
        columns: columns.getBoundingClientRect(),
        dayCount: days.length,
        direction: directionRef.current,
        slotHeight: SLOT_HEIGHT_PX,
      },
      pointer,
      grabY,
      blockSlots(subject.durationMinutes),
    );
    const date = hit && days[hit.dayIndex];
    if (!hit || !date) return null;
    const check = canPlace({ window: tripWindow, activities: activitiesRef.current }, subject, {
      date,
      startMinute: hit.slot * SLOT_MINUTES,
    });
    return { kind: 'grid', dayIndex: hit.dayIndex, slot: hit.slot, check } as const;
  };

  const drag = usePointerDrag<SpikeTarget>({
    rootRef,
    scrollerRef,
    getAutoScroll: (pointer) => {
      const scroller = scrollerRef.current;
      return scroller
        ? autoScrollStep(visibleDropArea(scroller, directionRef.current), pointer)
        : { dx: 0, dy: 0 };
    },
    resolveTarget: (source, pointer) => resolveTarget(source.id, pointer, source.grabOffset.y),
    sameTarget,
    onDragStart: () => {
      if (scrollerRef.current) directionRef.current = readDirection(scrollerRef.current);
      gridCommitsRef.current = 0;
    },
    onDragEnd: (frameStats) => setStats({ ...frameStats, gridCommits: gridCommitsRef.current }),
    onDrop: (source, target) => {
      if (!target) return;
      if (target.kind === 'bank') {
        setActivities((list) => {
          const maxPos = Math.max(
            0,
            ...list.filter((a) => !a.placement).map((a) => a.bankPosition),
          );
          return list.map((a) =>
            a.id === source.id && a.placement
              ? { ...a, placement: null, bankPosition: maxPos + 1 }
              : a,
          );
        });
        return;
      }
      if (!target.check.ok) {
        toast.show(t(`schedule.spike.invalid.${target.check.reason}`), { tone: 'error' });
        return;
      }
      const date = days[target.dayIndex];
      if (!date) return;
      // M5.4 replaces this with the optimistic TanStack mutation (FR-5.7).
      setActivities((list) =>
        list.map((a) =>
          a.id === source.id
            ? { ...a, placement: { date, startMinute: target.slot * SLOT_MINUTES } }
            : a,
        ),
      );
    },
  });

  // FR-4.4: open scrolled to the trip start (one slot of context above it).
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTop = Math.max(0, (tripWindow.startMinute / SLOT_MINUTES - 1) * SLOT_HEIGHT_PX);
  }, [tripWindow]);

  const onOpen = useCallback(
    (name: string) => toast.show(t('schedule.spike.opened', { name })),
    [toast, t],
  );
  const onGridCommit = useCallback(() => {
    gridCommitsRef.current += 1;
  }, []);

  const bankActivities = activities
    .filter((a) => !a.placement)
    .sort((a, b) => a.bankPosition - b.bankPosition);

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col gap-2">
      <div>
        <h2 className="m-0 text-base font-bold">{t('schedule.spike.title')}</h2>
        <p className="m-0 text-[13px] text-ink-soft">
          {t('schedule.spike.intro')} {t('schedule.spike.hint')}
        </p>
        {stats && (
          <p className="m-0 text-[13px] text-ink-soft" data-testid="spike-stats">
            {t('schedule.spike.stats', { ...stats })}
          </p>
        )}
      </div>
      <SidebarLayout
        className="min-h-0 flex-1"
        sidebarLabel={t('schedule.spike.bank')}
        sidebar={
          <div
            ref={bankRef}
            data-testid="spike-bank"
            className="relative flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto rounded-[var(--radius-card)] border border-line bg-panel p-3"
          >
            {bankActivities.length === 0 && (
              <p className="m-0 p-4 text-center text-[13px] text-ink-soft">
                {t('schedule.spike.bankEmpty')}
              </p>
            )}
            {bankActivities.map((a) => (
              <ActivityBlock
                key={a.id}
                data-drag-id={a.id}
                className={blockClass}
                name={a.name}
                durationMinutes={a.durationMinutes}
                color={a.color}
                onOpen={() => onOpen(a.name)}
              />
            ))}
            <BankDropHighlight store={drag.store} />
          </div>
        }
      >
        <SpikeGrid
          days={days}
          tripWindow={tripWindow}
          activities={activities}
          scrollerRef={scrollerRef}
          columnsRef={columnsRef}
          onOpen={onOpen}
          onCommit={onGridCommit}
          overlay={<DragPreview store={drag.store} dayCount={days.length} byId={byId} />}
        />
      </SidebarLayout>
      <DragGhost store={drag.store} ghostRef={drag.ghostRef} byId={byId} />
    </div>
  );
}

interface SpikeGridProps {
  days: IsoDate[];
  tripWindow: TripWindow;
  activities: Activity[];
  scrollerRef: RefObject<HTMLDivElement>;
  columnsRef: RefObject<HTMLDivElement>;
  onOpen: (name: string) => void;
  onCommit: () => void;
  overlay: ReactNode;
}

// Slot lines as backgrounds of one layer instead of 48 × days cell elements (M5.2, NFR-3).
const linesStyle: CSSProperties = {
  backgroundImage: [
    `repeating-linear-gradient(to bottom, transparent 0 ${2 * SLOT_HEIGHT_PX - 1}px, var(--color-line-strong) ${2 * SLOT_HEIGHT_PX - 1}px ${2 * SLOT_HEIGHT_PX}px)`,
    `repeating-linear-gradient(to bottom, transparent 0 ${SLOT_HEIGHT_PX - 1}px, var(--color-line) ${SLOT_HEIGHT_PX - 1}px ${SLOT_HEIGHT_PX}px)`,
  ].join(','),
};
const offStyle = 'repeating-linear-gradient(45deg, var(--color-line) 0 6px, transparent 6px 12px)';

const SpikeGrid = memo(function SpikeGrid({
  days,
  tripWindow,
  activities,
  scrollerRef,
  columnsRef,
  onOpen,
  onCommit,
  overlay,
}: SpikeGridProps) {
  const { t } = useTranslation();
  const byDay = useMemo(() => {
    const map = new Map<IsoDate, Activity[]>();
    for (const a of activities) {
      if (!a.placement) continue;
      const list = map.get(a.placement.date) ?? [];
      list.push(a);
      map.set(a.placement.date, list);
    }
    return map;
  }, [activities]);

  return (
    <div
      ref={scrollerRef}
      data-testid="spike-scroller"
      role="region"
      aria-label={t('schedule.spike.timetable')}
      tabIndex={0}
      className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-[var(--radius-card)] border border-line bg-panel focus-visible:outline-2 focus-visible:outline-accent-ink"
    >
      <div
        className="grid w-max min-w-full"
        style={{
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
            <div className="text-sm font-semibold">{formatWeekday(date)}</div>
            <div className="text-xs text-ink-soft">
              {formatShortDate(date)} · {t('schedule.spike.dayN', { n: i + 1 })}
            </div>
          </div>
        ))}
        <div className="sticky start-0 z-[2] bg-panel" aria-hidden="true">
          {Array.from({ length: SLOTS_PER_DAY }, (_, s) => (
            <div
              key={s}
              className="pt-[3px] text-center text-[11px] text-ink-soft"
              style={{ height: SLOT_HEIGHT_PX }}
            >
              {s % 2 === 0 ? minuteLabel(s * SLOT_MINUTES) : ''}
            </div>
          ))}
        </div>
        <div
          ref={columnsRef}
          data-testid="spike-columns"
          className="relative grid"
          style={{
            ...linesStyle,
            gridColumn: `2 / span ${days.length}`,
            gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
          }}
        >
          <Profiler id="spike-grid" onRender={onCommit}>
            {days.map((date) => (
              <DayColumn
                key={date}
                date={date}
                tripWindow={tripWindow}
                activities={byDay.get(date)}
                onOpen={onOpen}
              />
            ))}
          </Profiler>
          {overlay}
        </div>
      </div>
    </div>
  );
});

const DayColumn = memo(function DayColumn({
  date,
  tripWindow,
  activities,
  onOpen,
}: {
  date: IsoDate;
  tripWindow: TripWindow;
  activities: Activity[] | undefined;
  onOpen: (name: string) => void;
}) {
  const bounds = dayBounds(tripWindow, date);
  const startPx = ((bounds?.startMinute ?? 0) / SLOT_MINUTES) * SLOT_HEIGHT_PX;
  const endPx = ((bounds?.endMinute ?? 0) / SLOT_MINUTES) * SLOT_HEIGHT_PX;
  return (
    <div className="relative border-s border-line" data-day={date}>
      {startPx > 0 && (
        <div
          className="absolute inset-x-0 top-0"
          style={{ height: startPx, backgroundImage: offStyle }}
        />
      )}
      {endPx < DAY_PX && (
        <div
          className="absolute inset-x-0 bottom-0"
          style={{ top: endPx, backgroundImage: offStyle }}
        />
      )}
      {activities?.map((a) => {
        const start = a.placement?.startMinute ?? 0;
        return (
          <ActivityBlock
            key={a.id}
            data-drag-id={a.id}
            className={cx('absolute inset-x-1 z-[2]', blockClass)}
            style={{ top: (start / SLOT_MINUTES) * SLOT_HEIGHT_PX + 1 }}
            name={a.name}
            durationMinutes={a.durationMinutes}
            color={a.color}
            meta={`${minuteLabel(start)}–${minuteLabel(start + a.durationMinutes)}`}
            onOpen={() => onOpen(a.name)}
          />
        );
      })}
    </div>
  );
});

/** Green/red target outline (FR-5.2). Re-renders only when the snapped slot or validity changes. */
function DragPreview({
  store,
  dayCount,
  byId,
}: {
  store: DragStore<SpikeTarget>;
  dayCount: number;
  byId: Map<string, Activity>;
}) {
  const { source, target } = useDragState(store);
  const activity = source && byId.get(source.id);
  if (!activity || target?.kind !== 'grid') return null;
  return (
    <div
      data-testid="spike-preview"
      data-valid={target.check.ok}
      className={cx(
        'pointer-events-none absolute z-[1] rounded-[var(--radius-block)] border-2 border-dashed',
        target.check.ok ? 'border-ok bg-ok/25' : 'border-danger-ink/40 bg-danger/40',
      )}
      style={{
        insetInlineStart: `calc(${target.dayIndex} * 100% / ${dayCount} + 4px)`,
        width: `calc(100% / ${dayCount} - 8px)`,
        top: target.slot * SLOT_HEIGHT_PX + 1,
        height: activityBlockHeight(activity.durationMinutes),
      }}
    />
  );
}

function BankDropHighlight({ store }: { store: DragStore<SpikeTarget> }) {
  const { target } = useDragState(store);
  if (target?.kind !== 'bank') return null;
  return (
    <div className="pointer-events-none absolute inset-0 rounded-[var(--radius-card)] bg-accent-soft/40 ring-2 ring-accent-strong ring-inset" />
  );
}

/** Floating copy under the pointer; positioned by the engine through `ghostRef`. */
function DragGhost({
  store,
  ghostRef,
  byId,
}: {
  store: DragStore<SpikeTarget>;
  ghostRef: RefObject<HTMLDivElement>;
  byId: Map<string, Activity>;
}) {
  const { source } = useDragState(store);
  const activity = source && byId.get(source.id);
  if (!source || !activity) return null;
  const x = source.startPointer.x - source.grabOffset.x;
  const y = source.startPointer.y - source.grabOffset.y;
  return createPortal(
    <div
      ref={ghostRef}
      aria-hidden="true"
      className="pointer-events-none fixed top-0 left-0 z-[1000] opacity-95 shadow-[var(--shadow-pop)] will-change-transform"
      style={{ width: source.width, transform: `translate3d(${x}px, ${y}px, 0)` }}
    >
      <ActivityBlock
        name={activity.name}
        durationMinutes={activity.durationMinutes}
        color={activity.color}
        meta={
          activity.placement
            ? `${minuteLabel(activity.placement.startMinute)}–${minuteLabel(activity.placement.startMinute + activity.durationMinutes)}`
            : undefined
        }
      />
    </div>,
    document.body,
  );
}

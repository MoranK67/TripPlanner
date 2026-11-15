import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ActivityBlock,
  activityBlockHeight,
  blockSlots,
  cx,
  SLOT_HEIGHT_PX,
  useToast,
} from '@/components/ui';
import {
  canPlace,
  SLOT_MINUTES,
  tripDays,
  type Activity,
  type IsoDate,
  type Minute,
  type PlacementCheck,
  type Trip,
} from '@/domain';
import { HEADER_PX, TIME_COL_PX, timeRangeLabel } from '../timetableLayout';
import {
  BANK_DROP_OVER_CLASSES,
  DragRootContext,
  type DayView,
  type DragRootContextValue,
} from './dragContext';
import {
  autoScrollStep,
  contains,
  dropArea,
  edgeSide,
  hitTestSlot,
  type Direction,
  type Point,
} from './geometry';
import {
  useDragSource,
  useDragState,
  usePointerDrag,
  type DragSource,
  type DragStore,
} from './usePointerDrag';

/** Where a dragged block would land. */
export type DropTarget =
  | { kind: 'bank' }
  | {
      kind: 'grid';
      /** 0 = first trip day (not the visible column: the phone view shows one day of many). */
      dayIndex: number;
      slot: number;
      durationMinutes: number;
      check: PlacementCheck;
    };

const BANK_TARGET: DropTarget = { kind: 'bank' };

function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'bank' || b.kind === 'bank') return a.kind === b.kind;
  return (
    a.dayIndex === b.dayIndex &&
    a.slot === b.slot &&
    a.durationMinutes === b.durationMinutes &&
    a.check.ok === b.check.ok
  );
}

function readDirection(el: Element): Direction {
  const computed = getComputedStyle(el).direction || document.documentElement.dir;
  return computed === 'rtl' ? 'rtl' : 'ltr';
}

/** Client box of the scroll container in viewport coordinates (without borders/scrollbars). */
function clientBox(scroller: HTMLElement) {
  const r = scroller.getBoundingClientRect();
  const left = r.left + scroller.clientLeft;
  const top = r.top + scroller.clientTop;
  return { left, top, right: left + scroller.clientWidth, bottom: top + scroller.clientHeight };
}

/** Visible drop area of the scroll container (client box without the sticky header/time column). */
function visibleDropArea(scroller: HTMLElement, direction: Direction) {
  return dropArea(clientBox(scroller), direction, HEADER_PX, TIME_COL_PX);
}

/** How long a block must be held at a side edge of the phone's day view to switch the day. */
export const EDGE_SWITCH_MS = 650;

export interface TimetableDragRootProps {
  trip: Trip;
  /** All of the trip's activities (bank + placed), as rendered by the bank and the timetable. */
  activities: readonly Activity[];
  /** A valid drop on the timetable: place a bank activity or move a placed one (FR-5.1). */
  onPlace: (activityId: string, date: IsoDate, startMinute: Minute) => void;
  /** A placed activity dropped on the bank (FR-3.7). */
  onUnplace: (activityId: string) => void;
  /** The bank (with `useBankDropZone` / `dragSourceProps`) and the `Timetable`. */
  children: ReactNode;
}

/**
 * Drag and drop between the bank and the timetable (FR-5.1–5.4, ADR-002): bank → grid,
 * grid → grid and grid → bank, with mouse or a long press on touch screens. The drop snaps to
 * half-hour slots; a green/red preview shows the `canPlace` result; an invalid drop shows the
 * reason and changes nothing; the timetable auto-scrolls near its edges; Escape cancels.
 *
 * Renders no box of its own (`display: contents`), so it does not change the page layout.
 */
export function TimetableDragRoot({
  trip,
  activities,
  onPlace,
  onUnplace,
  children,
}: TimetableDragRootProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement | null>(null);
  const bankRef = useRef<HTMLElement | null>(null);
  const directionRef = useRef<Direction>('rtl');
  // The preview is portalled into the columns layer from here, so it never re-renders the grid.
  const [columnsEl, setColumnsEl] = useState<HTMLDivElement | null>(null);
  // Phone single-day view (M7.1): the visible days. State for the preview, ref for the frame loop.
  const [view, setViewState] = useState<DayView | null>(null);
  const viewRef = useRef<DayView | null>(null);
  const sourceRef = useRef<DragSource | null>(null);
  const edgeRef = useRef<{ delta: -1 | 1; since: number } | null>(null);

  const days = useMemo(() => tripDays(trip.window), [trip.window]);
  const byId = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);

  const resolveTarget = (id: string, pointer: Point, grabOffsetY: number): DropTarget | null => {
    const bank = bankRef.current;
    if (bank && contains(bank.getBoundingClientRect(), pointer)) return BANK_TARGET;
    const scroller = scrollerRef.current;
    const columns = columnsRef.current;
    const subject = byId.get(id);
    if (!scroller || !columns || !subject) return null;
    const first = viewRef.current?.start ?? 0;
    const hit = hitTestSlot(
      {
        viewport: visibleDropArea(scroller, directionRef.current),
        columns: columns.getBoundingClientRect(),
        dayCount: viewRef.current?.count ?? days.length,
        direction: directionRef.current,
        slotHeight: SLOT_HEIGHT_PX,
      },
      pointer,
      grabOffsetY,
      blockSlots(subject.durationMinutes),
    );
    const dayIndex = hit ? first + hit.dayIndex : -1;
    const date = days[dayIndex];
    if (!hit || !date) return null;
    const check = canPlace({ window: trip.window, activities }, subject, {
      date,
      startMinute: hit.slot * SLOT_MINUTES,
    });
    return {
      kind: 'grid',
      dayIndex,
      slot: hit.slot,
      durationMinutes: subject.durationMinutes,
      check,
    };
  };

  const drop = (id: string, target: DropTarget | null) => {
    const activity = byId.get(id);
    if (!target || !activity) return;
    if (target.kind === 'bank') {
      if (activity.placement) onUnplace(id);
      return;
    }
    if (!target.check.ok) {
      // Same message per kind as a server rejection (DEC-014).
      toast.show(t(`errors.kinds.${target.check.reason}`), { tone: 'error' });
      return;
    }
    const date = days[target.dayIndex];
    const startMinute = target.slot * SLOT_MINUTES;
    if (!date) return;
    const { placement } = activity;
    if (placement?.date === date && placement.startMinute === startMinute) return;
    onPlace(id, date, startMinute);
  };

  /**
   * Phone day view: holding a block at the left/right edge for EDGE_SWITCH_MS shows the
   * neighbouring day (and keeps going while held). Not for a placed block dragged by touch: its day
   * column would unmount with the block the finger is on, and touch events of a removed element
   * no longer reach the drag root (the browser could start scrolling mid-drag).
   */
  const edgeSwitch = (pointer: Point, scroller: HTMLElement) => {
    const v = viewRef.current;
    const source = sourceRef.current;
    const touchMove = source?.pointerType === 'touch' && byId.get(source.id)?.placement;
    if (!v || !source || touchMove || v.count >= days.length) {
      edgeRef.current = null;
      return;
    }
    const direction = directionRef.current;
    const area = visibleDropArea(scroller, direction);
    const box = clientBox(scroller);
    const side = edgeSide({ ...box, top: area.top, bottom: area.bottom }, pointer);
    // Physical side -> day: in RTL the later days lie to the left.
    const delta: -1 | 1 = direction === 'rtl' ? (side === -1 ? 1 : -1) : side === -1 ? -1 : 1;
    const next = v.start + delta;
    if (side === 0 || next < 0 || next + v.count > days.length) {
      edgeRef.current = null;
      return;
    }
    const now = performance.now();
    const held = edgeRef.current;
    if (held?.delta !== delta) {
      edgeRef.current = { delta, since: now };
    } else if (now - held.since >= EDGE_SWITCH_MS) {
      edgeRef.current = { delta, since: now };
      v.shift(delta);
    }
  };

  const drag = usePointerDrag<DropTarget>({
    rootRef,
    scrollerRef,
    getAutoScroll: (pointer) => {
      const scroller = scrollerRef.current;
      if (!scroller) return { dx: 0, dy: 0 };
      edgeSwitch(pointer, scroller);
      return autoScrollStep(visibleDropArea(scroller, directionRef.current), pointer);
    },
    resolveTarget: (source, pointer) => resolveTarget(source.id, pointer, source.grabOffset.y),
    sameTarget,
    onDragStart: (source) => {
      sourceRef.current = source;
      edgeRef.current = null;
      if (scrollerRef.current) directionRef.current = readDirection(scrollerRef.current);
    },
    onDrop: (source, target) => drop(source.id, target),
  });

  // Bank highlight through a data attribute: the bank panel never re-renders during a drag.
  const { store } = drag;
  useEffect(
    () =>
      store.subscribe(() => {
        const bank = bankRef.current;
        if (!bank) return;
        const over = store.get().target?.kind === 'bank';
        if (over === bank.hasAttribute('data-drop-over')) return;
        bank.toggleAttribute('data-drop-over', over);
        for (const name of BANK_DROP_OVER_CLASSES) bank.classList.toggle(name, over);
      }),
    [store],
  );

  const setColumns = useCallback((el: HTMLDivElement | null) => {
    columnsRef.current = el;
    setColumnsEl(el);
  }, []);
  const setBank = useCallback((el: HTMLElement | null) => {
    bankRef.current = el;
  }, []);
  const setView = useCallback((next: DayView | null) => {
    viewRef.current = next;
    setViewState(next);
  }, []);
  const context = useMemo<DragRootContextValue>(
    () => ({
      scrollerRef,
      columnsRef: setColumns,
      bankRef: setBank,
      setView,
      isDragging: () => store.get().source !== null,
      subscribe: store.subscribe,
    }),
    [setColumns, setBank, setView, store],
  );

  return (
    <DragRootContext.Provider value={context}>
      <div ref={rootRef} className="contents" data-testid="timetable-drag-root">
        {children}
      </div>
      {columnsEl &&
        createPortal(
          <DropPreview
            store={store}
            firstDay={view?.start ?? 0}
            dayCount={view?.count ?? days.length}
          />,
          columnsEl,
        )}
      <DragGhost store={store} ghostRef={drag.ghostRef} byId={byId} />
    </DragRootContext.Provider>
  );
}

/** Green/red outline of the snapped target (FR-5.2). Re-renders only when the target changes. */
function DropPreview({
  store,
  firstDay,
  dayCount,
}: {
  store: DragStore<DropTarget>;
  /** Trip day index of the first visible column. */
  firstDay: number;
  /** Number of visible columns. */
  dayCount: number;
}) {
  const { target } = useDragState(store);
  if (target?.kind !== 'grid') return null;
  const column = target.dayIndex - firstDay;
  if (column < 0 || column >= dayCount) return null;
  const valid = target.check.ok;
  return (
    <div
      data-testid="drop-preview"
      data-valid={valid}
      // Visual only: the reason of an invalid drop is shown (and announced) by the toast.
      aria-hidden="true"
      className={cx(
        'pointer-events-none absolute z-[1] rounded-[var(--radius-block)] border-2 border-dashed',
        valid ? 'border-ok bg-ok/25' : 'border-danger-ink/40 bg-danger/40',
      )}
      style={{
        insetInlineStart: `calc(${column} * 100% / ${dayCount} + 4px)`,
        width: `calc(100% / ${dayCount} - 8px)`,
        top: target.slot * SLOT_HEIGHT_PX + 1,
        height: activityBlockHeight(target.durationMinutes),
      }}
    />
  );
}

/** Floating copy under the pointer; the engine moves it through `ghostRef`. */
function DragGhost({
  store,
  ghostRef,
  byId,
}: {
  store: DragStore<DropTarget>;
  ghostRef: RefObject<HTMLDivElement>;
  byId: Map<string, Activity>;
}) {
  const source = useDragSource(store);
  const activity = source && byId.get(source.id);
  if (!source || !activity) return null;
  const x = source.startPointer.x - source.grabOffset.x;
  const y = source.startPointer.y - source.grabOffset.y;
  // Physical `fixed top-0 left-0` on purpose, also in RTL: the engine positions the ghost with a
  // `translate3d` in viewport (clientX/clientY) coordinates, which are measured from the top-left.
  return createPortal(
    <div
      ref={ghostRef}
      aria-hidden="true"
      data-testid="drag-ghost"
      className="pointer-events-none fixed top-0 left-0 z-[1000] opacity-95 shadow-[var(--shadow-pop)] will-change-transform"
      style={{ width: source.width, transform: `translate3d(${x}px, ${y}px, 0)` }}
    >
      <ActivityBlock
        name={activity.name}
        durationMinutes={activity.durationMinutes}
        color={activity.color}
        meta={
          activity.placement
            ? timeRangeLabel(activity.placement.startMinute, activity.durationMinutes)
            : undefined
        }
      />
    </div>,
    document.body,
  );
}

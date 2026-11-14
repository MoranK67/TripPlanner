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
import { BANK_DROP_OVER_CLASSES, DragRootContext, type DragRootContextValue } from './dragContext';
import {
  autoScrollStep,
  contains,
  dropArea,
  hitTestSlot,
  type Direction,
  type Point,
} from './geometry';
import { useDragSource, useDragState, usePointerDrag, type DragStore } from './usePointerDrag';

/** Where a dragged block would land. */
export type DropTarget =
  | { kind: 'bank' }
  | {
      kind: 'grid';
      /** 0 = first trip day. */
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

/** Visible drop area of the scroll container (client box without the sticky header/time column). */
function visibleDropArea(scroller: HTMLElement, direction: Direction) {
  const r = scroller.getBoundingClientRect();
  const left = r.left + scroller.clientLeft;
  const top = r.top + scroller.clientTop;
  return dropArea(
    { left, top, right: left + scroller.clientWidth, bottom: top + scroller.clientHeight },
    direction,
    HEADER_PX,
    TIME_COL_PX,
  );
}

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

  const days = useMemo(() => tripDays(trip.window), [trip.window]);
  const byId = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);

  const resolveTarget = (id: string, pointer: Point, grabOffsetY: number): DropTarget | null => {
    const bank = bankRef.current;
    if (bank && contains(bank.getBoundingClientRect(), pointer)) return BANK_TARGET;
    const scroller = scrollerRef.current;
    const columns = columnsRef.current;
    const subject = byId.get(id);
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
      grabOffsetY,
      blockSlots(subject.durationMinutes),
    );
    const date = hit && days[hit.dayIndex];
    if (!hit || !date) return null;
    const check = canPlace({ window: trip.window, activities }, subject, {
      date,
      startMinute: hit.slot * SLOT_MINUTES,
    });
    return {
      kind: 'grid',
      dayIndex: hit.dayIndex,
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

  const drag = usePointerDrag<DropTarget>({
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
  const context = useMemo<DragRootContextValue>(
    () => ({ scrollerRef, columnsRef: setColumns, bankRef: setBank }),
    [setColumns, setBank],
  );

  return (
    <DragRootContext.Provider value={context}>
      <div ref={rootRef} className="contents" data-testid="timetable-drag-root">
        {children}
      </div>
      {columnsEl && createPortal(<DropPreview store={store} dayCount={days.length} />, columnsEl)}
      <DragGhost store={store} ghostRef={drag.ghostRef} byId={byId} />
    </DragRootContext.Provider>
  );
}

/** Green/red outline of the snapped target (FR-5.2). Re-renders only when the target changes. */
function DropPreview({ store, dayCount }: { store: DragStore<DropTarget>; dayCount: number }) {
  const { target } = useDragState(store);
  if (target?.kind !== 'grid') return null;
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
        insetInlineStart: `calc(${target.dayIndex} * 100% / ${dayCount} + 4px)`,
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

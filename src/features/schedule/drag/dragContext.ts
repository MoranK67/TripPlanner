// The contract between the drag root (TimetableDragRoot) and the parts it connects: the timetable
// (scroll container + day-columns layer) and the bank (drop zone + draggable blocks), ADR-002.
// The bank lives in another feature, so it only marks its blocks and hands over its element.

import {
  createContext,
  useContext,
  useSyncExternalStore,
  type RefCallback,
  type RefObject,
} from 'react';

/**
 * The trip days the timetable currently shows. The desktop grid shows all of them (no view
 * registered); the phone layout shows one day (M7.1) and registers `{ start, count: 1 }`, so the
 * drag root hit-tests with `dayCount = count` and offsets the day index by `start` (ADR-002).
 */
export interface DayView {
  /** Trip day index (0 = first day) of the first visible column. */
  start: number;
  /** Number of visible day columns. */
  count: number;
  /** Show the previous (−1) or next (+1) day; used to switch days at the edge during a drag. */
  shift: (delta: -1 | 1) => void;
}

export interface DragRootContextValue {
  /** The timetable's scroll container (auto-scroll, visible drop area). */
  scrollerRef: RefObject<HTMLDivElement>;
  /** The timetable's day-columns layer (hit-testing, drop preview). */
  columnsRef: RefCallback<HTMLDivElement>;
  /** The bank's drop zone element. */
  bankRef: RefCallback<HTMLElement>;
  /** The timetable reports a partial day view (phone); `null` = all days are visible. */
  setView: (view: DayView | null) => void;
  /** True while a drag is in progress (not during the touch long-press wait). */
  isDragging: () => boolean;
  /** Called when the drag state changes (start, target change, end). */
  subscribe: (listener: () => void) => () => void;
}

export const DragRootContext = createContext<DragRootContextValue | null>(null);

/** Read by the timetable; `null` outside a TimetableDragRoot (then nothing is draggable). */
export function useDragRoot(): DragRootContextValue | null {
  return useContext(DragRootContext);
}

/**
 * Classes for a draggable block: no text selection or iOS callout on long press, taps still
 * scroll (`touch-manipulation`), dimmed while it is being dragged (`data-dragging`), outlined
 * while it waits for a slot in tap-to-place mode (`data-picked`, M7.2).
 */
export const DRAG_SOURCE_CLASS =
  'cursor-grab touch-manipulation select-none [-webkit-touch-callout:none] data-dragging:opacity-30 data-picked:outline-2 data-picked:outline-offset-1 data-picked:outline-accent-ink data-picked:outline-dashed';

/** Props that make an ActivityBlock draggable by the timetable's drag engine (spread them on it). */
export function dragSourceProps(activityId: string): {
  'data-drag-id': string;
  className: string;
} {
  return { 'data-drag-id': activityId, className: DRAG_SOURCE_CLASS };
}

/**
 * Highlight while a placed block is over the bank. The drag root toggles these classes (and
 * `data-drop-over`) on the bank element directly, so the bank never re-renders during a drag.
 * Ring only: it composes with the panel's own shadow and background.
 */
export const BANK_DROP_OVER_CLASSES = ['ring-2', 'ring-inset', 'ring-accent-strong'] as const;

const noRef: RefCallback<HTMLElement> = () => {};
const never = () => false;
const noSubscribe = () => () => {};

/** Whether a drag is in progress; re-renders only when a drag starts or ends. */
export function useIsDragging(): boolean {
  const root = useContext(DragRootContext);
  return useSyncExternalStore(root?.subscribe ?? noSubscribe, root?.isDragging ?? never, never);
}

/**
 * Callback ref that makes an element (the bank panel) the "back to the bank" drop zone.
 * Outside a TimetableDragRoot it does nothing.
 */
export function useBankDropZone(): RefCallback<HTMLElement> {
  return useContext(DragRootContext)?.bankRef ?? noRef;
}

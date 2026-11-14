// The contract between the drag root (TimetableDragRoot) and the parts it connects: the timetable
// (scroll container + day-columns layer) and the bank (drop zone + draggable blocks), ADR-002.
// The bank lives in another feature, so it only marks its blocks and hands over its element.

import { createContext, useContext, type RefCallback, type RefObject } from 'react';

export interface DragRootContextValue {
  /** The timetable's scroll container (auto-scroll, visible drop area). */
  scrollerRef: RefObject<HTMLDivElement>;
  /** The timetable's day-columns layer (hit-testing, drop preview). */
  columnsRef: RefCallback<HTMLDivElement>;
  /** The bank's drop zone element. */
  bankRef: RefCallback<HTMLElement>;
}

export const DragRootContext = createContext<DragRootContextValue | null>(null);

/** Read by the timetable; `null` outside a TimetableDragRoot (then nothing is draggable). */
export function useDragRoot(): DragRootContextValue | null {
  return useContext(DragRootContext);
}

/**
 * Classes for a draggable block: no text selection or iOS callout on long press, taps still
 * scroll (`touch-manipulation`), dimmed while it is being dragged (`data-dragging`).
 */
export const DRAG_SOURCE_CLASS =
  'cursor-grab touch-manipulation select-none [-webkit-touch-callout:none] data-dragging:opacity-30';

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

/**
 * Callback ref that makes an element (the bank panel) the "back to the bank" drop zone.
 * Outside a TimetableDragRoot it does nothing.
 */
export function useBankDropZone(): RefCallback<HTMLElement> {
  return useContext(DragRootContext)?.bankRef ?? noRef;
}

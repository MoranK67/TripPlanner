// SPIKE (M5.1) — throwaway. Pure drag geometry for the timetable, kept free of DOM access so it
// can be unit-tested in jsdom (which has no layout). Candidate for promotion in M5.3.
//
// Hit-testing is done with arithmetic on two measured rectangles instead of
// `document.elementFromPoint` (prototype): it ignores the ghost and the sticky header/time column,
// needs no per-slot DOM nodes or droppables, and works identically in RTL and LTR.

import { SLOTS_PER_DAY } from '@/domain';

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

export type Direction = 'rtl' | 'ltr';

export interface GridMetrics {
  /**
   * Visible drop area in viewport coordinates: the scroll container's client box minus the sticky
   * day header (top) and the sticky time column (inline-start). Pointers outside it never hit a slot,
   * so hovering the header or time labels cannot drop "under" them.
   */
  viewport: Rect;
  /** Viewport rect of the full day-columns layer. It moves when the container scrolls. */
  columns: Rect;
  dayCount: number;
  direction: Direction;
  slotHeight: number;
}

export interface SlotHit {
  /** 0 = first trip day (inline-start column). */
  dayIndex: number;
  /** 0 = 00:00. Already clamped so the whole block stays within the day. */
  slot: number;
}

export function contains(rect: Rect, p: Point): boolean {
  return p.x >= rect.left && p.x < rect.right && p.y >= rect.top && p.y < rect.bottom;
}

/**
 * Which day column and snapped slot a dragged block would occupy (FR-5.3).
 * `grabOffsetY` is the distance from the block's top edge to the pointer, so the block's top — not
 * the pointer — snaps to the nearest slot, as in the prototype. Returns `null` when the pointer is
 * outside the visible drop area or outside every column.
 */
export function hitTestSlot(
  m: GridMetrics,
  pointer: Point,
  grabOffsetY: number,
  lengthSlots: number,
): SlotHit | null {
  if (m.dayCount <= 0 || !contains(m.viewport, pointer)) return null;
  const width = m.columns.right - m.columns.left;
  if (width <= 0) return null;
  const columnWidth = width / m.dayCount;
  // Columns run from the inline-start edge: the right edge in RTL.
  const fromStart =
    m.direction === 'rtl' ? m.columns.right - pointer.x : pointer.x - m.columns.left;
  const dayIndex = Math.floor(fromStart / columnWidth);
  if (dayIndex < 0 || dayIndex >= m.dayCount) return null;

  const rawSlot = Math.round((pointer.y - grabOffsetY - m.columns.top) / m.slotHeight);
  const maxSlot = Math.max(0, SLOTS_PER_DAY - Math.max(1, lengthSlots));
  const slot = Math.min(maxSlot, Math.max(0, rawSlot));
  return { dayIndex, slot };
}

export interface AutoScrollOptions {
  /** Distance from an edge (px) where scrolling starts. */
  edge?: number;
  /** Speed (px per frame) right at the edge. */
  maxSpeed?: number;
  /** How far outside the area (px) the pointer may be and still scroll (prototype: 20). */
  overshoot?: number;
}

/**
 * Auto-scroll step for one animation frame (FR-5.4), in physical pixels for `Element.scrollBy`.
 * Speed grows linearly as the pointer approaches an edge of `area`. Because `scrollBy` is physical
 * in every browser, the same code works in RTL (moving left = later days) and LTR.
 */
export function autoScrollStep(
  area: Rect,
  pointer: Point,
  { edge = 56, maxSpeed = 18, overshoot = 24 }: AutoScrollOptions = {},
): { dx: number; dy: number } {
  const insideX = pointer.x > area.left - overshoot && pointer.x < area.right + overshoot;
  const insideY = pointer.y > area.top - overshoot && pointer.y < area.bottom + overshoot;
  if (!insideX || !insideY) return { dx: 0, dy: 0 };
  const speed = (distance: number) =>
    Math.round(maxSpeed * Math.min(1, Math.max(0, (edge - distance) / edge)));
  const dy = -speed(pointer.y - area.top) + speed(area.bottom - pointer.y);
  const dx = -speed(pointer.x - area.left) + speed(area.right - pointer.x);
  return { dx, dy };
}

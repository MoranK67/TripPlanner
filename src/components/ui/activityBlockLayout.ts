import { createContext, useContext } from 'react';
import { SLOT_MINUTES } from '@/domain';

/**
 * Pixel height of one slot (half an hour). The **same scale** is used in the bank and the
 * timetable (FR-3.3), so the timetable rows must use this constant too. Prototype: `H = 28`.
 */
export const SLOT_HEIGHT_PX = 28;

/**
 * Slot height for every ActivityBlock below it that does not pass `slotHeight` itself. The phone
 * planner (PHONE-2) provides a denser scale, so the bank sheet and the one-day timetable still
 * share one scale (FR-3.3). Defaults to `SLOT_HEIGHT_PX`.
 */
export const SlotHeightContext = createContext<number>(SLOT_HEIGHT_PX);

/** The slot height in effect here (see `SlotHeightContext`). */
export function useSlotHeight(): number {
  return useContext(SlotHeightContext);
}

/** Vertical gap left under a block so stacked / adjacent blocks don't touch (prototype: 3 px). */
export const BLOCK_GAP_PX = 3;

/** Number of slots an activity covers (at least one). */
export function blockSlots(durationMinutes: number): number {
  return Math.max(1, Math.ceil(durationMinutes / SLOT_MINUTES));
}

/** Rendered height of an activity block: proportional to its duration (FR-3.3). */
export function activityBlockHeight(
  durationMinutes: number,
  slotHeight: number = SLOT_HEIGHT_PX,
): number {
  return blockSlots(durationMinutes) * slotHeight - BLOCK_GAP_PX;
}

/**
 * Blocks use the single-line "short" layout (name and time side by side) when they are one slot
 * long, or when the stacked layout would not fit one name line above the meta line (a one-hour
 * block at the phone's denser scale, PHONE-2). At the default scale that is one slot only.
 */
export function isShortBlock(
  durationMinutes: number,
  slotHeight: number = SLOT_HEIGHT_PX,
): boolean {
  if (blockSlots(durationMinutes) === 1) return true;
  const stacked = BLOCK_TEXT_METRICS.chrome + BLOCK_TEXT_METRICS.nameLine + BLOCK_TEXT_METRICS.meta;
  return activityBlockHeight(durationMinutes, slotHeight) < stacked;
}

/**
 * Vertical metrics of the stacked (non-short) layout in ActivityBlock, in px. Keep in sync with
 * its classes: 1 px border top and bottom, `py-1.5`, name `text-[13px] leading-[1.3]`, meta
 * `text-[11.5px] leading-[1.5] mt-px`.
 */
export const BLOCK_TEXT_METRICS = {
  chrome: 2 * 1 + 2 * 6,
  nameLine: 13 * 1.3,
  meta: 11.5 * 1.5 + 1,
} as const;

/**
 * How many lines the name may use in a stacked block so the meta line (duration / time range)
 * below it is never clipped (UX-8). The block height maps to time, so the name gives way: it is
 * clamped with an ellipsis and the block's title keeps the full name. At least one line.
 */
export function nameLineLimit(
  durationMinutes: number,
  slotHeight: number = SLOT_HEIGHT_PX,
): number {
  const free =
    activityBlockHeight(durationMinutes, slotHeight) -
    BLOCK_TEXT_METRICS.chrome -
    BLOCK_TEXT_METRICS.meta;
  return Math.max(1, Math.floor(free / BLOCK_TEXT_METRICS.nameLine));
}

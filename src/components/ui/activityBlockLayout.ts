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

/**
 * Height of the one-row ("short") layout's line in ActivityBlock (`h-[17px] leading-[17px]`, keep
 * in sync): a 13 px name at its 1.3 line height. Items that don't fit wrap onto a second line that
 * this height clips (DES-2), so it must fit inside the smallest short block (one slot on the
 * phone's 22 px scale, minus its 1 px borders).
 */
export const BLOCK_SHORT_ROW_PX = 17;

/** A time range label ("14:30–15:00") split for the one-row layout: start and "–end". */
export interface SplitTimeRange {
  start: string;
  /** The rest of the label, from the dash on ("–15:00"). */
  rest: string;
}

const TIME_RANGE = /^(\d{1,2}:\d{2})([–-]\d{1,2}:\d{2})$/;

/**
 * Splits a placed block's time range so a short block can drop the end time first and the start
 * time next, keeping the room for the name (DES-2). Anything else (a duration, a custom node)
 * returns `null` and is shown or hidden as a whole.
 */
export function splitTimeRange(meta: unknown): SplitTimeRange | null {
  if (typeof meta !== 'string') return null;
  const match = TIME_RANGE.exec(meta.trim());
  if (!match?.[1] || !match[2]) return null;
  return { start: match[1], rest: match[2] };
}

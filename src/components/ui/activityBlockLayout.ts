import { SLOT_MINUTES } from '@/domain';

/**
 * Pixel height of one slot (half an hour). The **same scale** is used in the bank and the
 * timetable (FR-3.3), so the timetable rows must use this constant too. Prototype: `H = 28`.
 */
export const SLOT_HEIGHT_PX = 28;

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

/** One-slot blocks use the single-line "short" layout (name and time side by side). */
export function isShortBlock(durationMinutes: number): boolean {
  return blockSlots(durationMinutes) === 1;
}

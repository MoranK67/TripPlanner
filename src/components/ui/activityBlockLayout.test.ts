import { SLOT_MINUTES } from '@/domain';
import {
  activityBlockHeight,
  BLOCK_GAP_PX,
  blockSlots,
  isShortBlock,
  SLOT_HEIGHT_PX,
} from './activityBlockLayout';

describe('activity block layout (FR-3.3)', () => {
  it('uses the prototype scale: 28 px per half hour, minus a 3 px gap', () => {
    expect(SLOT_HEIGHT_PX).toBe(28);
    expect(activityBlockHeight(30)).toBe(25);
    expect(activityBlockHeight(90)).toBe(81);
    expect(activityBlockHeight(1440)).toBe(48 * 28 - 3);
  });

  it('is proportional to duration', () => {
    const one = activityBlockHeight(SLOT_MINUTES) + BLOCK_GAP_PX;
    expect(activityBlockHeight(4 * SLOT_MINUTES) + BLOCK_GAP_PX).toBe(4 * one);
  });

  it('accepts a custom slot height', () => {
    expect(activityBlockHeight(60, 40)).toBe(77);
  });

  it('never goes below one slot', () => {
    expect(blockSlots(0)).toBe(1);
    expect(blockSlots(-30)).toBe(1);
    expect(blockSlots(45)).toBe(2);
  });

  it('marks one-slot blocks as short', () => {
    expect(isShortBlock(30)).toBe(true);
    expect(isShortBlock(60)).toBe(false);
  });
});

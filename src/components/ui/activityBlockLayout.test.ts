import { SLOT_MINUTES } from '@/domain';
import {
  activityBlockHeight,
  BLOCK_GAP_PX,
  BLOCK_TEXT_METRICS,
  blockSlots,
  isShortBlock,
  nameLineLimit,
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

describe('name line limit (UX-8)', () => {
  it('gives a one-hour block a single name line, more as the block grows', () => {
    expect(nameLineLimit(60)).toBe(1);
    expect(nameLineLimit(90)).toBe(2);
    expect(nameLineLimit(120)).toBe(4);
    expect(nameLineLimit(60, 40)).toBe(2);
  });

  it('always leaves room for the meta line under the name', () => {
    for (let minutes = 2 * SLOT_MINUTES; minutes <= 1440; minutes += SLOT_MINUTES) {
      const used =
        BLOCK_TEXT_METRICS.chrome +
        nameLineLimit(minutes) * BLOCK_TEXT_METRICS.nameLine +
        BLOCK_TEXT_METRICS.meta;
      expect(used).toBeLessThanOrEqual(activityBlockHeight(minutes));
    }
  });

  it('never drops below one line', () => {
    expect(nameLineLimit(60, 10)).toBe(1);
  });
});

import { SLOT_MINUTES } from '@/domain';
import {
  activityBlockHeight,
  BLOCK_GAP_PX,
  BLOCK_SHORT_ROW_PX,
  BLOCK_TEXT_METRICS,
  blockSlots,
  isShortBlock,
  nameLineLimit,
  SLOT_HEIGHT_PX,
  splitTimeRange,
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

  it('at a denser scale also uses the short layout when name and meta would not stack (PHONE-2)', () => {
    expect(isShortBlock(60, 22)).toBe(true); // 41 px: one row, name and time side by side
    expect(isShortBlock(90, 22)).toBe(false); // 63 px: one name line above the time
    expect(isShortBlock(60, 28)).toBe(false);
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

describe('short blocks: the name wins (DES-2)', () => {
  it('fits the one-row line in every short block, down to the phone scale', () => {
    for (const slotHeight of [28, 22]) {
      for (let minutes = SLOT_MINUTES; minutes <= 1440; minutes += SLOT_MINUTES) {
        if (!isShortBlock(minutes, slotHeight)) continue;
        expect(BLOCK_SHORT_ROW_PX).toBeLessThanOrEqual(
          activityBlockHeight(minutes, slotHeight) - 2,
        );
      }
    }
    // The line itself: the 13 px name at its 1.3 line height.
    expect(BLOCK_SHORT_ROW_PX).toBeGreaterThanOrEqual(BLOCK_TEXT_METRICS.nameLine);
  });

  it('splits a time range into the start and the rest, so the end gives way first', () => {
    expect(splitTimeRange('14:30–15:00')).toEqual({ start: '14:30', rest: '–15:00' });
    expect(splitTimeRange('9:00-10:30')).toEqual({ start: '9:00', rest: '-10:30' });
  });

  it('leaves anything else whole', () => {
    expect(splitTimeRange('חצי שעה')).toBeNull();
    expect(splitTimeRange('14:30')).toBeNull();
    expect(splitTimeRange(undefined)).toBeNull();
    expect(splitTimeRange(1430)).toBeNull();
  });
});

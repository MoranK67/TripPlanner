import { MINUTES_PER_DAY, PALETTE, SLOT_MINUTES, SLOTS_PER_DAY } from './constants';

describe('domain constants', () => {
  it('has 48 half-hour slots per day', () => {
    expect(SLOT_MINUTES).toBe(30);
    expect(SLOTS_PER_DAY).toBe(48);
    expect(SLOTS_PER_DAY * SLOT_MINUTES).toBe(MINUTES_PER_DAY);
  });

  it('has a palette of 10 distinct hex colors', () => {
    expect(PALETTE).toHaveLength(10);
    expect(new Set(PALETTE).size).toBe(10);
    for (const color of PALETTE) expect(color).toMatch(/^#[0-9A-F]{6}$/);
  });
});

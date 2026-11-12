import {
  HEX_COLOR_PATTERN,
  ISO_DATE_PATTERN,
  MAX_ACTIVITY_MINUTES,
  MAX_END_MINUTE,
  MAX_START_MINUTE,
  MAX_TRIP_DAY_SPAN,
  MAX_TRIP_DAYS,
  MIN_ACTIVITY_MINUTES,
  MIN_END_MINUTE,
  MINUTES_PER_DAY,
  PALETTE,
  PALETTE_SIZE,
  SLOT_MINUTES,
  SLOTS_PER_DAY,
} from './constants';

describe('domain constants', () => {
  it('has 48 half-hour slots per day', () => {
    expect(SLOT_MINUTES).toBe(30);
    expect(SLOTS_PER_DAY).toBe(48);
    expect(SLOTS_PER_DAY * SLOT_MINUTES).toBe(MINUTES_PER_DAY);
  });

  it('mirrors the DB minute ranges (PROJECT_PLAN §6.2)', () => {
    expect(MAX_START_MINUTE).toBe(1410);
    expect(MIN_END_MINUTE).toBe(30);
    expect(MAX_END_MINUTE).toBe(1440);
    expect(MIN_ACTIVITY_MINUTES).toBe(30);
    expect(MAX_ACTIVITY_MINUTES).toBe(1440);
  });

  it('allows at most 90 trip days (end_date - start_date <= 89)', () => {
    expect(MAX_TRIP_DAYS).toBe(90);
    expect(MAX_TRIP_DAY_SPAN).toBe(89);
  });

  it('has a palette of 10 distinct upper-case hex colors matching the prototype order', () => {
    expect(PALETTE).toHaveLength(10);
    expect(PALETTE_SIZE).toBe(10);
    expect(new Set(PALETTE).size).toBe(10);
    for (const color of PALETTE) {
      expect(color).toMatch(/^#[0-9A-F]{6}$/);
      expect(color).toMatch(HEX_COLOR_PATTERN);
    }
    expect(PALETTE[0]).toBe('#FFD6E0');
    expect(PALETTE[9]).toBe('#E6E1DA');
  });

  it('has a date pattern for YYYY-MM-DD', () => {
    expect('2026-11-12').toMatch(ISO_DATE_PATTERN);
    expect('2026-1-12').not.toMatch(ISO_DATE_PATTERN);
  });
});

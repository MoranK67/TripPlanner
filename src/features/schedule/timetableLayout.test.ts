import { dayBounds, type TripWindow } from '@/domain';
import {
  blockTop,
  DAY_PX,
  dayPx,
  disabledSpans,
  GRID_METRICS,
  initialScrollTop,
  minuteToPx,
  PHONE_METRICS,
  slotAtScrollTop,
  timeRangeLabel,
} from './timetableLayout';

const window: TripWindow = {
  startDate: '2026-12-01',
  startMinute: 14 * 60,
  endDate: '2026-12-03',
  endMinute: 11 * 60,
};

describe('timetable layout', () => {
  it('uses 28 px per half hour (DEC-018)', () => {
    expect(DAY_PX).toBe(48 * 28);
    expect(minuteToPx(90)).toBe(84);
    expect(blockTop(9 * 60)).toBe(18 * 28 + 1);
  });

  it('labels a block ending at midnight as 24:00', () => {
    expect(timeRangeLabel(23 * 60, 60)).toBe('23:00–24:00');
    expect(timeRangeLabel(0, 1440)).toBe('00:00–24:00');
  });

  it('disables slots before the start on day 1 and after the end on the last day', () => {
    expect(disabledSpans(dayBounds(window, '2026-12-01'))).toEqual([{ top: 0, height: 28 * 28 }]);
    expect(disabledSpans(dayBounds(window, '2026-12-02'))).toEqual([]);
    expect(disabledSpans(dayBounds(window, '2026-12-03'))).toEqual([
      { top: 22 * 28, height: DAY_PX - 22 * 28 },
    ]);
  });

  it('disables both ends of a one-day trip and nothing for 00:00–24:00', () => {
    expect(disabledSpans({ startMinute: 600, endMinute: 1200 })).toEqual([
      { top: 0, height: 20 * 28 },
      { top: 40 * 28, height: 8 * 28 },
    ]);
    expect(disabledSpans({ startMinute: 0, endMinute: 1440 })).toEqual([]);
    expect(disabledSpans(null)).toEqual([{ top: 0, height: DAY_PX }]);
  });

  it('opens one slot above the trip start, or at 08:00 for a midnight start', () => {
    expect(initialScrollTop(window)).toBe(27 * 28);
    expect(initialScrollTop({ ...window, startMinute: 0 })).toBe(15 * 28);
    expect(initialScrollTop({ ...window, startMinute: 30 })).toBe(0);
  });
});

describe('timetable layout at the phone scale (PHONE-2)', () => {
  const sh = PHONE_METRICS.slotHeight;

  it('is denser than the 28 px grid and fits a working day on a phone', () => {
    expect(GRID_METRICS).toEqual({ slotHeight: 28, headerPx: 56 });
    expect(sh).toBeLessThan(28);
    expect(sh).toBeGreaterThanOrEqual(20);
    // 390 × 664 minus the slim app header, page padding, the day row and the bank handle leaves
    // about 450 px for the rows: at least 8 hours (16 rows).
    expect(Math.floor(450 / (2 * sh))).toBeGreaterThanOrEqual(8);
  });

  it('threads the slot height through every position', () => {
    expect(dayPx(sh)).toBe(48 * sh);
    expect(dayPx()).toBe(DAY_PX);
    expect(minuteToPx(90, sh)).toBe(3 * sh);
    expect(blockTop(9 * 60, sh)).toBe(18 * sh + 1);
    expect(initialScrollTop(window, sh)).toBe(27 * sh);
    expect(initialScrollTop({ ...window, startMinute: 0 }, sh)).toBe(15 * sh);
    expect(disabledSpans(dayBounds(window, '2026-12-01'), sh)).toEqual([
      { top: 0, height: 28 * sh },
    ]);
    expect(disabledSpans(dayBounds(window, '2026-12-03'), sh)).toEqual([
      { top: 22 * sh, height: 48 * sh - 22 * sh },
    ]);
    expect(disabledSpans(null, sh)).toEqual([{ top: 0, height: 48 * sh }]);
  });

  it('finds the first row in view from the scroll offset', () => {
    expect(slotAtScrollTop(0, sh)).toBe(0);
    expect(slotAtScrollTop(10 * sh, sh)).toBe(10);
    expect(slotAtScrollTop(10 * sh + 1, sh)).toBe(11);
    expect(slotAtScrollTop(10 * 28)).toBe(10);
  });
});

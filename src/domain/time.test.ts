import { MAX_TRIP_DAYS, SLOTS_PER_DAY } from './constants';
import {
  addDays,
  compareDates,
  dayBounds,
  daySlotStarts,
  daysBetween,
  formatDurationHe,
  formatLongDate,
  formatShortDate,
  formatWeekday,
  fromEpochDay,
  isDateInTrip,
  localIsoDate,
  minuteLabel,
  parseClockTime,
  slotIndex,
  slotStartMinute,
  toEpochDay,
  tripDayCount,
  tripDays,
  weekdayIndex,
} from './time';
import type { TripWindow } from './types';

function trip(
  startDate: string,
  startMinute: number,
  endDate: string,
  endMinute: number,
): TripWindow {
  return { startDate, startMinute, endDate, endMinute };
}

describe('minuteLabel', () => {
  it.each([
    [0, '00:00'],
    [30, '00:30'],
    [570, '09:30'],
    [600, '10:00'],
    [1410, '23:30'],
    [1440, '24:00'],
    [15, '00:15'],
    [-30, '00:00'],
    [2000, '24:00'],
  ])('minuteLabel(%s) = %s', (minute, label) => {
    expect(minuteLabel(minute)).toBe(label);
  });
});

describe('slots', () => {
  it('converts between minutes and slot indexes', () => {
    expect(slotIndex(0)).toBe(0);
    expect(slotIndex(29)).toBe(0);
    expect(slotIndex(30)).toBe(1);
    expect(slotIndex(1410)).toBe(47);
    expect(slotStartMinute(0)).toBe(0);
    expect(slotStartMinute(47)).toBe(1410);
  });

  it('lists 48 row starts from 00:00 to 23:30', () => {
    const starts = daySlotStarts();
    expect(starts).toHaveLength(SLOTS_PER_DAY);
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBe(30);
    expect(starts.at(-1)).toBe(1410);
  });
});

describe('calendar math', () => {
  it('round-trips epoch days', () => {
    expect(toEpochDay('1970-01-01')).toBe(0);
    expect(toEpochDay('1970-01-02')).toBe(1);
    expect(toEpochDay('1969-12-31')).toBe(-1);
    expect(fromEpochDay(0)).toBe('1970-01-01');
    for (const date of ['2026-11-12', '2028-02-29', '2000-01-01', '0050-06-15', '9999-12-31']) {
      expect(fromEpochDay(toEpochDay(date))).toBe(date);
    }
  });

  it('returns NaN for malformed dates', () => {
    expect(toEpochDay('2026-1-1')).toBeNaN();
    expect(toEpochDay('')).toBeNaN();
  });

  it('adds days across month, year and leap-day boundaries', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2026-11-12', 0)).toBe('2026-11-12');
  });

  it('counts days between dates like Postgres date subtraction', () => {
    expect(daysBetween('2026-11-12', '2026-11-12')).toBe(0);
    expect(daysBetween('2026-11-12', '2026-11-15')).toBe(3);
    expect(daysBetween('2026-11-15', '2026-11-12')).toBe(-3);
    expect(daysBetween('2028-02-01', '2028-03-01')).toBe(29);
    expect(daysBetween('2027-02-01', '2027-03-01')).toBe(28);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });

  describe('in a time zone with DST', () => {
    const originalTz = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = 'Asia/Jerusalem';
    });
    afterAll(() => {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });

    it('really has DST (sanity check that TZ is applied)', () => {
      const winter = new Date(2027, 0, 15).getTimezoneOffset();
      const summer = new Date(2027, 6, 15).getTimezoneOffset();
      expect(winter).not.toBe(summer);
    });

    it('formats local dates across the clock change', () => {
      // Israel moves clocks forward on 2027-03-26 and back on 2026-10-25.
      expect(localIsoDate(new Date(2027, 2, 26, 1, 30))).toBe('2027-03-26');
      expect(localIsoDate(new Date(2026, 9, 25, 23, 59))).toBe('2026-10-25');
    });

    it('is unaffected by DST transitions', () => {
      // Israel and the EU change clocks in late March / October.
      expect(daysBetween('2027-03-20', '2027-04-05')).toBe(16);
      expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    });
  });

  it('throws on malformed input to fromEpochDay / addDays (documented)', () => {
    expect(() => fromEpochDay(Number.NaN)).toThrow(RangeError);
    expect(() => addDays('bad', 1)).toThrow(RangeError);
  });

  it('compares dates', () => {
    expect(compareDates('2026-11-12', '2026-11-13')).toBeLessThan(0);
    expect(compareDates('2026-11-13', '2026-11-12')).toBeGreaterThan(0);
    expect(compareDates('2026-11-12', '2026-11-12')).toBe(0);
    expect(['2027-01-01', '2026-12-31', '2026-02-01'].sort(compareDates)).toEqual([
      '2026-02-01',
      '2026-12-31',
      '2027-01-01',
    ]);
  });

  it('formats the local calendar date of a Date', () => {
    expect(localIsoDate(new Date(2026, 10, 12, 23, 59))).toBe('2026-11-12');
    expect(localIsoDate(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});

describe('tripDays / tripDayCount', () => {
  it('lists every day of a multi-day trip', () => {
    const w = trip('2026-11-12', 600, '2026-11-15', 1200);
    expect(tripDays(w)).toEqual(['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
    expect(tripDayCount(w)).toBe(4);
  });

  it('has one day for a single-day trip', () => {
    const w = trip('2026-11-12', 600, '2026-11-12', 1200);
    expect(tripDays(w)).toEqual(['2026-11-12']);
    expect(tripDayCount(w)).toBe(1);
  });

  it('adds no "next day" column for a trip ending at 24:00', () => {
    const w = trip('2026-11-12', 0, '2026-11-13', 1440);
    expect(tripDays(w)).toEqual(['2026-11-12', '2026-11-13']);
  });

  it('crosses a leap day', () => {
    expect(tripDays(trip('2028-02-27', 0, '2028-03-01', 1440))).toEqual([
      '2028-02-27',
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
    expect(tripDays(trip('2027-02-27', 0, '2027-03-01', 1440))).toEqual([
      '2027-02-27',
      '2027-02-28',
      '2027-03-01',
    ]);
  });

  it('crosses month and year boundaries', () => {
    expect(tripDays(trip('2026-12-30', 0, '2027-01-02', 1440))).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });

  it('handles a 90-day trip', () => {
    const w = trip('2026-12-01', 0, addDays('2026-12-01', 89), 1440);
    const days = tripDays(w);
    expect(days).toHaveLength(MAX_TRIP_DAYS);
    expect(days[0]).toBe('2026-12-01');
    expect(days.at(-1)).toBe('2027-02-28');
    expect(new Set(days).size).toBe(MAX_TRIP_DAYS);
  });

  it('is empty when the end is before the start or dates are malformed', () => {
    expect(tripDays(trip('2026-11-15', 0, '2026-11-12', 1440))).toEqual([]);
    expect(tripDayCount(trip('2026-11-15', 0, '2026-11-12', 1440))).toBe(0);
    expect(tripDays(trip('bad', 0, '2026-11-12', 1440))).toEqual([]);
  });
});

describe('dayBounds', () => {
  const w = trip('2026-11-12', 600, '2026-11-14', 1200);

  it('starts the first day at the trip start and ends the last day at the trip end', () => {
    expect(dayBounds(w, '2026-11-12')).toEqual({ startMinute: 600, endMinute: 1440 });
    expect(dayBounds(w, '2026-11-13')).toEqual({ startMinute: 0, endMinute: 1440 });
    expect(dayBounds(w, '2026-11-14')).toEqual({ startMinute: 0, endMinute: 1200 });
  });

  it('uses both bounds on a single-day trip', () => {
    expect(dayBounds(trip('2026-11-12', 540, '2026-11-12', 1080), '2026-11-12')).toEqual({
      startMinute: 540,
      endMinute: 1080,
    });
  });

  it('enables the whole last day when the trip ends at 24:00', () => {
    expect(dayBounds(trip('2026-11-12', 600, '2026-11-13', 1440), '2026-11-13')).toEqual({
      startMinute: 0,
      endMinute: 1440,
    });
  });

  it('returns null outside the trip', () => {
    expect(dayBounds(w, '2026-11-11')).toBeNull();
    expect(dayBounds(w, '2026-11-15')).toBeNull();
    expect(isDateInTrip(w, '2026-11-11')).toBe(false);
    expect(isDateInTrip(w, '2026-11-12')).toBe(true);
    expect(isDateInTrip(w, '2026-11-14')).toBe(true);
  });
});

describe('date formatting', () => {
  it('returns the weekday index (0 = Sunday)', () => {
    expect(weekdayIndex('2026-11-08')).toBe(0);
    expect(weekdayIndex('2026-11-12')).toBe(4);
    expect(weekdayIndex('2026-11-14')).toBe(6);
    expect(weekdayIndex('2028-02-29')).toBe(2);
  });

  it.each([
    ['2026-11-08', 'יום ראשון'],
    ['2026-11-09', 'יום שני'],
    ['2026-11-12', 'יום חמישי'],
    ['2026-11-13', 'יום שישי'],
    ['2026-11-14', 'יום שבת'],
  ])('formats %s as %s in Hebrew', (date, name) => {
    expect(formatWeekday(date)).toBe(name);
  });

  it('accepts another locale', () => {
    expect(formatWeekday('2026-11-12', 'en-US')).toBe('Thursday');
  });

  it('formats short dates like the prototype (D.M)', () => {
    expect(formatShortDate('2026-11-05')).toBe('5.11');
    expect(formatShortDate('2026-01-31')).toBe('31.1');
  });

  it('formats long Hebrew dates', () => {
    expect(formatLongDate('2026-11-12')).toBe('12 בנובמבר 2026');
    expect(formatLongDate('2028-02-29', 'en-US')).toBe('February 29, 2028');
  });
});

describe('formatDurationHe', () => {
  it.each([
    [30, 'חצי שעה'],
    [60, 'שעה'],
    [90, 'שעה וחצי'],
    [120, 'שעתיים'],
    [150, 'שעתיים וחצי'],
    [180, '3 שעות'],
    [210, '3 שעות וחצי'],
    [690, '11 שעות וחצי'],
    [1440, '24 שעות'],
  ])('formats %s minutes as %s (prototype wording)', (minutes, label) => {
    expect(formatDurationHe(minutes)).toBe(label);
  });

  it.each([
    [0, '0 דקות'],
    [1, 'דקה אחת'],
    [45, '45 דקות'],
    [75, 'שעה ו-15 דקות'],
    [121, 'שעתיים ו-דקה אחת'],
    [-10, '0 דקות'],
    [Number.NaN, '0 דקות'],
  ])('falls back to minutes for off-grid value %s', (minutes, label) => {
    expect(formatDurationHe(minutes)).toBe(label);
  });
});

describe('parseClockTime', () => {
  it.each([
    ['09:30', 570, false],
    ['9:30', 570, false],
    ['0930', 570, false],
    ['930', 570, false],
    ['9', 540, false],
    ['  14:00 ', 840, false],
    ['09:30:00', 570, false],
    ['00:00', 0, false],
    ['23:30', 1410, false],
    ['09:14', 540, true],
    ['09:15', 570, true],
    ['09:45', 600, true],
    ['09:29:59', 570, true],
  ])('%s → %i (rounded: %s)', (text, minute, rounded) => {
    expect(parseClockTime(text)).toEqual({ minute, rounded });
  });

  it.each(['', ' ', '09:60', '09:00:60', '24:00', '23:45', '2500', '09300', '9.30', '9am', 'x'])(
    'rejects %j',
    (text) => {
      expect(parseClockTime(text)).toBeNull();
    },
  );
});

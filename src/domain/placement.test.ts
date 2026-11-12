import { PALETTE } from './constants';
import {
  activitiesOutsideWindow,
  canPlace,
  findOverlaps,
  fitsDay,
  isValidTripWindow,
  rangesOverlap,
  validateTripWindow,
  type PlacementContext,
} from './placement';
import { addDays } from './time';
import type { Activity, TripWindow } from './types';

const W: TripWindow = {
  startDate: '2026-11-12',
  startMinute: 600, // 10:00
  endDate: '2026-11-14',
  endMinute: 1200, // 20:00
};

let nextId = 0;
function activity(
  durationMinutes: number,
  placement: Activity['placement'] = null,
  overrides: Partial<Activity> = {},
): Activity {
  nextId += 1;
  return {
    id: `a${nextId}`,
    tripId: 't1',
    name: `Activity ${nextId}`,
    durationMinutes,
    color: PALETTE[0],
    placement,
    bankPosition: nextId,
    ...overrides,
  };
}

describe('rangesOverlap (half-open, like int4range &&)', () => {
  it.each([
    [0, 60, 60, 120, false], // touching end → start
    [60, 120, 0, 60, false],
    [0, 60, 30, 90, true],
    [0, 120, 30, 60, true], // containment
    [30, 60, 0, 120, true],
    [0, 60, 0, 60, true], // identical
    [0, 30, 90, 120, false],
  ])('[%s,%s) vs [%s,%s) → %s', (a, b, c, d, expected) => {
    expect(rangesOverlap(a, b, c, d)).toBe(expected);
  });
});

describe('fitsDay', () => {
  it('respects the first-day start bound', () => {
    expect(fitsDay(W, { date: '2026-11-12', startMinute: 600 }, 60)).toBe(true);
    expect(fitsDay(W, { date: '2026-11-12', startMinute: 570 }, 60)).toBe(false);
    expect(fitsDay(W, { date: '2026-11-12', startMinute: 1380 }, 60)).toBe(true); // ends 24:00
  });

  it('respects the last-day end bound (end may touch it)', () => {
    expect(fitsDay(W, { date: '2026-11-14', startMinute: 1140 }, 60)).toBe(true); // 19:00–20:00
    expect(fitsDay(W, { date: '2026-11-14', startMinute: 1170 }, 60)).toBe(false);
    expect(fitsDay(W, { date: '2026-11-14', startMinute: 0 }, 30)).toBe(true);
  });

  it('allows the whole middle day', () => {
    expect(fitsDay(W, { date: '2026-11-13', startMinute: 0 }, 30)).toBe(true);
    expect(fitsDay(W, { date: '2026-11-13', startMinute: 1410 }, 30)).toBe(true);
  });

  it('never crosses midnight (FR-4.6)', () => {
    expect(fitsDay(W, { date: '2026-11-13', startMinute: 1410 }, 60)).toBe(false);
    expect(fitsDay(W, { date: '2026-11-13', startMinute: 1380 }, 90)).toBe(false);
  });

  it('rejects dates outside the trip', () => {
    expect(fitsDay(W, { date: '2026-11-11', startMinute: 600 }, 60)).toBe(false);
    expect(fitsDay(W, { date: '2026-11-15', startMinute: 600 }, 60)).toBe(false);
  });

  it('only fits a single-day trip between its start and end', () => {
    const day: TripWindow = { ...W, endDate: W.startDate, endMinute: 720 }; // 10:00–12:00
    expect(fitsDay(day, { date: '2026-11-12', startMinute: 600 }, 120)).toBe(true);
    expect(fitsDay(day, { date: '2026-11-12', startMinute: 630 }, 120)).toBe(false);
    expect(fitsDay(day, { date: '2026-11-12', startMinute: 570 }, 30)).toBe(false);
    expect(fitsDay(day, { date: '2026-11-12', startMinute: 690 }, 30)).toBe(true);
    expect(fitsDay(day, { date: '2026-11-12', startMinute: 720 }, 30)).toBe(false);
  });

  it('fits the whole last day when the trip ends at 24:00', () => {
    const w: TripWindow = { ...W, endMinute: 1440 };
    expect(fitsDay(w, { date: '2026-11-14', startMinute: 1410 }, 30)).toBe(true);
    expect(fitsDay(w, { date: '2026-11-15', startMinute: 0 }, 30)).toBe(false);
  });

  it('places a 24-hour activity only on a full day starting at 00:00', () => {
    expect(fitsDay(W, { date: '2026-11-13', startMinute: 0 }, 1440)).toBe(true);
    expect(fitsDay(W, { date: '2026-11-13', startMinute: 30 }, 1440)).toBe(false);
    expect(fitsDay(W, { date: '2026-11-12', startMinute: 600 }, 1440)).toBe(false); // first day
    expect(fitsDay(W, { date: '2026-11-14', startMinute: 0 }, 1440)).toBe(false); // last day
    const fullDay: TripWindow = {
      startDate: '2026-11-12',
      startMinute: 0,
      endDate: '2026-11-12',
      endMinute: 1440,
    };
    expect(fitsDay(fullDay, { date: '2026-11-12', startMinute: 0 }, 1440)).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(fitsDay(W, { date: '2026-11-13', startMinute: 615 }, 60)).toBe(false);
    expect(fitsDay(W, { date: '2026-11-13', startMinute: -30 }, 60)).toBe(false);
    expect(fitsDay(W, { date: '2026-11-13', startMinute: 1440 }, 30)).toBe(false);
    expect(fitsDay(W, { date: '2026-11-13', startMinute: 600 }, 45)).toBe(false);
    expect(fitsDay(W, { date: '2026-11-13', startMinute: 600 }, 0)).toBe(false);
    expect(fitsDay(W, { date: '2026-11-13', startMinute: 0 }, 1470)).toBe(false);
    expect(fitsDay(W, { date: '2026-13-01', startMinute: 600 }, 60)).toBe(false);
  });
});

describe('findOverlaps', () => {
  it('finds activities on the same date whose ranges overlap', () => {
    const a = activity(120, { date: '2026-11-13', startMinute: 600 }); // 10–12
    const b = activity(60, { date: '2026-11-13', startMinute: 780 }); // 13–14
    const c = activity(60, { date: '2026-11-14', startMinute: 600 }); // other day
    const bank = activity(60);
    const subject = activity(120);
    const all = [a, b, c, bank, subject];
    expect(findOverlaps(all, subject, { date: '2026-11-13', startMinute: 660 })).toEqual([a]);
    expect(findOverlaps(all, subject, { date: '2026-11-13', startMinute: 690 })).toEqual([a, b]);
    expect(findOverlaps(all, subject, { date: '2026-11-13', startMinute: 1080 })).toEqual([]);
  });

  it('allows an activity ending exactly where another starts (half-open)', () => {
    const a = activity(60, { date: '2026-11-13', startMinute: 600 }); // 10–11
    const subject = activity(60);
    expect(findOverlaps([a, subject], subject, { date: '2026-11-13', startMinute: 660 })).toEqual(
      [],
    );
    expect(findOverlaps([a, subject], subject, { date: '2026-11-13', startMinute: 540 })).toEqual(
      [],
    );
  });

  it('ignores the subject itself (moving within its own range)', () => {
    const moving = activity(120, { date: '2026-11-13', startMinute: 600 });
    expect(findOverlaps([moving], moving, { date: '2026-11-13', startMinute: 630 })).toEqual([]);
  });

  it('ignores activities of other trips (constraint is per trip)', () => {
    const foreign = activity(60, { date: '2026-11-13', startMinute: 600 }, { tripId: 't2' });
    const subject = activity(60);
    expect(findOverlaps([foreign], subject, { date: '2026-11-13', startMinute: 600 })).toEqual([]);
  });
});

describe('canPlace', () => {
  const placed = activity(120, { date: '2026-11-13', startMinute: 600 }); // 10–12
  const subject = activity(60);
  const ctx: PlacementContext = { window: W, activities: [placed, subject] };

  it('accepts a free slot inside the window', () => {
    expect(canPlace(ctx, subject, { date: '2026-11-13', startMinute: 720 })).toEqual({ ok: true });
    expect(canPlace(ctx, subject, { date: '2026-11-13', startMinute: 540 })).toEqual({ ok: true });
  });

  it('reports overlaps with the conflicting activities', () => {
    expect(canPlace(ctx, subject, { date: '2026-11-13', startMinute: 660 })).toEqual({
      ok: false,
      reason: 'conflict_overlap',
      conflicts: [placed],
    });
  });

  it('reports out_of_range before overlap', () => {
    expect(canPlace(ctx, subject, { date: '2026-11-12', startMinute: 540 })).toEqual({
      ok: false,
      reason: 'out_of_range',
    });
    expect(canPlace(ctx, subject, { date: '2026-11-15', startMinute: 600 })).toEqual({
      ok: false,
      reason: 'out_of_range',
    });
    expect(
      canPlace(ctx, { ...subject, durationMinutes: 90 }, { date: '2026-11-13', startMinute: 1380 }),
    ).toEqual({
      ok: false,
      reason: 'out_of_range',
    });
  });

  it('reports validation for malformed input', () => {
    expect(canPlace(ctx, subject, { date: '2026-11-13', startMinute: 610 })).toEqual({
      ok: false,
      reason: 'validation',
    });
    expect(
      canPlace(ctx, { ...subject, durationMinutes: 0 }, { date: '2026-11-13', startMinute: 600 }),
    ).toEqual({
      ok: false,
      reason: 'validation',
    });
    expect(canPlace(ctx, subject, { date: 'not-a-date', startMinute: 600 })).toEqual({
      ok: false,
      reason: 'validation',
    });
  });

  it('detects an edited duration that runs into a neighbor (FR-3.6)', () => {
    const first = activity(60, { date: '2026-11-13', startMinute: 600 }); // 10–11
    const next = activity(60, { date: '2026-11-13', startMinute: 660 }); // 11–12
    const context: PlacementContext = { window: W, activities: [first, next] };
    expect(canPlace(context, first, first.placement!)).toEqual({ ok: true });
    const longer = { ...first, durationMinutes: 90 };
    const check = canPlace(context, longer, first.placement!);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('conflict_overlap');
  });

  it('detects an edited duration that runs past midnight (FR-3.6)', () => {
    const late = activity(60, { date: '2026-11-13', startMinute: 1350 });
    const context: PlacementContext = { window: W, activities: [late] };
    expect(canPlace(context, late, late.placement!).ok).toBe(true);
    expect(canPlace(context, { ...late, durationMinutes: 120 }, late.placement!)).toEqual({
      ok: false,
      reason: 'out_of_range',
    });
  });
});

describe('activitiesOutsideWindow', () => {
  it('returns placed activities that no longer fit a shrunk window (FR-2.6)', () => {
    const early = activity(60, { date: '2026-11-12', startMinute: 600 }); // 10–11 day 1
    const middle = activity(60, { date: '2026-11-13', startMinute: 600 });
    const late = activity(120, { date: '2026-11-14', startMinute: 1080 }); // 18–20 last day
    const bank = activity(60);
    const all = [early, middle, late, bank];

    expect(activitiesOutsideWindow(W, all)).toEqual([]);

    const shrunk: TripWindow = { ...W, startMinute: 630, endMinute: 1140 };
    expect(activitiesOutsideWindow(shrunk, all)).toEqual([early, late]);

    const datesShrunk: TripWindow = { ...W, startDate: '2026-11-13', startMinute: 0 };
    expect(activitiesOutsideWindow(datesShrunk, all)).toEqual([early]);

    const singleDay: TripWindow = { ...W, endDate: '2026-11-12', endMinute: 1440 };
    expect(activitiesOutsideWindow(singleDay, all)).toEqual([middle, late]);
  });

  it('keeps an activity ending exactly at the new trip end', () => {
    const late = activity(120, { date: '2026-11-14', startMinute: 1080 }); // ends 20:00
    expect(activitiesOutsideWindow({ ...W, endMinute: 1200 }, [late])).toEqual([]);
    expect(activitiesOutsideWindow({ ...W, endMinute: 1170 }, [late])).toEqual([late]);
  });

  it('never includes bank activities', () => {
    expect(activitiesOutsideWindow(W, [activity(60), activity(1440)])).toEqual([]);
  });
});

describe('validateTripWindow / isValidTripWindow (FR-2.5)', () => {
  it('accepts a normal window', () => {
    expect(validateTripWindow(W)).toBeNull();
    expect(isValidTripWindow(W)).toBe(true);
  });

  it('compares (date, minute): same day needs a later end minute', () => {
    const day = { startDate: '2026-11-12', endDate: '2026-11-12' };
    expect(validateTripWindow({ ...day, startMinute: 600, endMinute: 630 })).toBeNull();
    expect(validateTripWindow({ ...day, startMinute: 600, endMinute: 600 })).toBe(
      'end_not_after_start',
    );
    expect(validateTripWindow({ ...day, startMinute: 600, endMinute: 570 })).toBe(
      'end_not_after_start',
    );
    expect(validateTripWindow({ ...day, startMinute: 0, endMinute: 1440 })).toBeNull();
  });

  it('allows an earlier end minute on a later date', () => {
    expect(
      validateTripWindow({
        startDate: '2026-11-12',
        startMinute: 1410,
        endDate: '2026-11-13',
        endMinute: 30,
      }),
    ).toBeNull();
  });

  it('rejects an end date before the start date', () => {
    expect(validateTripWindow({ ...W, endDate: '2026-11-11', endMinute: 1440 })).toBe(
      'end_not_after_start',
    );
  });

  it('allows at most 90 days (span 89)', () => {
    const start = '2026-12-01';
    expect(validateTripWindow({ ...W, startDate: start, endDate: addDays(start, 89) })).toBeNull();
    expect(validateTripWindow({ ...W, startDate: start, endDate: addDays(start, 90) })).toBe(
      'too_long',
    );
    // Across a leap day: 2028-01-01 + 89 days = 2028-03-30.
    expect(validateTripWindow({ ...W, startDate: '2028-01-01', endDate: '2028-03-30' })).toBeNull();
    expect(validateTripWindow({ ...W, startDate: '2028-01-01', endDate: '2028-03-31' })).toBe(
      'too_long',
    );
  });

  it('checks the minute ranges of FR-2.4', () => {
    expect(validateTripWindow({ ...W, startMinute: 1440 })).toBe('invalid_start_minute');
    expect(validateTripWindow({ ...W, startMinute: 615 })).toBe('invalid_start_minute');
    expect(validateTripWindow({ ...W, startMinute: 1410 })).toBeNull();
    expect(validateTripWindow({ ...W, endMinute: 0 })).toBe('invalid_end_minute');
    expect(validateTripWindow({ ...W, endMinute: 1470 })).toBe('invalid_end_minute');
    expect(validateTripWindow({ ...W, endMinute: 30 })).toBeNull();
  });

  it('checks the dates', () => {
    expect(validateTripWindow({ ...W, startDate: '2026-02-30' })).toBe('invalid_date');
    expect(validateTripWindow({ ...W, endDate: '' })).toBe('invalid_date');
    expect(isValidTripWindow({ ...W, endDate: '' })).toBe(false);
  });
});

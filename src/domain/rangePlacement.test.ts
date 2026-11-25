import { PALETTE } from './constants';
import type { PlacementContext } from './placement';
import {
  activityToDialogPlacement,
  durationToEnd,
  rangeToDuration,
  validateDialogPlacement,
  type DialogPlacement,
} from './rangePlacement';
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

describe('rangeToDuration', () => {
  it.each([
    [600, 660, 30 * 2],
    [600, 630, 30],
    [0, 1440, 1440],
    [1410, 1440, 30],
  ])('[%s, %s) → %s minutes', (start, end, expected) => {
    expect(rangeToDuration(start, end)).toBe(expected);
  });

  it.each([
    [600, 600], // empty
    [660, 600], // reversed
    [600, 615], // off grid
    [615, 675], // off grid, 60 long
    [-30, 1440], // longer than a day
    [Number.NaN, 600],
  ])('[%s, %s) → null', (start, end) => {
    expect(rangeToDuration(start, end)).toBeNull();
  });
});

describe('durationToEnd', () => {
  it('moves To and keeps From', () => {
    expect(durationToEnd(600, 90)).toBe(690);
    expect(durationToEnd(0, 1440)).toBe(1440);
    expect(durationToEnd(1410, 30)).toBe(1440);
  });

  it.each([
    [1410, 60], // past 24:00 (no crossing midnight)
    [600, 0],
    [600, 45], // off grid
    [600, 1470], // too long
    [615, 60], // From off grid
    [1440, 30], // 24:00 is not a start
  ])('From %s + %s minutes → null', (start, duration) => {
    expect(durationToEnd(start, duration)).toBeNull();
  });
});

describe('activityToDialogPlacement', () => {
  it('pre-fills Day / From / To for a placed activity', () => {
    const a = activity(150, { date: '2026-11-13', startMinute: 540 });
    expect(activityToDialogPlacement(a)).toEqual({
      day: '2026-11-13',
      startMinute: 540,
      endMinute: 690,
    });
  });

  it('returns null for a bank activity', () => {
    expect(activityToDialogPlacement(activity(60))).toBeNull();
  });
});

describe('validateDialogPlacement', () => {
  const placed = activity(120, { date: '2026-11-13', startMinute: 600 }); // 10:00–12:00
  const edited = activity(60, { date: '2026-11-13', startMinute: 780 }); // 13:00–14:00
  const otherTrip = activity(240, { date: '2026-11-13', startMinute: 840 }, { tripId: 't2' });
  const banked = activity(60);
  const ctx: PlacementContext = { window: W, activities: [placed, edited, otherTrip, banked] };
  const subject = { id: edited.id, tripId: 't1' };
  const at = (day: string, startMinute: number, endMinute: number): DialogPlacement => ({
    day,
    startMinute,
    endMinute,
  });

  it('accepts a free range and returns the placement and the duration to save', () => {
    expect(validateDialogPlacement(ctx, subject, at('2026-11-13', 720, 810))).toEqual({
      ok: true,
      placement: { date: '2026-11-13', startMinute: 720 },
      durationMinutes: 90,
    });
  });

  it('accepts touching ranges (half-open)', () => {
    expect(validateDialogPlacement(ctx, subject, at('2026-11-13', 540, 600)).ok).toBe(true);
    expect(validateDialogPlacement(ctx, subject, at('2026-11-13', 720, 780)).ok).toBe(true);
  });

  it('ignores the subject’s own current placement (moving within its old range)', () => {
    expect(validateDialogPlacement(ctx, subject, at('2026-11-13', 750, 840)).ok).toBe(true);
  });

  it('ignores activities of other trips and bank activities', () => {
    expect(validateDialogPlacement(ctx, subject, at('2026-11-13', 900, 960)).ok).toBe(true);
  });

  it('reports an overlap with the conflicting activities', () => {
    const check = validateDialogPlacement(ctx, subject, at('2026-11-13', 660, 720));
    expect(check).toEqual({ ok: false, reason: 'conflict_overlap', conflicts: [placed] });
  });

  it('checks a new activity (id null) against every placed activity of the trip', () => {
    const fresh = { id: null, tripId: 't1' };
    expect(validateDialogPlacement(ctx, fresh, at('2026-11-13', 780, 810))).toMatchObject({
      ok: false,
      reason: 'conflict_overlap',
      conflicts: [edited],
    });
    expect(validateDialogPlacement(ctx, fresh, at('2026-11-12', 600, 1440)).ok).toBe(true);
  });

  it.each([
    ['To equals From', at('2026-11-13', 720, 720), 'end_not_after_start'],
    ['To before From', at('2026-11-13', 720, 660), 'end_not_after_start'],
    ['NaN', at('2026-11-13', Number.NaN, 660), 'end_not_after_start'],
    ['15 minutes', at('2026-11-13', 720, 735), 'too_short'],
    ['more than 24 hours', at('2026-11-13', 0, 1470), 'too_long'],
    ['From off grid', at('2026-11-13', 705, 765), 'off_grid'],
    ['non-integer', at('2026-11-13', 720.5, 780.5), 'off_grid'],
    ['malformed day', at('2026-13-01', 720, 780), 'invalid_day'],
    ['day before the trip', at('2026-11-11', 720, 780), 'invalid_day'],
    ['day after the trip', at('2026-11-15', 720, 780), 'invalid_day'],
    ['before the trip start on day 1', at('2026-11-12', 540, 660), 'out_of_range'],
    ['after the trip end on the last day', at('2026-11-14', 1140, 1260), 'out_of_range'],
    ['past 24:00', at('2026-11-13', 1380, 1500), 'out_of_range'],
    ['negative From', at('2026-11-13', -60, 60), 'out_of_range'],
  ] as const)('%s → %s', (_label, input, reason) => {
    expect(validateDialogPlacement(ctx, subject, input)).toEqual({ ok: false, reason });
  });

  it('accepts the exact day bounds (first-day start, last-day end, full middle day)', () => {
    expect(validateDialogPlacement(ctx, subject, at('2026-11-12', 600, 660)).ok).toBe(true);
    expect(validateDialogPlacement(ctx, subject, at('2026-11-14', 1140, 1200)).ok).toBe(true);
    expect(
      validateDialogPlacement(ctx, { id: null, tripId: 't3' }, at('2026-11-13', 0, 1440)).ok,
    ).toBe(true);
  });

  it('agrees with rangeToDuration on the saved duration', () => {
    const input = at('2026-11-12', 600, 1440);
    const check = validateDialogPlacement(ctx, subject, input);
    expect(check.ok && check.durationMinutes).toBe(rangeToDuration(600, 1440));
  });
});

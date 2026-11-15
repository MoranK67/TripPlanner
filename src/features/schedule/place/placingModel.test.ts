import { PALETTE, type Activity, type TripWindow } from '@/domain';
import {
  dayChecks,
  firstValidSlot,
  isCursorKey,
  moveCursor,
  placedByDate,
  placingReducer,
  validRuns,
  type PlacingState,
} from './placingModel';

const window: TripWindow = {
  startDate: '2026-12-01',
  startMinute: 14 * 60,
  endDate: '2026-12-03',
  endMinute: 11 * 60,
};

function activity(id: string, duration: number, placement: Activity['placement']): Activity {
  return {
    id,
    tripId: 'trip-1',
    name: id,
    durationMinutes: duration,
    color: PALETTE[0],
    placement,
    bankPosition: 0,
  };
}

describe('placingReducer (mode state machine)', () => {
  const cursor = { dayIndex: 1, slot: 10 };

  it('picks an activity up, moves the cursor and ends', () => {
    let state: PlacingState = null;
    state = placingReducer(state, { type: 'select', id: 'a', cursor, via: 'pointer' });
    expect(state).toEqual({ id: 'a', cursor, via: 'pointer' });
    state = placingReducer(state, { type: 'move', cursor: { dayIndex: 2, slot: 11 } });
    expect(state?.cursor).toEqual({ dayIndex: 2, slot: 11 });
    expect(placingReducer(state, { type: 'end' })).toBeNull();
  });

  it('picking up the same activity again cancels; another one switches', () => {
    const a = placingReducer(null, { type: 'select', id: 'a', cursor, via: 'keyboard' });
    expect(placingReducer(a, { type: 'select', id: 'a', cursor, via: 'pointer' })).toBeNull();
    expect(placingReducer(a, { type: 'select', id: 'b', cursor, via: 'pointer' })?.id).toBe('b');
  });

  it('ignores moves while idle and clamps the cursor to the day', () => {
    expect(placingReducer(null, { type: 'move', cursor })).toBeNull();
    const s = placingReducer(null, {
      type: 'select',
      id: 'a',
      cursor: { dayIndex: -1, slot: 99 },
      via: 'pointer',
    });
    expect(s?.cursor).toEqual({ dayIndex: 0, slot: 47 });
  });
});

describe('slot validity (from canPlace)', () => {
  const subject = activity('s', 60, null);

  it('checks every start slot of a day against that day only', () => {
    const other = activity('o', 60, { date: '2026-12-02', startMinute: 10 * 60 });
    const checks = dayChecks(window, [other], subject, '2026-12-02');
    expect(checks).toHaveLength(48);
    expect(checks[19]).toMatchObject({ ok: false, reason: 'conflict_overlap' }); // 09:30–10:30
    expect(checks[20]).toMatchObject({ ok: false, reason: 'conflict_overlap' });
    expect(checks[18]).toEqual({ ok: true }); // ends at 10:00: half-open ranges
    expect(checks[22]).toEqual({ ok: true });
    expect(checks[47]).toMatchObject({ ok: false, reason: 'out_of_range' }); // past midnight
  });

  it('respects the trip window on the first and last day', () => {
    const first = dayChecks(window, [], subject, '2026-12-01');
    expect(validRuns(first)).toEqual([{ start: 28, end: 47 }]); // 14:00 … 23:00
    const last = dayChecks(window, [], subject, '2026-12-03');
    expect(validRuns(last)).toEqual([{ start: 0, end: 21 }]); // … 10:00 (ends 11:00)
  });

  it('a placed activity may move onto a range overlapping its own place', () => {
    const self = activity('self', 90, { date: '2026-12-02', startMinute: 9 * 60 });
    const checks = dayChecks(window, [self], self, '2026-12-02');
    expect(checks[18]).toEqual({ ok: true });
    expect(checks[19]).toEqual({ ok: true });
  });

  it('groups placed activities by date and skips bank ones', () => {
    const a = activity('a', 30, { date: '2026-12-02', startMinute: 0 });
    const b = activity('b', 30, { date: '2026-12-02', startMinute: 60 });
    const map = placedByDate([a, b, activity('c', 30, null)]);
    expect([...map.keys()]).toEqual(['2026-12-02']);
    expect(map.get('2026-12-02')).toEqual([a, b]);
  });

  it('splits valid slots into runs', () => {
    const ok = { ok: true } as const;
    const no = { ok: false, reason: 'out_of_range' } as const;
    expect(validRuns([ok, ok, no, ok, no, no, ok])).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 4 },
      { start: 6, end: 7 },
    ]);
    expect(validRuns([no, no])).toEqual([]);
  });

  it('starts the cursor at the first valid slot in view, else the first of the day', () => {
    const checks = dayChecks(window, [], subject, '2026-12-01'); // valid 28..46
    expect(firstValidSlot(checks, 10)).toBe(28);
    expect(firstValidSlot(checks, 30)).toBe(30);
    expect(firstValidSlot(checks, 47)).toBe(28);
    const none = dayChecks(window, [], activity('long', 1440, null), '2026-12-01');
    expect(firstValidSlot(none, 30)).toBe(30);
  });
});

describe('moveCursor', () => {
  const at = { dayIndex: 1, slot: 10 };

  it('moves by half hours and two-hour pages within the day', () => {
    expect(moveCursor(at, 'ArrowUp', 'rtl', 3)).toEqual({ dayIndex: 1, slot: 9 });
    expect(moveCursor(at, 'ArrowDown', 'rtl', 3)).toEqual({ dayIndex: 1, slot: 11 });
    expect(moveCursor(at, 'PageUp', 'rtl', 3)).toEqual({ dayIndex: 1, slot: 6 });
    expect(moveCursor(at, 'PageDown', 'rtl', 3)).toEqual({ dayIndex: 1, slot: 14 });
    expect(moveCursor(at, 'Home', 'rtl', 3)).toEqual({ dayIndex: 1, slot: 0 });
    expect(moveCursor(at, 'End', 'rtl', 3)).toEqual({ dayIndex: 1, slot: 47 });
    expect(moveCursor({ dayIndex: 1, slot: 1 }, 'PageUp', 'rtl', 3).slot).toBe(0);
  });

  it('left is the next day in RTL and the previous day in LTR; stays in the trip', () => {
    expect(moveCursor(at, 'ArrowLeft', 'rtl', 3).dayIndex).toBe(2);
    expect(moveCursor(at, 'ArrowRight', 'rtl', 3).dayIndex).toBe(0);
    expect(moveCursor(at, 'ArrowLeft', 'ltr', 3).dayIndex).toBe(0);
    expect(moveCursor(at, 'ArrowRight', 'ltr', 3).dayIndex).toBe(2);
    expect(moveCursor({ dayIndex: 2, slot: 0 }, 'ArrowLeft', 'rtl', 3).dayIndex).toBe(2);
    expect(moveCursor({ dayIndex: 0, slot: 0 }, 'ArrowRight', 'rtl', 3).dayIndex).toBe(0);
  });

  it('knows its keys', () => {
    expect(isCursorKey('ArrowLeft')).toBe(true);
    expect(isCursorKey('Enter')).toBe(false);
  });
});

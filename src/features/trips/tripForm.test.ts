import {
  defaultRange,
  endMinuteOptions,
  isTripWindowError,
  nextRange,
  startMinuteOptions,
  tripWindowFormError,
  windowFromForm,
} from './tripForm';

describe('nextRange (FR-2.3: first click = start, second click = end)', () => {
  it('starts a range on the first click', () => {
    expect(nextRange({}, '2026-05-10')).toEqual({ from: '2026-05-10' });
  });

  it('ends the range on the second click', () => {
    expect(nextRange({ from: '2026-05-10' }, '2026-05-14')).toEqual({
      from: '2026-05-10',
      to: '2026-05-14',
    });
  });

  it('makes a one-day trip when the start day is clicked again', () => {
    expect(nextRange({ from: '2026-05-10' }, '2026-05-10')).toEqual({
      from: '2026-05-10',
      to: '2026-05-10',
    });
  });

  it('swaps when the second click is before the start', () => {
    expect(nextRange({ from: '2026-05-10' }, '2026-05-02')).toEqual({
      from: '2026-05-02',
      to: '2026-05-10',
    });
  });

  it('starts over after a complete range', () => {
    expect(nextRange({ from: '2026-05-10', to: '2026-05-14' }, '2026-06-01')).toEqual({
      from: '2026-06-01',
    });
  });
});

describe('time options (FR-2.4)', () => {
  it('offers starts 00:00–23:30 and ends 00:30–24:00 every 30 minutes', () => {
    expect(startMinuteOptions()).toHaveLength(48);
    expect(startMinuteOptions()[0]).toBe(0);
    expect(startMinuteOptions().at(-1)).toBe(1410);
    expect(endMinuteOptions()).toHaveLength(48);
    expect(endMinuteOptions()[0]).toBe(30);
    expect(endMinuteOptions().at(-1)).toBe(1440);
  });
});

describe('tripWindowFormError (FR-2.5 via validateTripWindow)', () => {
  it('reports missing dates', () => {
    expect(tripWindowFormError({}, 600, 1200)).toBe('missing_dates');
    expect(tripWindowFormError({ from: '2026-05-01' }, 600, 1200)).toBe('missing_end');
  });

  it('uses the domain rules', () => {
    expect(tripWindowFormError({ from: '2026-05-01', to: '2026-05-01' }, 600, 600)).toBe(
      'end_not_after_start',
    );
    expect(tripWindowFormError({ from: '2026-01-01', to: '2026-04-01' }, 600, 1200)).toBe(
      'too_long',
    );
    expect(tripWindowFormError({ from: '2026-01-01', to: '2026-03-31' }, 600, 1200)).toBeNull();
  });

  it('builds the window only for a complete range', () => {
    expect(windowFromForm({ from: '2026-05-01' }, 0, 30)).toBeNull();
    expect(windowFromForm({ from: '2026-05-01', to: '2026-05-02' }, 0, 30)).toEqual({
      startDate: '2026-05-01',
      startMinute: 0,
      endDate: '2026-05-02',
      endMinute: 30,
    });
  });
});

describe('helpers', () => {
  it('defaults to a four-day trip from today', () => {
    expect(defaultRange('2026-12-30')).toEqual({ from: '2026-12-30', to: '2027-01-02' });
  });

  it('recognizes server trip-window reasons', () => {
    expect(isTripWindowError('too_long')).toBe(true);
    expect(isTripWindowError('name')).toBe(false);
    expect(isTripWindowError(null)).toBe(false);
  });
});

import { parseImport } from './importParser';
import { planImportPlacements, type ImportPlanTrip } from './importPlacement';
import type { Activity, ImportRow } from './types';

// Three days: day 1 from 10:00, day 2 all day, day 3 until 20:00.
const trip: ImportPlanTrip = {
  id: 't1',
  window: { startDate: '2027-03-01', startMinute: 600, endDate: '2027-03-03', endMinute: 1200 },
};

const activity = (
  name: string,
  durationMinutes: number,
  placement: Activity['placement'],
  overrides: Partial<Activity> = {},
): Activity => ({
  id: name,
  tripId: 't1',
  name,
  durationMinutes,
  color: '#000000',
  placement,
  bankPosition: 0,
  ...overrides,
});

const plan = (text: string, existing: Activity[] = []) =>
  planImportPlacements(trip, existing, parseImport(text).rows);

describe('planImportPlacements', () => {
  it('maps the day number to the trip date and keeps the start minute', () => {
    expect(plan('a;2;;1;10:00\nb;1;;2;00:00\nc;1;;3;19:00')).toEqual([
      { placement: { date: '2027-03-01', startMinute: 600 } },
      { placement: { date: '2027-03-02', startMinute: 0 } },
      { placement: { date: '2027-03-03', startMinute: 1140 } },
    ]);
  });

  it('returns bank: null for rows without placement fields and null for invalid rows', () => {
    expect(plan('a;1\nheader;x\nb;1;tag')).toEqual([{ bank: null }, null, { bank: null }]);
  });

  it('passes the parser issues through', () => {
    expect(plan('a;1;;1;\nb;1;;x;09:00')).toEqual([
      { bank: 'placement_incomplete' },
      { bank: 'placement_invalid' },
    ]);
  });

  it('banks a day past the trip as day_out_of_trip', () => {
    expect(plan('a;1;;4;10:00\nb;1;;999;10:00')).toEqual([
      { bank: 'day_out_of_trip' },
      { bank: 'day_out_of_trip' },
    ]);
  });

  it('banks a defensive bad day number (not from the parser) as placement_invalid', () => {
    const rows: ImportRow[] = [
      {
        ok: true,
        name: 'a',
        durationMinutes: 60,
        rounded: false,
        tag: null,
        placement: { day: 0, startMinute: 600, startRounded: false },
        placementIssue: null,
      },
      {
        ok: true,
        name: 'b',
        durationMinutes: 60,
        rounded: false,
        tag: null,
        placement: { day: 1, startMinute: 615, startRounded: false },
        placementIssue: null,
      },
    ];
    expect(planImportPlacements(trip, [], rows)).toEqual([
      { bank: 'placement_invalid' },
      { bank: 'placement_invalid' },
    ]);
  });

  it.each([
    ['before the first day starts', 'a;1;;1;09:30'],
    ['across the first day start', 'a;2;;1;09:00'],
    ['after the last day ends', 'a;1;;3;20:00'],
    ['across the last day end', 'a;2;;3;19:00'],
    ['across midnight', 'a;2;;2;23:00'],
  ])('banks a row %s as outside_trip_hours', (_case, line) => {
    expect(plan(line)).toEqual([{ bank: 'outside_trip_hours' }]);
  });

  it('fits exactly to the day bounds (half-open)', () => {
    expect(plan('a;1;;1;10:00\nb;1;;3;19:00\nc;1;;2;23:00')).toEqual([
      { placement: { date: '2027-03-01', startMinute: 600 } },
      { placement: { date: '2027-03-03', startMinute: 1140 } },
      { placement: { date: '2027-03-02', startMinute: 1380 } },
    ]);
  });

  it('banks an overlap with an existing activity, naming the earliest one', () => {
    const existing = [
      activity('ארוחת ערב', 60, { date: '2027-03-02', startMinute: 720 }),
      activity('מוזיאון', 120, { date: '2027-03-02', startMinute: 600 }),
      activity('במאגר', 600, null),
      activity('יום אחר', 600, { date: '2027-03-03', startMinute: 600 }),
    ];
    expect(plan('a;4;;2;10:30', existing)).toEqual([
      { bank: 'overlaps_existing', conflict: { activityName: 'מוזיאון' } },
    ]);
  });

  it('allows a row that touches an existing activity (half-open ranges)', () => {
    const existing = [activity('מוזיאון', 120, { date: '2027-03-02', startMinute: 600 })];
    expect(plan('a;1;;2;09:00\nb;1;;2;12:00', existing)).toEqual([
      { placement: { date: '2027-03-02', startMinute: 540 } },
      { placement: { date: '2027-03-02', startMinute: 720 } },
    ]);
  });

  it("ignores another trip's activities", () => {
    const existing = [
      activity('אחר', 120, { date: '2027-03-02', startMinute: 600 }, { tripId: 'other' }),
    ];
    expect(plan('a;1;;2;10:00', existing)).toEqual([
      { placement: { date: '2027-03-02', startMinute: 600 } },
    ]);
  });

  it('checks the trip hours before overlaps', () => {
    const existing = [activity('ערב', 120, { date: '2027-03-03', startMinute: 1080 })];
    expect(plan('a;2;;3;19:00', existing)).toEqual([{ bank: 'outside_trip_hours' }]);
  });

  it('an earlier import row wins; the later one is banked with its row number', () => {
    // Row 2 is invalid but still counts in the numbering (it is shown in the preview).
    expect(plan('a;2;;2;10:00\nheader;x\nb;1;;2;11:00\nc;1;;2;12:00\nd;1;;1;11:00')).toEqual([
      { placement: { date: '2027-03-02', startMinute: 600 } },
      null,
      { bank: 'overlaps_import_row', conflict: { rowNumber: 1 } },
      { placement: { date: '2027-03-02', startMinute: 720 } },
      { placement: { date: '2027-03-01', startMinute: 660 } },
    ]);
  });

  it('a banked row does not block later rows', () => {
    const existing = [activity('קיים', 60, { date: '2027-03-02', startMinute: 600 })];
    expect(plan('a;3;;2;10:00\nb;1;;2;11:00\nc;1;;2;11:30', existing)).toEqual([
      { bank: 'overlaps_existing', conflict: { activityName: 'קיים' } },
      { placement: { date: '2027-03-02', startMinute: 660 } },
      { bank: 'overlaps_import_row', conflict: { rowNumber: 2 } },
    ]);
  });

  it('prefers overlaps_existing when a row overlaps both', () => {
    const existing = [activity('קיים', 60, { date: '2027-03-02', startMinute: 720 })];
    expect(plan('a;2;;2;10:00\nb;3;;2;11:00', existing)).toEqual([
      { placement: { date: '2027-03-02', startMinute: 600 } },
      { bank: 'overlaps_existing', conflict: { activityName: 'קיים' } },
    ]);
  });

  it('returns an empty plan for no rows', () => {
    expect(planImportPlacements(trip, [], [])).toEqual([]);
  });
});

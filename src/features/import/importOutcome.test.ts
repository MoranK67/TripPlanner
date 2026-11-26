import type { ImportedActivity } from '@/data';
import { PALETTE, parseImport, type Activity, type TripWindow } from '@/domain';
import {
  buildImportRequest,
  countDestinations,
  serverRowPlans,
  unexpectedlyBanked,
} from './importOutcome';

const window: TripWindow = {
  startDate: '2026-05-01',
  startMinute: 600,
  endDate: '2026-05-03',
  endMinute: 1080,
};

function activity(overrides: Partial<Activity>): Activity {
  return {
    id: 'a',
    tripId: 'trip-1',
    name: 'קפה',
    durationMinutes: 60,
    color: PALETTE[0],
    placement: null,
    bankPosition: 1,
    ...overrides,
  };
}

function outcome(overrides: Partial<ImportedActivity> & { activity: Activity }): ImportedActivity {
  return {
    placed: false,
    bankReason: null,
    conflictActivityId: null,
    conflictItem: null,
    ...overrides,
  };
}

const rows = (text: string) => parseImport(text).rows;

describe('buildImportRequest (FEAT-3)', () => {
  const text = 'שבור\nקולוסיאום; 3; רומא; 2; 09:30\nפורום; 1\nגלידה; 1; ; 2\nוותיקן; 2; ; 9; 10:00';

  it('sends placements as trip dates for the placement type, with the source row indexes', () => {
    const request = buildImportRequest(rows(text), 'placement', window);
    expect(request.rowIndexes).toEqual([1, 2, 3, 4]);
    expect(request.items).toEqual([
      {
        name: 'קולוסיאום',
        durationMinutes: 180,
        tag: 'רומא',
        placement: { date: '2026-05-02', startMinute: 570 },
      },
      { name: 'פורום', durationMinutes: 60 },
      // Only a day: the parser's issue stays local, nothing is sent.
      { name: 'גלידה', durationMinutes: 60 },
      // Past the trip: sent anyway, the server banks it with day_out_of_trip.
      { name: 'וותיקן', durationMinutes: 120, placement: { date: '2026-05-09', startMinute: 600 } },
    ]);
  });

  it.each(['basic', 'tags'] as const)('ignores placement fields for the %s type', (type) => {
    const request = buildImportRequest(rows(text), type, window);
    expect(request.items.every((item) => item.placement === undefined)).toBe(true);
    expect(request.items[0]).toEqual({ name: 'קולוסיאום', durationMinutes: 180, tag: 'רומא' });
  });
});

describe('serverRowPlans (FEAT-3)', () => {
  const parsed = rows(
    'שבור\nא; 1; ; 1; 10:00\nב; 1; ; 1; 10:30\nג; 1; ; 1; 11:00\nד; 1; ; 1\nה; 1; ; 1; 12:00\nו; 1',
  );
  const request = buildImportRequest(parsed, 'placement', window);
  const existing = activity({
    id: 'old',
    name: 'מוזיאון',
    placement: { date: '2026-05-01', startMinute: 690 },
  });

  it('maps outcomes onto preview rows and converts server item numbers to row numbers', () => {
    const outcomes = [
      outcome({
        activity: activity({ id: 'n1', placement: { date: '2026-05-01', startMinute: 600 } }),
        placed: true,
      }),
      outcome({
        activity: activity({ id: 'n2' }),
        bankReason: 'overlaps_import_row',
        conflictActivityId: 'n1',
        conflictItem: 1,
      }),
      outcome({
        activity: activity({ id: 'n3' }),
        bankReason: 'overlaps_existing',
        conflictActivityId: 'old',
      }),
      outcome({ activity: activity({ id: 'n4' }) }),
      outcome({
        activity: activity({ id: 'n5' }),
        bankReason: 'overlaps_existing',
        conflictActivityId: 'gone',
      }),
      outcome({ activity: activity({ id: 'n6' }) }),
    ];
    const plans = serverRowPlans(parsed, request, outcomes, [existing]);
    expect(plans).toEqual([
      null,
      { placement: { date: '2026-05-01', startMinute: 600 } },
      // Item 1 of the items sent is preview row 2 (row 1 was invalid).
      { bank: 'overlaps_import_row', conflict: { rowNumber: 2 } },
      { bank: 'overlaps_existing', conflict: { activityName: 'מוזיאון' } },
      // Sent without a placement: the parser's issue explains it.
      { bank: 'placement_incomplete' },
      { bank: 'overlaps_existing', conflict: { activityName: '' } },
      { bank: null },
    ]);
    expect(countDestinations(plans)).toEqual({ placed: 1, banked: 5 });
  });

  it('keeps other reasons and marks an unknown conflict row as 0', () => {
    const plans = serverRowPlans(
      parsed,
      request,
      [
        outcome({ activity: activity({ id: 'n1' }), bankReason: 'outside_trip_hours' }),
        outcome({
          activity: activity({ id: 'n2' }),
          bankReason: 'overlaps_import_row',
          conflictItem: null,
        }),
      ],
      [],
    );
    expect(plans.slice(0, 3)).toEqual([
      null,
      { bank: 'outside_trip_hours' },
      { bank: 'overlaps_import_row', conflict: { rowNumber: 0 } },
    ]);
  });
});

describe('unexpectedlyBanked (FEAT-3)', () => {
  it('lists the rows the preview placed but the server banked', () => {
    const placed = { placement: { date: '2026-05-01', startMinute: 600 } };
    expect(
      unexpectedlyBanked(
        [placed, placed, { bank: null }, null, placed],
        [placed, { bank: 'outside_trip_hours' }, placed, null, { bank: null }],
      ),
    ).toEqual([1, 4]);
  });
});

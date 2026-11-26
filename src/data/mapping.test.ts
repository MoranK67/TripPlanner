import { AppError } from './errors';
import {
  activityFromRow,
  activityInsertFromInput,
  activityUpdateFromJson,
  importedActivityFromRow,
  importItemsFromInputs,
  importTripsCountsFromJson,
  importTripsFromBackup,
  placementFromRow,
  tripFromRow,
  tripInsertFromInput,
  tripSummaryFromRow,
  tripWindowFromRow,
  tripWithActivitiesFromRow,
  tripWindowUpdateFromJson,
  updateActivityArgs,
  updateTripWindowArgs,
} from './mapping';
import { activityRow, importActivitiesRow, tripRow } from './testing/fixtures';

const window = {
  startDate: '2026-05-01',
  startMinute: 600,
  endDate: '2026-05-03',
  endMinute: 1080,
};

describe('trip mapping', () => {
  it('tripWindowFromRow', () => {
    expect(tripWindowFromRow(tripRow())).toEqual(window);
  });

  it('tripFromRow maps snake_case to the domain Trip and drops DB-only columns', () => {
    expect(tripFromRow(tripRow())).toEqual({
      id: 'trip-1',
      name: 'רומא',
      window,
      colorCursor: 2,
    });
  });

  it('tripSummaryFromRow computes dayCount', () => {
    expect(tripSummaryFromRow(tripRow())).toEqual({
      id: 'trip-1',
      name: 'רומא',
      window,
      dayCount: 3,
    });
  });

  it('dayCount across a leap day and month boundary', () => {
    const summary = tripSummaryFromRow(
      tripRow({
        start_date: '2028-02-28',
        end_date: '2028-03-01',
        start_minute: 0,
        end_minute: 1440,
      }),
    );
    expect(summary.dayCount).toBe(3);
  });

  it('tripInsertFromInput sends only writable columns', () => {
    expect(tripInsertFromInput({ name: 'Trip', window })).toEqual({
      name: 'Trip',
      start_date: '2026-05-01',
      start_minute: 600,
      end_date: '2026-05-03',
      end_minute: 1080,
    });
  });

  it('updateTripWindowArgs uses the RPC argument names', () => {
    expect(updateTripWindowArgs('trip-1', { name: 'New', window })).toEqual({
      trip_id: 'trip-1',
      start_date: '2026-05-01',
      start_minute: 600,
      end_date: '2026-05-03',
      end_minute: 1080,
      name: 'New',
    });
  });
});

describe('activity mapping', () => {
  it('bank activity → placement null', () => {
    expect(activityFromRow(activityRow())).toEqual({
      id: 'act-1',
      tripId: 'trip-1',
      name: 'Colosseum',
      durationMinutes: 120,
      color: '#FFD6E0',
      placement: null,
      bankPosition: 1,
      tag: null,
      createdAt: '2026-04-01T10:00:00Z',
    });
  });

  it('maps the tag', () => {
    expect(activityFromRow(activityRow({ tag: 'מרכז' })).tag).toBe('מרכז');
  });

  it('placed activity → placement { date, startMinute }, including minute 0', () => {
    const activity = activityFromRow(
      activityRow({ scheduled_date: '2026-05-02', start_minute: 0 }),
    );
    expect(activity.placement).toEqual({ date: '2026-05-02', startMinute: 0 });
  });

  it('normalizes lower-case colors to the canonical upper-case form', () => {
    expect(activityFromRow(activityRow({ color: '#ffd6e0' })).color).toBe('#FFD6E0');
  });

  it('keeps fractional bank positions', () => {
    expect(activityFromRow(activityRow({ bank_position: 2.5 })).bankPosition).toBe(2.5);
  });

  it.each([
    { scheduled_date: '2026-05-02', start_minute: null },
    { scheduled_date: null, start_minute: 600 },
  ])('a half-set placement %o is rejected as an invalid response', (pair) => {
    expect(() => placementFromRow(pair)).toThrow(AppError);
    try {
      placementFromRow(pair);
    } catch (error) {
      expect((error as AppError).kind).toBe('unknown');
      expect((error as AppError).reason).toBe('invalid_response');
    }
  });

  it('activityInsertFromInput omits color (trigger assigns it) and never sends bank_position', () => {
    const insert = activityInsertFromInput('trip-1', { name: 'A', durationMinutes: 90 });
    expect(insert).toEqual({ trip_id: 'trip-1', name: 'A', duration_minutes: 90 });
    expect('color' in insert).toBe(false);
    expect('bank_position' in insert).toBe(false);
  });

  it('activityInsertFromInput includes an explicit color, upper-cased', () => {
    expect(
      activityInsertFromInput('trip-1', { name: 'A', durationMinutes: 90, color: '#cde5ff' }),
    ).toEqual({ trip_id: 'trip-1', name: 'A', duration_minutes: 90, color: '#CDE5FF' });
  });

  it('updateActivityArgs sends activity_id plus only the present fields (absent = keep)', () => {
    expect(updateActivityArgs('act-1', {})).toEqual({ activity_id: 'act-1' });
    expect(updateActivityArgs('act-1', { name: 'B' })).toEqual({ activity_id: 'act-1', name: 'B' });
    expect(updateActivityArgs('act-1', { durationMinutes: 60 })).toEqual({
      activity_id: 'act-1',
      duration_minutes: 60,
    });
    expect(updateActivityArgs('act-1', { color: '#dad4fa' })).toEqual({
      activity_id: 'act-1',
      color: '#DAD4FA',
    });
    expect(
      updateActivityArgs('act-1', { name: 'B', durationMinutes: 60, color: '#DAD4FA' }),
    ).toEqual({ activity_id: 'act-1', name: 'B', duration_minutes: 60, color: '#DAD4FA' });
  });

  it('activityInsertFromInput sends a normalized tag, and none when blank or null', () => {
    expect(
      activityInsertFromInput('trip-1', { name: 'A', durationMinutes: 30, tag: '  יום   2 ' }),
    ).toEqual({ trip_id: 'trip-1', name: 'A', duration_minutes: 30, tag: 'יום 2' });
    for (const tag of ['  ', null, undefined]) {
      expect('tag' in activityInsertFromInput('t', { name: 'A', durationMinutes: 30, tag })).toBe(
        false,
      );
    }
  });

  it('updateActivityArgs sends a normalized tag, and an empty string to clear it', () => {
    expect(updateActivityArgs('act-1', { tag: ' Old  Town ' })).toEqual({
      activity_id: 'act-1',
      tag: 'Old Town',
    });
    expect(updateActivityArgs('act-1', { tag: null })).toEqual({ activity_id: 'act-1', tag: '' });
    expect(updateActivityArgs('act-1', { tag: '   ' })).toEqual({ activity_id: 'act-1', tag: '' });
  });

  it('updateActivityArgs maps placement: target → date + minute, null → to_bank', () => {
    expect(
      updateActivityArgs('act-1', {
        durationMinutes: 90,
        placement: { date: '2026-05-02', startMinute: 600 },
      }),
    ).toEqual({
      activity_id: 'act-1',
      duration_minutes: 90,
      scheduled_date: '2026-05-02',
      start_minute: 600,
    });
    expect(updateActivityArgs('act-1', { placement: null })).toEqual({
      activity_id: 'act-1',
      to_bank: true,
    });
  });

  it('importItemsFromInputs sends scheduled_date + start_minute only with a placement (FEAT-3)', () => {
    expect(
      importItemsFromInputs([
        { name: 'A', durationMinutes: 30, placement: { date: '2026-05-02', startMinute: 570 } },
        { name: 'B', durationMinutes: 30, placement: null },
        {
          name: 'C',
          durationMinutes: 30,
          tag: 'x',
          placement: { date: '2026-05-01', startMinute: 0 },
        },
      ]),
    ).toEqual([
      { name: 'A', duration_minutes: 30, scheduled_date: '2026-05-02', start_minute: 570 },
      { name: 'B', duration_minutes: 30 },
      { name: 'C', duration_minutes: 30, tag: 'x', scheduled_date: '2026-05-01', start_minute: 0 },
    ]);
  });

  it('importedActivityFromRow maps a placed row', () => {
    expect(
      importedActivityFromRow(
        importActivitiesRow({ scheduled_date: '2026-05-02', start_minute: 600, placed: true }),
      ),
    ).toEqual({
      activity: expect.objectContaining({
        id: 'act-1',
        placement: { date: '2026-05-02', startMinute: 600 },
      }),
      placed: true,
      bankReason: null,
      conflictActivityId: null,
      conflictItem: null,
    });
  });

  it('importedActivityFromRow maps a banked row with its reason and conflict', () => {
    expect(
      importedActivityFromRow(
        importActivitiesRow({
          item_index: 3,
          bank_reason: 'overlaps_import_row',
          conflict_activity_id: 'act-0',
          conflict_item: 1,
        }),
      ),
    ).toMatchObject({
      activity: { placement: null },
      placed: false,
      bankReason: 'overlaps_import_row',
      conflictActivityId: 'act-0',
      conflictItem: 1,
    });
  });

  it('importedActivityFromRow keeps an unknown bank_reason as null instead of failing', () => {
    expect(
      importedActivityFromRow(importActivitiesRow({ bank_reason: 'newer_reason' })).bankReason,
    ).toBeNull();
  });

  it('importedActivityFromRow rejects a placed row without a placement', () => {
    expect(() => importedActivityFromRow(importActivitiesRow({ placed: true }))).toThrow(
      expect.objectContaining({ kind: 'unknown', reason: 'invalid_response' }),
    );
  });

  it('importItemsFromInputs sends a normalized tag only when present', () => {
    expect(
      importItemsFromInputs([
        { name: 'A', durationMinutes: 30, tag: 'מרכז ' },
        { name: 'B', durationMinutes: 30, tag: null },
        { name: 'C', durationMinutes: 30, tag: ' ' },
      ]),
    ).toEqual([
      { name: 'A', duration_minutes: 30, tag: 'מרכז' },
      { name: 'B', duration_minutes: 30 },
      { name: 'C', duration_minutes: 30 },
    ]);
  });

  it('importItemsFromInputs builds snake_case items, color only when given', () => {
    expect(
      importItemsFromInputs([
        { name: 'A', durationMinutes: 30 },
        { name: 'B 🍕', durationMinutes: 1440, color: '#fff1b5' },
      ]),
    ).toEqual([
      { name: 'A', duration_minutes: 30 },
      { name: 'B 🍕', duration_minutes: 1440, color: '#FFF1B5' },
    ]);
  });
});

describe('tripWindowUpdateFromJson', () => {
  it('maps { trip, moved_count }', () => {
    const json = { trip: { ...tripRow(), name: 'New' }, moved_count: 3 };
    expect(tripWindowUpdateFromJson(json)).toEqual({
      trip: { id: 'trip-1', name: 'New', window, colorCursor: 2 },
      movedCount: 3,
    });
  });

  it.each([
    null,
    'text',
    [],
    { moved_count: 1 },
    { trip: tripRow(), moved_count: '1' },
    { trip: tripRow(), moved_count: 1.5 },
    { trip: { ...tripRow(), start_minute: '600' }, moved_count: 0 },
    { trip: { ...tripRow(), id: 7 }, moved_count: 0 },
    { trip: [], moved_count: 0 },
  ])('rejects malformed result %#', (json) => {
    expect(() => tripWindowUpdateFromJson(json as never)).toThrow(AppError);
  });
});

describe('activityUpdateFromJson', () => {
  it('maps { activity, returned_to_bank: false } for a placed activity', () => {
    const json = {
      activity: activityRow({ scheduled_date: '2026-05-02', start_minute: 600, color: '#ffd6e0' }),
      returned_to_bank: false,
    };
    expect(activityUpdateFromJson(json)).toEqual({
      activity: expect.objectContaining({
        id: 'act-1',
        color: '#FFD6E0',
        placement: { date: '2026-05-02', startMinute: 600 },
      }),
      returnedToBank: false,
    });
  });

  it('maps returned_to_bank: true with a bank activity', () => {
    const result = activityUpdateFromJson({
      activity: activityRow({ duration_minutes: 300, bank_position: 9 }),
      returned_to_bank: true,
    });
    expect(result.returnedToBank).toBe(true);
    expect(result.activity.placement).toBeNull();
    expect(result.activity.bankPosition).toBe(9);
  });

  it.each([
    null,
    'text',
    [],
    { returned_to_bank: false },
    { activity: activityRow() },
    { activity: activityRow(), returned_to_bank: 'false' },
    { activity: null, returned_to_bank: false },
    { activity: { ...activityRow(), id: 1 }, returned_to_bank: false },
    { activity: { ...activityRow(), trip_id: null }, returned_to_bank: false },
    { activity: { ...activityRow(), name: null }, returned_to_bank: false },
    { activity: { ...activityRow(), duration_minutes: '60' }, returned_to_bank: false },
    { activity: { ...activityRow(), color: 1 }, returned_to_bank: false },
    { activity: { ...activityRow(), scheduled_date: 5 }, returned_to_bank: false },
    { activity: { ...activityRow(), start_minute: 1.5 }, returned_to_bank: false },
    { activity: { ...activityRow(), bank_position: 'NaN' }, returned_to_bank: false },
    { activity: { ...activityRow(), bank_position: Infinity }, returned_to_bank: false },
    // Half-set placement is rejected by activityFromRow.
    { activity: activityRow({ scheduled_date: '2026-05-02' }), returned_to_bank: false },
  ])('rejects malformed result %# as unknown / invalid_response', (json) => {
    try {
      activityUpdateFromJson(json as never);
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).kind).toBe('unknown');
      expect((error as AppError).reason).toBe('invalid_response');
    }
  });
});

describe('backup mapping', () => {
  it('tripWithActivitiesFromRow maps the trip and its embedded activities', () => {
    expect(
      tripWithActivitiesFromRow({ ...tripRow(), activities: [activityRow({ color: '#abcdef' })] }),
    ).toEqual({
      trip: { id: 'trip-1', name: 'רומא', window, colorCursor: 2 },
      activities: [expect.objectContaining({ id: 'act-1', color: '#ABCDEF', placement: null })],
    });
  });

  it('importTripsFromBackup maps camelCase to the import_trips snake_case payload', () => {
    expect(
      importTripsFromBackup([
        {
          name: 'רומא',
          window,
          colorCursor: 9,
          activities: [
            {
              name: 'A',
              durationMinutes: 30,
              color: '#abcdef',
              placement: { date: '2026-05-01', startMinute: 0 },
              tag: ' Old   Town ',
            },
            { name: 'B', durationMinutes: 1440, color: '#FFD6E0', placement: null, tag: null },
          ],
        },
      ]),
    ).toEqual([
      {
        name: 'רומא',
        start_date: '2026-05-01',
        start_minute: 600,
        end_date: '2026-05-03',
        end_minute: 1080,
        color_cursor: 9,
        activities: [
          {
            name: 'A',
            duration_minutes: 30,
            color: '#ABCDEF',
            scheduled_date: '2026-05-01',
            start_minute: 0,
            tag: 'Old Town',
          },
          {
            name: 'B',
            duration_minutes: 1440,
            color: '#FFD6E0',
            scheduled_date: null,
            start_minute: null,
            tag: null,
          },
        ],
      },
    ]);
  });

  it('importTripsCountsFromJson sums the activity counts', () => {
    expect(
      importTripsCountsFromJson({
        trips: [
          { trip: tripRow(), activity_count: 3 },
          { trip: tripRow({ id: 'trip-2' }), activity_count: 0 },
        ],
      }),
    ).toEqual({ trips: 2, activities: 3 });
    expect(importTripsCountsFromJson({ trips: [] })).toEqual({ trips: 0, activities: 0 });
  });

  it('importTripsCountsFromJson rejects an unexpected shape', () => {
    for (const json of [null, [], { trips: {} }, { trips: [{ trip: tripRow() }] }]) {
      expect(() => importTripsCountsFromJson(json)).toThrow(AppError);
    }
  });
});

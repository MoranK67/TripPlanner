import { MAX_BACKUP_ACTIVITIES, MAX_BACKUP_TRIPS, type BackupTrip } from '@/domain';
import { createBackupRepo, toImportError, type BackupRepo } from './backupRepo';
import { AppError } from './errors';
import { RequestTimeoutError } from './timeoutFetch';
import { activityRow, tripRow } from './testing/fixtures';
import { argsOf, createMockSupabase, methods, type MockSupabase } from './testing/mockSupabase';

const window = {
  startDate: '2026-05-01',
  startMinute: 600,
  endDate: '2026-05-03',
  endMinute: 1080,
};

function backupTrip(overrides: Partial<BackupTrip> = {}): BackupTrip {
  return {
    name: 'רומא',
    window,
    colorCursor: 3,
    activities: [
      {
        name: 'Colosseum',
        durationMinutes: 120,
        color: '#ffd6e0',
        placement: { date: '2026-05-02', startMinute: 0 },
        tag: 'Centre',
      },
      { name: 'Pantheon', durationMinutes: 60, color: '#C1E1C1', placement: null, tag: null },
    ],
    ...overrides,
  };
}

function importResult(counts: number[]) {
  return {
    trips: counts.map((count, i) => ({
      trip: tripRow({ id: `trip-${i + 1}` }),
      activity_count: count,
    })),
  };
}

let mock: MockSupabase;
let repo: BackupRepo;

beforeEach(() => {
  mock = createMockSupabase();
  repo = createBackupRepo(() => mock.client);
});

afterEach(() => {
  expect(mock.pending()).toBe(0);
});

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe('backupRepo.exportAll', () => {
  it('reads trips with embedded activities in one request, ordered like tripsRepo.list', async () => {
    mock.ok([
      {
        ...tripRow(),
        activities: [
          activityRow({ id: 'a-1', bank_position: 1 }),
          activityRow({
            id: 'a-2',
            color: '#c1e1c1',
            scheduled_date: '2026-05-02',
            start_minute: 600,
            bank_position: 2,
          }),
        ],
      },
      { ...tripRow({ id: 'trip-2', name: 'פריז', color_cursor: 0 }), activities: [] },
    ]);

    const result = await repo.exportAll();

    expect(result).toEqual([
      {
        trip: { id: 'trip-1', name: 'רומא', window, colorCursor: 2 },
        activities: [
          {
            id: 'a-1',
            tripId: 'trip-1',
            name: 'Colosseum',
            durationMinutes: 120,
            color: '#FFD6E0',
            placement: null,
            bankPosition: 1,
            tag: null,
            createdAt: '2026-04-01T10:00:00Z',
          },
          expect.objectContaining({
            id: 'a-2',
            color: '#C1E1C1',
            placement: { date: '2026-05-02', startMinute: 600 },
          }),
        ],
      },
      { trip: { id: 'trip-2', name: 'פריז', window, colorCursor: 0 }, activities: [] },
    ]);
    expect(mock.requests).toHaveLength(1);
    const [request] = mock.requests;
    expect(request?.kind).toBe('from');
    expect(request?.target).toBe('trips');
    expect(argsOf(request, 'select')).toEqual(['*, activities(*)']);
    expect(request?.calls.filter((c) => c.method === 'order').map((c) => c.args)).toEqual([
      ['start_date', { ascending: true }],
      ['start_minute', { ascending: true }],
      ['name', { ascending: true }],
      ['bank_position', { referencedTable: 'activities', ascending: true }],
    ]);
  });

  it('returns [] for no trips / null data', async () => {
    mock.ok([]).ok(null);
    expect(await repo.exportAll()).toEqual([]);
    expect(await repo.exportAll()).toEqual([]);
  });

  it('rejects a half-placed activity row as an invalid response', async () => {
    mock.ok([{ ...tripRow(), activities: [activityRow({ scheduled_date: '2026-05-02' })] }]);
    const error = await rejection(repo.exportAll());
    expect(error.kind).toBe('unknown');
    expect(error.reason).toBe('invalid_response');
  });

  it('maps a network failure to AppError network', async () => {
    mock.throws(new TypeError('Failed to fetch'));
    const error = await rejection(repo.exportAll());
    expect(error.kind).toBe('network');
  });
});

describe('backupRepo.importAll — request', () => {
  it('sends one import_trips call with the snake_case payload and sums the counts', async () => {
    mock.ok(importResult([2, 0]));
    const second = backupTrip({ name: 'פריז', colorCursor: 0, activities: [] });

    const counts = await repo.importAll([backupTrip(), second]);

    expect(counts).toEqual({ trips: 2, activities: 2 });
    expect(mock.requests).toHaveLength(1);
    const [request] = mock.requests;
    expect(request?.kind).toBe('rpc');
    expect(request?.target).toBe('import_trips');
    expect(methods(request)).toEqual([]);
    expect(request?.rpcArgs).toEqual({
      trips: [
        {
          name: 'רומא',
          start_date: '2026-05-01',
          start_minute: 600,
          end_date: '2026-05-03',
          end_minute: 1080,
          color_cursor: 3,
          activities: [
            {
              name: 'Colosseum',
              duration_minutes: 120,
              color: '#FFD6E0',
              scheduled_date: '2026-05-02',
              start_minute: 0,
              tag: 'Centre',
            },
            {
              name: 'Pantheon',
              duration_minutes: 60,
              color: '#C1E1C1',
              scheduled_date: null,
              start_minute: null,
              tag: null,
            },
          ],
        },
        {
          name: 'פריז',
          start_date: '2026-05-01',
          start_minute: 600,
          end_date: '2026-05-03',
          end_minute: 1080,
          color_cursor: 0,
          activities: [],
        },
      ],
    });
  });

  it.each([
    ['null', null],
    ['no trips array', {}],
    ['a bad trip row', { trips: [{ trip: { id: 1 }, activity_count: 1 }] }],
    ['a non-integer count', { trips: [{ trip: tripRow(), activity_count: '1' }] }],
    ['a non-object entry', { trips: [7] }],
  ])('rejects an unexpected response (%s) as invalid_response', async (_label, data) => {
    mock.ok(data);
    const error = await rejection(repo.importAll([backupTrip()]));
    expect(error.kind).toBe('unknown');
    expect(error.reason).toBe('invalid_response');
  });
});

describe('backupRepo.importAll — client pre-check (no request)', () => {
  const activity = backupTrip().activities[1]!;

  it.each<
    [string, BackupTrip[], string, { tripIndex: number; activityIndex: number | null } | null]
  >([
    ['no trips', [], 'trips', null],
    [
      'too many trips',
      Array.from({ length: MAX_BACKUP_TRIPS + 1 }, () => backupTrip({ activities: [] })),
      'too_many_trips',
      null,
    ],
    [
      'too many activities in total',
      [
        backupTrip({ activities: Array.from({ length: MAX_BACKUP_ACTIVITIES }, () => activity) }),
        backupTrip({ activities: [activity] }),
      ],
      'too_many_activities',
      null,
    ],
    [
      'blank trip name',
      [backupTrip(), backupTrip({ name: '   ' })],
      'name',
      { tripIndex: 1, activityIndex: null },
    ],
    [
      'trip window',
      [backupTrip({ window: { ...window, endDate: '2026-04-30' } })],
      'end_not_after_start',
      { tripIndex: 0, activityIndex: null },
    ],
    [
      'negative color cursor',
      [backupTrip({ colorCursor: -1 })],
      'color_cursor',
      { tripIndex: 0, activityIndex: null },
    ],
    [
      'fractional color cursor',
      [backupTrip({ colorCursor: 1.5 })],
      'color_cursor',
      { tripIndex: 0, activityIndex: null },
    ],
    [
      'activity name',
      [backupTrip({ activities: [activity, { ...activity, name: '' }] })],
      'name',
      { tripIndex: 0, activityIndex: 1 },
    ],
    [
      'activity duration',
      [backupTrip({ activities: [{ ...activity, durationMinutes: 45 }] })],
      'duration_minutes',
      { tripIndex: 0, activityIndex: 0 },
    ],
    [
      'activity color',
      [backupTrip({ activities: [{ ...activity, color: 'red' }] })],
      'color',
      { tripIndex: 0, activityIndex: 0 },
    ],
    [
      'activity tag',
      [backupTrip({ activities: [activity, { ...activity, tag: 'x'.repeat(31) }] })],
      'tag',
      { tripIndex: 0, activityIndex: 1 },
    ],
    [
      'placement date',
      [
        backupTrip(),
        backupTrip({
          activities: [{ ...activity, placement: { date: '2026-02-30', startMinute: 0 } }],
        }),
      ],
      'scheduled_date',
      { tripIndex: 1, activityIndex: 0 },
    ],
    [
      'placement minute',
      [
        backupTrip({
          activities: [{ ...activity, placement: { date: '2026-05-02', startMinute: 45 } }],
        }),
      ],
      'start_minute',
      { tripIndex: 0, activityIndex: 0 },
    ],
  ])('%s', async (_label, trips, reason, location) => {
    const error = await rejection(repo.importAll(trips));
    expect(error.kind).toBe('validation');
    expect(error.reason).toBe(reason);
    expect(error.location).toEqual(location);
    expect(mock.requests).toHaveLength(0);
  });

  it('accepts exactly the limits', async () => {
    mock.ok(importResult([MAX_BACKUP_ACTIVITIES]));
    const activities = Array.from({ length: MAX_BACKUP_ACTIVITIES }, () => activity);
    expect(await repo.importAll([backupTrip({ activities })])).toEqual({
      trips: 1,
      activities: MAX_BACKUP_ACTIVITIES,
    });
  });
});

describe('backupRepo.importAll — server errors', () => {
  it.each([
    ['too_many_trips', 'too_many_trips'],
    ['too_many_activities', 'too_many_activities'],
  ])('TP_LIMIT %s → validation without location', async (details, reason) => {
    mock.fail({ message: 'TP_LIMIT', details, hint: '…', code: 'P0001' });
    const error = await rejection(repo.importAll([backupTrip()]));
    expect(error).toMatchObject({ kind: 'validation', code: 'TP_LIMIT', reason, location: null });
  });

  it.each<[string, string, { tripIndex: number; activityIndex: number | null } | null]>([
    ['trips', 'trips', null],
    ['trip:2', 'trip', { tripIndex: 1, activityIndex: null }],
    ['trip:1:name', 'name', { tripIndex: 0, activityIndex: null }],
    ['trip:3:too_long', 'too_long', { tripIndex: 2, activityIndex: null }],
    ['trip:1:color_cursor', 'color_cursor', { tripIndex: 0, activityIndex: null }],
    ['trip:2:item:5', 'item', { tripIndex: 1, activityIndex: 4 }],
    ['trip:2:item:5:duration_minutes', 'duration_minutes', { tripIndex: 1, activityIndex: 4 }],
    ['trip:1:item:1:scheduled_date', 'scheduled_date', { tripIndex: 0, activityIndex: 0 }],
    ['trip:1:item:2:tag', 'tag', { tripIndex: 0, activityIndex: 1 }],
  ])('TP_VALIDATION %s → reason %s with location', async (details, reason, location) => {
    mock.fail({ message: 'TP_VALIDATION', details, hint: '…', code: 'P0001' });
    const error = await rejection(repo.importAll([backupTrip()]));
    expect(error).toMatchObject({ kind: 'validation', code: 'TP_VALIDATION', reason, location });
  });

  it('TP_OVERLAP → conflict_overlap with the location from the hint', async () => {
    mock.fail(
      {
        message: 'TP_OVERLAP',
        details: 'overlap',
        hint: 'trip:2:item:7 overlaps an earlier activity of the trip',
        code: '23P01',
      },
      409,
    );
    const error = await rejection(repo.importAll([backupTrip()]));
    expect(error).toMatchObject({
      kind: 'conflict_overlap',
      reason: 'overlap',
      location: { tripIndex: 1, activityIndex: 6 },
      status: 409,
    });
  });

  it('TP_OUT_OF_RANGE → out_of_range with the location from the hint', async () => {
    mock.fail({
      message: 'TP_OUT_OF_RANGE',
      details: 'outside_trip_window',
      hint: 'trip:1:item:2 is outside the trip window',
      code: 'P0001',
    });
    const error = await rejection(repo.importAll([backupTrip()]));
    expect(error).toMatchObject({
      kind: 'out_of_range',
      reason: 'outside_trip_window',
      location: { tripIndex: 0, activityIndex: 1 },
    });
  });

  it('a placement error outside any item (index 0) or without a hint has no location', async () => {
    mock
      .fail({ message: 'TP_OVERLAP', details: 'overlap', hint: 'trip:1:item:0 x', code: '23P01' })
      .fail({ message: 'TP_OUT_OF_RANGE', details: 'outside_trip_window', code: 'P0001' });
    expect((await rejection(repo.importAll([backupTrip()]))).location).toEqual({
      tripIndex: 0,
      activityIndex: null,
    });
    expect((await rejection(repo.importAll([backupTrip()]))).location).toBeNull();
  });

  it('a timeout is network/timeout and NOT retryable (the import may have committed)', async () => {
    mock.throws(new RequestTimeoutError(15_000));
    const error = await rejection(repo.importAll([backupTrip()]));
    expect(error).toMatchObject({ kind: 'network', reason: 'timeout', retryable: false });
    expect(mock.requests).toHaveLength(1);
  });

  it('a failed fetch is network and not retryable; the call is not re-sent', async () => {
    mock.throws(new TypeError('Failed to fetch'));
    const error = await rejection(repo.importAll([backupTrip()]));
    expect(error).toMatchObject({ kind: 'network', retryable: false });
    expect(mock.requests).toHaveLength(1);
  });

  it('a deadlock is re-run once (rolled back, so it cannot duplicate) and then succeeds', async () => {
    mock.fail({ message: 'deadlock detected', code: '40P01' }, 500).ok(importResult([2]));
    expect(await repo.importAll([backupTrip()])).toEqual({ trips: 1, activities: 2 });
    expect(mock.requests).toHaveLength(2);
  });

  it('a statement timeout is not re-run', async () => {
    mock.fail({ message: 'canceling statement due to statement timeout', code: '57014' }, 500);
    const error = await rejection(repo.importAll([backupTrip()]));
    expect(error).toMatchObject({ kind: 'unknown', code: '57014' });
    expect(mock.requests).toHaveLength(1);
  });

  it('an expired JWT → auth_expired', async () => {
    mock.fail({ message: 'JWT expired', code: 'PGRST303' }, 401);
    const error = await rejection(repo.importAll([backupTrip()]));
    expect(error.kind).toBe('auth_expired');
  });
});

describe('toImportError', () => {
  it('keeps errors it does not rewrite', () => {
    const plain = new AppError('validation', { code: 'TP_VALIDATION', reason: 'odd' });
    expect(toImportError(plain)).toBe(plain);
    const noReason = new AppError('validation', { code: 'TP_VALIDATION' });
    expect(toImportError(noReason)).toBe(noReason);
    const aborted = new AppError('network', { reason: 'aborted', retryable: false });
    expect(toImportError(aborted)).toBe(aborted);
    const other = new AppError('unknown', { code: '42P01' });
    expect(toImportError(other)).toBe(other);
  });

  it('keeps code, status and cause when rewriting', () => {
    const cause = { message: 'TP_VALIDATION' };
    const error = toImportError(
      new AppError('validation', {
        code: 'TP_VALIDATION',
        reason: 'trip:1:name',
        status: 400,
        cause,
      }),
    );
    expect(error).toMatchObject({ code: 'TP_VALIDATION', status: 400, cause, reason: 'name' });
  });
});

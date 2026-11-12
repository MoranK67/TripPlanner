import { createActivitiesRepo, type ActivitiesRepo } from './activitiesRepo';
import { AppError } from './errors';
import { activityRow } from './testing/fixtures';
import { argsOf, createMockSupabase, methods, type MockSupabase } from './testing/mockSupabase';

let mock: MockSupabase;
let repo: ActivitiesRepo;

beforeEach(() => {
  mock = createMockSupabase();
  repo = createActivitiesRepo(() => mock.client);
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

const placedRow = activityRow({ scheduled_date: '2026-05-02', start_minute: 600 });
const overlap = { message: 'TP_OVERLAP', code: '23P01', details: 'overlap', hint: '' };
const outOfRange = {
  message: 'TP_OUT_OF_RANGE',
  code: 'P0001',
  details: 'outside_trip_window',
  hint: '',
};

describe('activitiesRepo.create', () => {
  it('inserts without color/bank_position so the trigger assigns them', async () => {
    mock.ok(activityRow({ color: '#FFE3C2', bank_position: 4 }));
    const activity = await repo.create('trip-1', { name: 'Colosseum', durationMinutes: 120 });
    expect(activity).toEqual({
      id: 'act-1',
      tripId: 'trip-1',
      name: 'Colosseum',
      durationMinutes: 120,
      color: '#FFE3C2',
      placement: null,
      bankPosition: 4,
    });
    const [request] = mock.requests;
    expect(request?.target).toBe('activities');
    expect(argsOf(request, 'insert')).toEqual([
      { trip_id: 'trip-1', name: 'Colosseum', duration_minutes: 120 },
    ]);
    expect(methods(request)).toEqual(['insert', 'select', 'single']);
  });

  it('sends an explicit color', async () => {
    mock.ok(activityRow({ color: '#CDE5FF' }));
    await repo.create('trip-1', { name: 'A', durationMinutes: 30, color: '#cde5ff' });
    expect(argsOf(mock.requests[0], 'insert')).toEqual([
      { trip_id: 'trip-1', name: 'A', duration_minutes: 30, color: '#CDE5FF' },
    ]);
  });

  it.each([
    [{ name: '', durationMinutes: 30 }, 'name'],
    [{ name: 'x'.repeat(61), durationMinutes: 30 }, 'name'],
    [{ name: 'A', durationMinutes: 45 }, 'duration_minutes'],
    [{ name: 'A', durationMinutes: 1470 }, 'duration_minutes'],
    [{ name: 'A', durationMinutes: 30, color: 'red' }, 'color'],
  ])('rejects invalid input locally (%#)', async (input, reason) => {
    const error = await rejection(repo.create('trip-1', input));
    expect(error.kind).toBe('validation');
    expect(error.reason).toBe(reason);
    expect(mock.requests).toHaveLength(0);
  });

  it('accepts a 60-character name with emoji and Hebrew', async () => {
    const prefix = 'מוזיאון 🎨 museum ';
    const name = prefix + 'א'.repeat(60 - [...prefix].length); // 60 code points
    mock.ok(activityRow({ name }));
    expect((await repo.create('trip-1', { name, durationMinutes: 60 })).name).toBe(name);
  });

  it('TP_NOT_FOUND from the insert trigger → not_found / trip', async () => {
    mock.fail({ message: 'TP_NOT_FOUND', code: 'P0001', details: 'trip', hint: '' });
    const error = await rejection(repo.create('missing', { name: 'A', durationMinutes: 30 }));
    expect(error.kind).toBe('not_found');
    expect(error.reason).toBe('trip');
  });

  it('RLS violation → not_found', async () => {
    mock.fail(
      {
        message: 'new row violates row-level security policy for table "activities"',
        code: '42501',
      },
      403,
    );
    expect((await rejection(repo.create('other', { name: 'A', durationMinutes: 30 }))).kind).toBe(
      'not_found',
    );
  });
});

describe('activitiesRepo.update (RPC update_activity, DEC-022)', () => {
  it('in place: calls update_activity with only the patched fields', async () => {
    mock.ok({ activity: { ...placedRow, name: 'New' }, returned_to_bank: false });
    const result = await repo.update('act-1', { name: 'New' });
    expect(result).toEqual({
      activity: expect.objectContaining({
        name: 'New',
        placement: { date: '2026-05-02', startMinute: 600 },
      }),
      returnedToBank: false,
    });
    expect(mock.requests).toHaveLength(1);
    const [request] = mock.requests;
    expect(request?.kind).toBe('rpc');
    expect(request?.target).toBe('update_activity');
    expect(request?.rpcArgs).toEqual({ activity_id: 'act-1', name: 'New' });
  });

  it('sends all fields, color upper-cased', async () => {
    mock.ok({ activity: activityRow(), returned_to_bank: false });
    await repo.update('act-1', { name: 'A', durationMinutes: 90, color: '#cde5ff' });
    expect(mock.requests[0]?.rpcArgs).toEqual({
      activity_id: 'act-1',
      name: 'A',
      duration_minutes: 90,
      color: '#CDE5FF',
    });
  });

  it('an empty patch uses the same RPC with only activity_id (nulls keep values)', async () => {
    mock.ok({ activity: activityRow(), returned_to_bank: false });
    const result = await repo.update('act-1', {});
    expect(result.returnedToBank).toBe(false);
    expect(mock.requests[0]?.target).toBe('update_activity');
    expect(mock.requests[0]?.rpcArgs).toEqual({ activity_id: 'act-1' });
  });

  it('FR-3.6: a duration that no longer fits → returnedToBank, one atomic request', async () => {
    mock.ok({
      activity: activityRow({ duration_minutes: 300, bank_position: 9 }),
      returned_to_bank: true,
    });
    const result = await repo.update('act-1', { durationMinutes: 300 });
    expect(result.returnedToBank).toBe(true);
    expect(result.activity.placement).toBeNull();
    expect(result.activity.durationMinutes).toBe(300);
    expect(result.activity.bankPosition).toBe(9);
    expect(mock.requests).toHaveLength(1);
  });

  it.each(['activity_id', 'name', 'duration_minutes', 'color'])(
    'TP_VALIDATION (%s) → validation with that reason',
    async (details) => {
      mock.fail({ message: 'TP_VALIDATION', code: 'P0001', details, hint: '' });
      const error = await rejection(repo.update('act-1', { name: 'x' }));
      expect(error.kind).toBe('validation');
      expect(error.reason).toBe(details);
    },
  );

  it('TP_NOT_FOUND → not_found / activity', async () => {
    mock.fail({ message: 'TP_NOT_FOUND', code: 'P0001', details: 'activity', hint: '' });
    const error = await rejection(repo.update('gone', { name: 'x' }));
    expect(error.kind).toBe('not_found');
    expect(error.reason).toBe('activity');
  });

  it('a network failure → network, no follow-up request', async () => {
    mock.fail({ message: 'TypeError: Failed to fetch', code: '' }, 0);
    const error = await rejection(repo.update('act-1', { durationMinutes: 60 }));
    expect(error.kind).toBe('network');
    expect(mock.requests).toHaveLength(1);
  });

  it.each([
    null,
    { activity: activityRow() },
    { activity: { ...activityRow(), duration_minutes: '60' }, returned_to_bank: false },
  ])('malformed jsonb %# → unknown / invalid_response', async (json) => {
    mock.ok(json);
    const error = await rejection(repo.update('act-1', { name: 'x' }));
    expect(error.kind).toBe('unknown');
    expect(error.reason).toBe('invalid_response');
  });

  it.each([
    [{ name: ' ' }, 'name'],
    [{ durationMinutes: 0 }, 'duration_minutes'],
    [{ color: '#12345' }, 'color'],
  ])('rejects an invalid patch locally (%#)', async (patch, reason) => {
    const error = await rejection(repo.update('act-1', patch));
    expect(error.reason).toBe(reason);
    expect(mock.requests).toHaveLength(0);
  });
});

describe('activitiesRepo.delete', () => {
  it('deletes by id', async () => {
    mock.ok(null, 204);
    await expect(repo.delete('act-1')).resolves.toBeUndefined();
    expect(mock.requests[0]?.target).toBe('activities');
    expect(methods(mock.requests[0])).toEqual(['delete', 'eq']);
    expect(argsOf(mock.requests[0], 'eq')).toEqual(['id', 'act-1']);
  });
});

describe('activitiesRepo.place', () => {
  it('calls place_activity with the RPC argument shape and maps the row', async () => {
    mock.ok(placedRow);
    const activity = await repo.place('act-1', '2026-05-02', 600);
    expect(activity.placement).toEqual({ date: '2026-05-02', startMinute: 600 });
    const [request] = mock.requests;
    expect(request?.kind).toBe('rpc');
    expect(request?.target).toBe('place_activity');
    expect(request?.rpcArgs).toEqual({
      activity_id: 'act-1',
      scheduled_date: '2026-05-02',
      start_minute: 600,
    });
  });

  it.each([
    [overlap, 'conflict_overlap', 'overlap'],
    [outOfRange, 'out_of_range', 'outside_trip_window'],
    [{ message: 'TP_NOT_FOUND', code: 'P0001', details: 'activity' }, 'not_found', 'activity'],
    [
      { message: 'TP_VALIDATION', code: 'P0001', details: 'start_minute' },
      'validation',
      'start_minute',
    ],
  ])('maps %o', async (failure, kind, reason) => {
    mock.fail(failure);
    const error = await rejection(repo.place('act-1', '2026-05-02', 600));
    expect(error.kind).toBe(kind);
    expect(error.reason).toBe(reason);
  });

  it('two devices, same slot: the second save fails with conflict_overlap (§9.4)', async () => {
    mock.ok(placedRow).fail(overlap);
    await repo.place('act-1', '2026-05-02', 600);
    expect((await rejection(repo.place('act-2', '2026-05-02', 600))).kind).toBe('conflict_overlap');
  });

  it('network drop mid-drag → network, retryable (§9.4)', async () => {
    mock.throws(new TypeError('Failed to fetch'));
    const error = await rejection(repo.place('act-1', '2026-05-02', 600));
    expect(error.kind).toBe('network');
    expect(error.retryable).toBe(true);
  });

  it.each([
    ['2026-13-01', 600, 'scheduled_date'],
    ['2026-05-02', 615, 'start_minute'],
    ['2026-05-02', 1440, 'start_minute'],
  ])('rejects a malformed target locally (%s, %s)', async (date, minute, reason) => {
    const error = await rejection(repo.place('act-1', date, minute));
    expect(error.kind).toBe('validation');
    expect(error.reason).toBe(reason);
    expect(mock.requests).toHaveLength(0);
  });

  it('null RPC data → not_found', async () => {
    mock.ok(null);
    expect((await rejection(repo.place('act-1', '2026-05-02', 600))).kind).toBe('not_found');
  });
});

describe('activitiesRepo.unplace', () => {
  it('calls unplace_activity and maps the bank row', async () => {
    mock.ok(activityRow({ bank_position: 7 }));
    const activity = await repo.unplace('act-1');
    expect(activity).toEqual(expect.objectContaining({ placement: null, bankPosition: 7 }));
    expect(mock.requests[0]?.target).toBe('unplace_activity');
    expect(mock.requests[0]?.rpcArgs).toEqual({ activity_id: 'act-1' });
  });

  it('maps TP_NOT_FOUND', async () => {
    mock.fail({ message: 'TP_NOT_FOUND', code: 'P0001', details: 'activity' });
    expect((await rejection(repo.unplace('x'))).kind).toBe('not_found');
  });
});

describe('activitiesRepo.importMany', () => {
  it('calls import_activities with snake_case items and returns activities in order', async () => {
    mock.ok([
      activityRow({ id: 'a', name: 'A', duration_minutes: 30 }),
      activityRow({ id: 'b', name: 'B', duration_minutes: 90, bank_position: 2 }),
    ]);
    const result = await repo.importMany('trip-1', [
      { name: 'A', durationMinutes: 30 },
      { name: 'B', durationMinutes: 90, color: '#c8ebe3' },
    ]);
    expect(result.map((a) => a.id)).toEqual(['a', 'b']);
    const [request] = mock.requests;
    expect(request?.target).toBe('import_activities');
    expect(request?.rpcArgs).toEqual({
      trip_id: 'trip-1',
      items: [
        { name: 'A', duration_minutes: 30 },
        { name: 'B', duration_minutes: 90, color: '#C8EBE3' },
      ],
    });
  });

  it('an empty list makes no request', async () => {
    expect(await repo.importMany('trip-1', [])).toEqual([]);
    expect(mock.requests).toHaveLength(0);
  });

  it('null data → []', async () => {
    mock.ok(null);
    expect(await repo.importMany('trip-1', [{ name: 'A', durationMinutes: 30 }])).toEqual([]);
  });

  it('accepts exactly 200 items', async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ name: `A${i}`, durationMinutes: 30 }));
    mock.ok([]);
    await repo.importMany('trip-1', items);
    expect((mock.requests[0]?.rpcArgs as { items: unknown[] }).items).toHaveLength(200);
  });

  it('201 items → validation / too_many_items, no request (§9.4)', async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ name: `A${i}`, durationMinutes: 30 }));
    const error = await rejection(repo.importMany('trip-1', items));
    expect(error.kind).toBe('validation');
    expect(error.reason).toBe('too_many_items');
    expect(mock.requests).toHaveLength(0);
  });

  it('reports the 1-based index of a bad item, like the RPC', async () => {
    const error = await rejection(
      repo.importMany('trip-1', [
        { name: 'A', durationMinutes: 30 },
        { name: 'B', durationMinutes: 45 },
      ]),
    );
    expect(error.reason).toBe('item:2:duration_minutes');
    expect(mock.requests).toHaveLength(0);
  });

  it.each([
    [
      { message: 'TP_LIMIT', code: 'P0001', details: 'too_many_items' },
      'validation',
      'too_many_items',
    ],
    [
      { message: 'TP_VALIDATION', code: 'P0001', details: 'item:3:name' },
      'validation',
      'item:3:name',
    ],
    [{ message: 'TP_NOT_FOUND', code: 'P0001', details: 'trip' }, 'not_found', 'trip'],
  ])('maps server error %o', async (failure, kind, reason) => {
    mock.fail(failure);
    const error = await rejection(repo.importMany('trip-1', [{ name: 'A', durationMinutes: 30 }]));
    expect(error.kind).toBe(kind);
    expect(error.reason).toBe(reason);
  });
});

describe('activitiesRepo without a Supabase configuration', () => {
  const notConfigured = createActivitiesRepo(() => {
    throw new Error('Supabase is not configured');
  });

  it.each([
    ['create', () => notConfigured.create('trip-1', { name: 'A', durationMinutes: 30 })],
    ['update', () => notConfigured.update('act-1', { name: 'A' })],
    ['delete', () => notConfigured.delete('act-1')],
    ['place', () => notConfigured.place('act-1', '2026-05-02', 600)],
    ['unplace', () => notConfigured.unplace('act-1')],
    ['importMany', () => notConfigured.importMany('trip-1', [{ name: 'A', durationMinutes: 30 }])],
  ])('%s rejects with AppError unknown / not_configured', async (_name, call) => {
    const error = await rejection(call());
    expect(error.kind).toBe('unknown');
    expect(error.reason).toBe('not_configured');
  });
});

import { AppError } from './errors';
import { argsOf, createMockSupabase, methods, type MockSupabase } from './testing/mockSupabase';
import { activityRow, tripRow } from './testing/fixtures';
import { createTripsRepo, type TripsRepo } from './tripsRepo';

const window = {
  startDate: '2026-05-01',
  startMinute: 600,
  endDate: '2026-05-03',
  endMinute: 1080,
};

let mock: MockSupabase;
let repo: TripsRepo;

beforeEach(() => {
  mock = createMockSupabase();
  repo = createTripsRepo(() => mock.client);
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

describe('tripsRepo.list', () => {
  it('selects summary columns sorted by start and maps to TripSummary', async () => {
    mock.ok([
      tripRow(),
      tripRow({ id: 'trip-2', start_date: '2026-06-01', end_date: '2026-06-01' }),
    ]);
    const trips = await repo.list();
    expect(trips).toEqual([
      { id: 'trip-1', name: 'רומא', window, dayCount: 3 },
      expect.objectContaining({ id: 'trip-2', dayCount: 1 }),
    ]);
    const [request] = mock.requests;
    expect(request?.target).toBe('trips');
    expect(argsOf(request, 'select')).toEqual([
      'id, name, start_date, start_minute, end_date, end_minute',
    ]);
    expect(request?.calls.filter((c) => c.method === 'order').map((c) => c.args[0])).toEqual([
      'start_date',
      'start_minute',
      'name',
    ]);
  });

  it('returns [] for no rows / null data', async () => {
    mock.ok(null);
    expect(await repo.list()).toEqual([]);
  });

  it('maps a network failure', async () => {
    mock.fail({ message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' }, 0);
    const error = await rejection(repo.list());
    expect(error.kind).toBe('network');
    expect(error.retryable).toBe(true);
  });

  it('42501 with no session (ran as anon) → auth_expired', async () => {
    mock.setSession(null);
    mock.fail({ message: 'permission denied for table trips', code: '42501' }, 401);
    const error = await rejection(repo.list());
    expect(error.kind).toBe('auth_expired');
    expect(error.code).toBe('42501');
  });

  it('42501 with a session → not_found', async () => {
    mock.fail({ message: 'permission denied for table trips', code: '42501' }, 403);
    expect((await rejection(repo.list())).kind).toBe('not_found');
  });

  it('42501 when getSession itself throws keeps not_found', async () => {
    mock.auth.getSession.mockRejectedValueOnce(new Error('storage broken'));
    mock.fail({ message: 'permission denied', code: '42501' }, 403);
    expect((await rejection(repo.list())).kind).toBe('not_found');
  });

  it('a thrown (rejected) request is normalized', async () => {
    mock.throws(new TypeError('Failed to fetch'));
    expect((await rejection(repo.list())).kind).toBe('network');
  });

  it('retries once on a deadlock, then succeeds', async () => {
    mock.fail({ message: 'deadlock detected', code: '40P01' }, 500).ok([tripRow()]);
    expect(await repo.list()).toHaveLength(1);
    expect(mock.requests).toHaveLength(2);
  });

  it('a second deadlock → unknown, retryable', async () => {
    mock
      .fail({ message: 'deadlock detected', code: '40P01' }, 500)
      .fail({ message: 'deadlock detected', code: '40P01' }, 500);
    const error = await rejection(repo.list());
    expect(error.kind).toBe('unknown');
    expect(error.retryable).toBe(true);
    expect(mock.requests).toHaveLength(2);
  });

  it('does not auto-retry lock or statement timeouts', async () => {
    mock.fail({ message: 'canceling statement due to statement timeout', code: '57014' }, 500);
    const error = await rejection(repo.list());
    expect(error.retryable).toBe(true);
    expect(mock.requests).toHaveLength(1);
  });
});

describe('tripsRepo.get', () => {
  it('fetches trip + activities in one request and maps both', async () => {
    mock.ok({
      ...tripRow(),
      activities: [
        activityRow(),
        activityRow({
          id: 'act-2',
          scheduled_date: '2026-05-02',
          start_minute: 540,
          bank_position: 2,
        }),
      ],
    });
    const result = await repo.get('trip-1');
    expect(result.trip).toEqual({ id: 'trip-1', name: 'רומא', window, colorCursor: 2 });
    expect(result.activities.map((a) => a.placement)).toEqual([
      null,
      { date: '2026-05-02', startMinute: 540 },
    ]);
    const [request] = mock.requests;
    expect(argsOf(request, 'select')).toEqual(['*, activities(*)']);
    expect(argsOf(request, 'eq')).toEqual(['id', 'trip-1']);
    expect(argsOf(request, 'order')).toEqual([
      'bank_position',
      { referencedTable: 'activities', ascending: true },
    ]);
    expect(methods(request).at(-1)).toBe('maybeSingle');
  });

  it('no row (missing or another user’s trip) → not_found / trip', async () => {
    mock.ok(null);
    const error = await rejection(repo.get('nope'));
    expect(error.kind).toBe('not_found');
    expect(error.reason).toBe('trip');
  });

  it('malformed uuid → validation', async () => {
    mock.fail({ message: 'invalid input syntax for type uuid: "x"', code: '22P02' });
    expect((await rejection(repo.get('x'))).kind).toBe('validation');
  });
});

describe('tripsRepo.create', () => {
  it('inserts writable columns only and returns the Trip', async () => {
    mock.ok(tripRow({ name: 'Trip', color_cursor: 0 }));
    const trip = await repo.create({ name: 'Trip', window });
    expect(trip).toEqual({ id: 'trip-1', name: 'Trip', window, colorCursor: 0 });
    const [request] = mock.requests;
    expect(argsOf(request, 'insert')).toEqual([
      {
        name: 'Trip',
        start_date: '2026-05-01',
        start_minute: 600,
        end_date: '2026-05-03',
        end_minute: 1080,
      },
    ]);
    expect(methods(request)).toEqual(['insert', 'select', 'single']);
  });

  it.each([
    [{ name: '', window }, 'name'],
    [{ name: '   ', window }, 'name'],
    [{ name: 'x'.repeat(51), window }, 'name'],
    [{ name: 'T', window: { ...window, startDate: '2026-02-30' } }, 'invalid_date'],
    [{ name: 'T', window: { ...window, startMinute: 15 } }, 'invalid_start_minute'],
    [{ name: 'T', window: { ...window, endMinute: 0 } }, 'invalid_end_minute'],
    [{ name: 'T', window: { ...window, endDate: '2026-04-30' } }, 'end_not_after_start'],
    [{ name: 'T', window: { ...window, endDate: '2026-07-30' } }, 'too_long'],
  ])('rejects invalid input locally without a request (%#)', async (input, reason) => {
    const error = await rejection(repo.create(input));
    expect(error.kind).toBe('validation');
    expect(error.reason).toBe(reason);
    expect(mock.requests).toHaveLength(0);
  });

  it('maps a DB check violation', async () => {
    mock.fail({
      message: 'new row for relation "trips" violates check constraint "trips_max_90_days"',
      code: '23514',
    });
    const error = await rejection(repo.create({ name: 'T', window }));
    expect(error.kind).toBe('validation');
    expect(error.reason).toBe('trips_max_90_days');
  });
});

describe('tripsRepo.updateWindow', () => {
  it('calls update_trip_window with snake_case args and maps { trip, moved_count }', async () => {
    const newWindow = { ...window, endDate: '2026-05-02' };
    mock.ok({ trip: tripRow({ name: 'New', end_date: '2026-05-02' }), moved_count: 2 });
    const result = await repo.updateWindow('trip-1', { name: 'New', window: newWindow });
    expect(result).toEqual({
      trip: { id: 'trip-1', name: 'New', window: newWindow, colorCursor: 2 },
      movedCount: 2,
    });
    const [request] = mock.requests;
    expect(request?.kind).toBe('rpc');
    expect(request?.target).toBe('update_trip_window');
    expect(request?.rpcArgs).toEqual({
      trip_id: 'trip-1',
      start_date: '2026-05-01',
      start_minute: 600,
      end_date: '2026-05-02',
      end_minute: 1080,
      name: 'New',
    });
  });

  it('validates locally first', async () => {
    const error = await rejection(
      repo.updateWindow('trip-1', { name: 'T', window: { ...window, endDate: '2026-04-01' } }),
    );
    expect(error.reason).toBe('end_not_after_start');
    expect(mock.requests).toHaveLength(0);
  });

  it.each([
    ['TP_NOT_FOUND', 'P0001', 'trip', 'not_found'],
    ['TP_VALIDATION', 'P0001', 'too_long', 'validation'],
  ])('maps %s', async (message, code, details, kind) => {
    mock.fail({ message, code, details, hint: '' });
    const error = await rejection(repo.updateWindow('trip-1', { name: 'T', window }));
    expect(error.kind).toBe(kind);
    expect(error.reason).toBe(details);
  });

  it('a malformed RPC result → unknown / invalid_response', async () => {
    mock.ok({ trip: null, moved_count: 0 });
    const error = await rejection(repo.updateWindow('trip-1', { name: 'T', window }));
    expect(error.kind).toBe('unknown');
    expect(error.reason).toBe('invalid_response');
  });
});

describe('tripsRepo.delete', () => {
  it('deletes by id', async () => {
    mock.ok(null, 204);
    await expect(repo.delete('trip-1')).resolves.toBeUndefined();
    const [request] = mock.requests;
    expect(request?.target).toBe('trips');
    expect(methods(request)).toEqual(['delete', 'eq']);
    expect(argsOf(request, 'eq')).toEqual(['id', 'trip-1']);
  });

  it('maps errors', async () => {
    mock.fail({ message: 'TypeError: Failed to fetch', code: '' }, 0);
    expect((await rejection(repo.delete('trip-1'))).kind).toBe('network');
  });
});

describe('tripsRepo without a Supabase configuration', () => {
  const notConfigured = createTripsRepo(() => {
    throw new Error('Supabase is not configured');
  });

  it.each([
    ['list', () => notConfigured.list()],
    ['get', () => notConfigured.get('trip-1')],
    ['create', () => notConfigured.create({ name: 'T', window })],
    ['updateWindow', () => notConfigured.updateWindow('trip-1', { name: 'T', window })],
    ['delete', () => notConfigured.delete('trip-1')],
  ])('%s rejects with AppError unknown / not_configured', async (_name, call) => {
    const error = await rejection(call());
    expect(error.kind).toBe('unknown');
    expect(error.reason).toBe('not_configured');
    expect(error.cause).toBeInstanceOf(Error);
  });
});

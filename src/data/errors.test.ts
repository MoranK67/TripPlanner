import {
  AuthApiError,
  AuthError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from '@supabase/supabase-js';
import {
  APP_ERROR_KINDS,
  AppError,
  fromAuthError,
  fromDbError,
  isAppError,
  isRetryableSqlState,
  toAppError,
  type AppErrorKind,
} from './errors';

describe('AppError', () => {
  it('carries kind, reason, retryable, code, status and cause with a safe message', () => {
    const cause = { message: 'raw db text' };
    const error = new AppError('validation', {
      reason: 'name',
      retryable: false,
      code: 'TP_VALIDATION',
      status: 400,
      cause,
      location: { tripIndex: 1, activityIndex: null },
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.kind).toBe('validation');
    expect(error.reason).toBe('name');
    expect(error.retryable).toBe(false);
    expect(error.code).toBe('TP_VALIDATION');
    expect(error.status).toBe(400);
    expect(error.cause).toBe(cause);
    expect(error.location).toEqual({ tripIndex: 1, activityIndex: null });
    expect(error.message).not.toContain('raw db text');
  });

  it('defaults optional fields', () => {
    const error = new AppError('unknown');
    expect(error.reason).toBeNull();
    expect(error.retryable).toBe(false);
    expect(error.code).toBeNull();
    expect(error.status).toBeNull();
    expect(error.location).toBeNull();
  });

  it('has a distinct message for every kind', () => {
    const messages = APP_ERROR_KINDS.map((kind) => new AppError(kind).message);
    expect(new Set(messages).size).toBe(APP_ERROR_KINDS.length);
  });

  it('isAppError', () => {
    expect(isAppError(new AppError('network'))).toBe(true);
    expect(isAppError(new Error('x'))).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});

describe('fromDbError — TP_* business errors (DB error contract)', () => {
  it.each<[string, string, string, AppErrorKind]>([
    ['TP_OVERLAP', '23P01', 'overlap', 'conflict_overlap'],
    ['TP_OUT_OF_RANGE', 'P0001', 'outside_trip_window', 'out_of_range'],
    ['TP_LIMIT', 'P0001', 'too_many_items', 'validation'],
    ['TP_VALIDATION', 'P0001', 'item:3:name', 'validation'],
    ['TP_VALIDATION', 'P0001', 'end_not_after_start', 'validation'],
    ['TP_NOT_FOUND', 'P0001', 'activity', 'not_found'],
    // Legacy SQLSTATE from before the hardening migration: still mapped by message.
    ['TP_NOT_FOUND', 'P0002', 'trip', 'not_found'],
  ])('%s (%s, %s) → %s', (message, code, details, kind) => {
    const error = fromDbError({ message, code, details, hint: 'English hint' }, 400);
    expect(error.kind).toBe(kind);
    expect(error.reason).toBe(details);
    expect(error.code).toBe(message);
    expect(error.status).toBe(400);
    expect(error.retryable).toBe(false);
  });

  it('maps an unknown TP code to unknown and keeps the reason', () => {
    const error = fromDbError({ message: 'TP_SOMETHING_NEW', code: 'P0001', details: 'x' });
    expect(error.kind).toBe('unknown');
    expect(error.reason).toBe('x');
  });

  it('treats empty details as no reason', () => {
    expect(fromDbError({ message: 'TP_OVERLAP', code: '23P01', details: '' }).reason).toBeNull();
  });

  it('TP_OVERLAP from a P0002/500 response still wins over status', () => {
    expect(fromDbError({ message: 'TP_OVERLAP', code: '23P01', details: null }, 500).kind).toBe(
      'conflict_overlap',
    );
  });
});

describe('fromDbError — plain write SQLSTATEs', () => {
  it('23P01 exclusion (activities_no_overlap) → conflict_overlap', () => {
    const error = fromDbError({
      code: '23P01',
      message: 'conflicting key value violates exclusion constraint "activities_no_overlap"',
      details: 'Key (trip_id, ...) conflicts with existing key',
    });
    expect(error.kind).toBe('conflict_overlap');
    expect(error.reason).toBe('overlap');
    expect(error.code).toBe('23P01');
  });

  it('23514 check violation → validation with the constraint as reason', () => {
    const error = fromDbError({
      code: '23514',
      message:
        'new row for relation "activities" violates check constraint "activities_name_length"',
    });
    expect(error.kind).toBe('validation');
    expect(error.reason).toBe('activities_name_length');
  });

  it('23514 activities_within_day (crossing midnight) → out_of_range (DEC-014)', () => {
    const error = fromDbError({
      code: '23514',
      message:
        'new row for relation "activities" violates check constraint "activities_within_day"',
    });
    expect(error.kind).toBe('out_of_range');
    expect(error.reason).toBe('activities_within_day');
  });

  it('23514 without a recognizable constraint → validation, no reason', () => {
    const error = fromDbError({ code: '23514', message: 'check failed' });
    expect(error.kind).toBe('validation');
    expect(error.reason).toBeNull();
  });

  it('23502 not-null → validation with the column as reason', () => {
    const error = fromDbError({
      code: '23502',
      message: 'null value in column "name" of relation "trips" violates not-null constraint',
    });
    expect(error.kind).toBe('validation');
    expect(error.reason).toBe('name');
  });

  it('23503 foreign key → not_found', () => {
    const error = fromDbError({
      code: '23503',
      message: 'insert violates foreign key constraint "activities_trip_id_fkey"',
    });
    expect(error.kind).toBe('not_found');
    expect(error.reason).toBe('activities_trip_id_fkey');
  });

  it.each(['22P02', '22007', '22008', '22003', '22001'])(
    '%s data exception → validation',
    (code) => {
      const error = fromDbError({ code, message: 'invalid input syntax for type uuid: "x"' });
      expect(error.kind).toBe('validation');
      expect(error.code).toBe(code);
      expect(error.retryable).toBe(false);
    },
  );

  it('42501 RLS / privilege → not_found (no_access), never revealing why', () => {
    const error = fromDbError(
      { code: '42501', message: 'new row violates row-level security policy for table "trips"' },
      403,
    );
    expect(error.kind).toBe('not_found');
    expect(error.reason).toBe('no_access');
    expect(error.message).not.toContain('row-level');
  });

  it.each(['40P01', '40001', '55P03', '57014', '57P01', '53300', '08006'])(
    '%s → unknown, retryable (decided by code, not HTTP status)',
    (code) => {
      const error = fromDbError({ code, message: 'deadlock detected' }, 500);
      expect(error.kind).toBe('unknown');
      expect(error.retryable).toBe(true);
      expect(error.code).toBe(code);
    },
  );

  it('other SQLSTATEs → unknown, not retryable', () => {
    const error = fromDbError({ code: '23505', message: 'duplicate key' }, 409);
    expect(error.kind).toBe('unknown');
    expect(error.retryable).toBe(false);
  });
});

describe('fromDbError — PostgREST codes', () => {
  it('PGRST116 (no row for single()) → not_found', () => {
    expect(fromDbError({ code: 'PGRST116', message: 'JSON object requested' }, 406).kind).toBe(
      'not_found',
    );
  });

  it.each(['PGRST301', 'PGRST302', 'PGRST303'])('%s (JWT) → auth_expired', (code) => {
    expect(fromDbError({ code, message: 'JWT expired' }, 401).kind).toBe('auth_expired');
  });

  it('PGRST300 (server JWT secret missing) is a configuration error → unknown', () => {
    const error = fromDbError({ code: 'PGRST300', message: 'Server lacks JWT secret' }, 500);
    expect(error.kind).toBe('unknown');
    expect(error.retryable).toBe(false);
  });

  it.each(['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'])(
    '%s (database unreachable) → unknown, retryable',
    (code) => {
      const error = fromDbError({ code, message: 'Could not connect' }, 503);
      expect(error.kind).toBe('unknown');
      expect(error.retryable).toBe(true);
    },
  );

  it.each(['PGRST202', 'PGRST204', 'PGRST100'])('%s (programming error) → unknown', (code) => {
    const error = fromDbError({ code, message: 'Could not find the function' }, 404);
    expect(error.kind).toBe('unknown');
    expect(error.retryable).toBe(false);
  });
});

describe('fromDbError — transport failures without a code', () => {
  it('postgrest-js fetch failure (status 0, empty code) → network, retryable', () => {
    const error = fromDbError(
      { message: 'TypeError: Failed to fetch', details: 'stack…', hint: '', code: '' },
      0,
    );
    expect(error.kind).toBe('network');
    expect(error.retryable).toBe(true);
    expect(error.code).toBeNull();
  });

  it.each(['FetchError: fetch failed', 'TypeError: Load failed'])(
    'network message "%s" without status → network, retryable',
    (message) => {
      const error = fromDbError({ message, code: '' });
      expect(error.kind).toBe('network');
      expect(error.retryable).toBe(true);
      expect(error.reason).toBeNull();
    },
  );

  it.each([
    ['TimeoutError: The request timed out after 15000 ms.', 0],
    ['TimeoutError: signal timed out', undefined],
  ])('timeout "%s" → network / timeout, retryable (not aborted)', (message, status) => {
    const error = fromDbError(
      { message, code: '', hint: 'Request was aborted (timeout or manual cancellation)' },
      status,
    );
    expect(error.kind).toBe('network');
    expect(error.reason).toBe('timeout');
    expect(error.retryable).toBe(true);
  });

  it('postgrest-js aborted request → network / aborted, not retryable', () => {
    const error = fromDbError(
      {
        message: 'AbortError: The user aborted a request.',
        details: '',
        hint: 'Request was aborted (timeout or manual cancellation)',
        code: '',
      },
      0,
    );
    expect(error.kind).toBe('network');
    expect(error.reason).toBe('aborted');
    expect(error.retryable).toBe(false);
  });

  it('401 without code → auth_expired', () => {
    expect(fromDbError({ message: 'Unauthorized', code: '' }, 401).kind).toBe('auth_expired');
  });

  it('429 → rate_limited', () => {
    expect(fromDbError({ message: 'Too many', code: '' }, 429).kind).toBe('rate_limited');
  });

  it('5xx without code (gateway) → unknown, retryable', () => {
    const error = fromDbError({ message: 'Bad gateway', code: undefined }, 502);
    expect(error.kind).toBe('unknown');
    expect(error.retryable).toBe(true);
  });

  it('anything else → unknown', () => {
    const error = fromDbError({ message: 'odd', code: null }, 418);
    expect(error.kind).toBe('unknown');
    expect(error.retryable).toBe(false);
  });

  it('tolerates a missing message', () => {
    expect(fromDbError({ code: '' } as unknown as { message: string }).kind).toBe('unknown');
  });
});

describe('isRetryableSqlState', () => {
  it.each([
    ['40P01', true],
    ['55P03', true],
    ['57014', true],
    ['55000', false],
    ['23514', false],
    ['P0001', false],
  ])('%s → %s', (code, expected) => {
    expect(isRetryableSqlState(code)).toBe(expected);
  });
});

describe('fromAuthError', () => {
  it.each<[string, AppErrorKind]>([
    ['invalid_credentials', 'invalid_credentials'],
    ['email_not_confirmed', 'invalid_credentials'],
    ['user_banned', 'invalid_credentials'],
    ['over_request_rate_limit', 'rate_limited'],
    ['over_email_send_rate_limit', 'rate_limited'],
    ['session_expired', 'auth_expired'],
    ['session_not_found', 'auth_expired'],
    ['refresh_token_not_found', 'auth_expired'],
    ['refresh_token_already_used', 'auth_expired'],
    ['bad_jwt', 'auth_expired'],
    ['validation_failed', 'validation'],
    ['email_address_invalid', 'validation'],
    ['weak_password', 'validation'],
    ['same_password', 'validation'],
    ['signup_disabled', 'unknown'],
  ])('code %s → %s', (code, kind) => {
    const error = fromAuthError(new AuthApiError('server text', 400, code));
    expect(error.kind).toBe(kind);
    expect(error.reason).toBe(code);
    expect(error.code).toBe(code);
    expect(error.message).not.toContain('server text');
  });

  it('AuthRetryableFetchError → network, retryable', () => {
    const error = fromAuthError(new AuthRetryableFetchError('Failed to fetch', 0));
    expect(error.kind).toBe('network');
    expect(error.retryable).toBe(true);
    expect(error.reason).toBeNull();
  });

  it('AuthRetryableFetchError from a timed-out request → network / timeout, retryable', () => {
    const error = fromAuthError(
      new AuthRetryableFetchError('The request timed out after 15000 ms.', 0),
    );
    expect(error.kind).toBe('network');
    expect(error.reason).toBe('timeout');
    expect(error.retryable).toBe(true);
  });

  it('AuthSessionMissingError → auth_expired', () => {
    expect(fromAuthError(new AuthSessionMissingError()).kind).toBe('auth_expired');
  });

  it('429 without code → rate_limited', () => {
    expect(fromAuthError(new AuthApiError('slow down', 429, undefined)).kind).toBe('rate_limited');
  });

  it('old servers: 400 "Invalid login credentials" without code → invalid_credentials', () => {
    const error = fromAuthError(new AuthApiError('Invalid login credentials', 400, undefined));
    expect(error.kind).toBe('invalid_credentials');
    expect(error.reason).toBe('invalid_credentials');
  });

  it('5xx → unknown, retryable', () => {
    const error = fromAuthError(new AuthApiError('oops', 500, 'unexpected_failure'));
    expect(error.kind).toBe('unknown');
    expect(error.retryable).toBe(true);
  });

  it('no status, no code → unknown', () => {
    const error = fromAuthError(new AuthError('weird'));
    expect(error.kind).toBe('unknown');
    expect(error.status).toBeNull();
  });
});

describe('toAppError', () => {
  it('passes AppErrors through unchanged', () => {
    const original = new AppError('validation');
    expect(toAppError(original)).toBe(original);
  });

  it('routes auth errors to the auth mapping', () => {
    expect(toAppError(new AuthApiError('x', 400, 'invalid_credentials')).kind).toBe(
      'invalid_credentials',
    );
  });

  it('routes PostgREST-shaped errors to the DB mapping, with status', () => {
    const error = toAppError({ message: 'TP_OVERLAP', code: '23P01', details: 'overlap' }, 400);
    expect(error.kind).toBe('conflict_overlap');
    expect(error.status).toBe(400);
  });

  it.each([
    new TypeError('Failed to fetch'),
    new TypeError('NetworkError when attempting to fetch'),
  ])('thrown fetch failure %s → network', (thrown) => {
    const error = toAppError(thrown);
    expect(error.kind).toBe('network');
    expect(error.retryable).toBe(true);
    expect(error.cause).toBe(thrown);
  });

  it('thrown AbortError (intentional cancel) → network / aborted, not retryable', () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    const error = toAppError(abort);
    expect(error.kind).toBe('network');
    expect(error.reason).toBe('aborted');
    expect(error.retryable).toBe(false);
    expect(error.cause).toBe(abort);
  });

  it('a DOMException AbortError is recognized too', () => {
    const error = toAppError(new DOMException('aborted', 'AbortError'));
    expect(error.reason).toBe('aborted');
  });

  it.each([new Error('boom'), 'string', null, undefined, 42])('%s → unknown', (value) => {
    const error = toAppError(value);
    expect(error.kind).toBe('unknown');
    expect(error.cause).toBe(value);
  });
});

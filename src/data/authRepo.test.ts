import { AuthApiError, AuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import {
  authEventFromSupabase,
  createAuthRepo,
  sessionFromSupabase,
  type AuthRepo,
} from './authRepo';
import { AppError } from './errors';
import { createMockSupabase, type MockSupabase } from './testing/mockSupabase';

let mock: MockSupabase;
let repo: AuthRepo;

beforeEach(() => {
  mock = createMockSupabase();
  repo = createAuthRepo(() => mock.client);
});

const supabaseSession = {
  access_token: 'secret-token',
  refresh_token: 'refresh',
  expires_at: 1_800_000_000,
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: 'user-1', email: 'owner@example.com' },
} as unknown as Session;

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

describe('sessionFromSupabase', () => {
  it('keeps only id, email and expiry (ms) — no tokens', () => {
    const session = sessionFromSupabase(supabaseSession);
    expect(session).toEqual({
      user: { id: 'user-1', email: 'owner@example.com' },
      expiresAt: 1_800_000_000_000,
    });
    expect(JSON.stringify(session)).not.toContain('secret-token');
  });

  it('null → null; missing email / expiry → null fields', () => {
    expect(sessionFromSupabase(null)).toBeNull();
    const bare = { user: { id: 'u' } } as unknown as Session;
    expect(sessionFromSupabase(bare)).toEqual({ user: { id: 'u', email: null }, expiresAt: null });
  });
});

describe('authEventFromSupabase', () => {
  it.each([
    ['INITIAL_SESSION', 'initial_session'],
    ['SIGNED_IN', 'signed_in'],
    ['SIGNED_OUT', 'signed_out'],
    ['TOKEN_REFRESHED', 'token_refreshed'],
    ['USER_UPDATED', 'user_updated'],
    ['PASSWORD_RECOVERY', 'password_recovery'],
    ['MFA_CHALLENGE_VERIFIED', 'signed_in'],
    ['SOMETHING_NEW', 'user_updated'],
  ] as const)('%s → %s', (event, expected) => {
    expect(authEventFromSupabase(event as never)).toBe(expected);
  });
});

describe('authRepo.signIn', () => {
  it('signs in with a trimmed email and returns the mapped session', async () => {
    mock.auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: supabaseSession, user: supabaseSession.user },
      error: null,
    });
    const session = await repo.signIn('  owner@example.com ', 'pw');
    expect(session.user.id).toBe('user-1');
    expect(mock.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'owner@example.com',
      password: 'pw',
    });
  });

  it('wrong password → invalid_credentials', async () => {
    mock.auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
    });
    const error = await rejection(repo.signIn('a@b.c', 'bad'));
    expect(error.kind).toBe('invalid_credentials');
  });

  it('rate limit → rate_limited', async () => {
    mock.auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: new AuthApiError('Too many', 429, 'over_request_rate_limit'),
    });
    expect((await rejection(repo.signIn('a@b.c', 'pw'))).kind).toBe('rate_limited');
  });

  it('offline → network', async () => {
    mock.auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    });
    expect((await rejection(repo.signIn('a@b.c', 'pw'))).kind).toBe('network');
  });

  it('a thrown error is normalized', async () => {
    mock.auth.signInWithPassword.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect((await rejection(repo.signIn('a@b.c', 'pw'))).kind).toBe('network');
  });

  it('success without a session → unknown / no_session', async () => {
    mock.auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: null,
    });
    const error = await rejection(repo.signIn('a@b.c', 'pw'));
    expect(error.kind).toBe('unknown');
    expect(error.reason).toBe('no_session');
  });
});

describe('authRepo.signOut', () => {
  it('signs out this device only (local scope)', async () => {
    await repo.signOut();
    expect(mock.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('ignores a returned error (the local session is removed anyway)', async () => {
    mock.auth.signOut.mockResolvedValueOnce({
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    } as never);
    await expect(repo.signOut()).resolves.toBeUndefined();
  });

  it('normalizes a thrown error', async () => {
    mock.auth.signOut.mockRejectedValueOnce(new Error('listener crashed'));
    expect((await rejection(repo.signOut())).kind).toBe('unknown');
  });
});

describe('authRepo.getSession', () => {
  it('returns the mapped session', async () => {
    mock.setSession(supabaseSession);
    expect((await repo.getSession())?.user.email).toBe('owner@example.com');
  });

  it('returns null when signed out', async () => {
    mock.setSession(null);
    expect(await repo.getSession()).toBeNull();
  });

  it('maps an error (e.g. expired refresh token)', async () => {
    mock.auth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found'),
    } as never);
    expect((await rejection(repo.getSession())).kind).toBe('auth_expired');
  });
});

describe('authRepo.onAuthChange', () => {
  it('maps events and sessions, and unsubscribes', () => {
    const unsubscribe = vi.fn();
    let emit: ((event: string, session: Session | null) => void) | undefined;
    mock.auth.onAuthStateChange.mockImplementationOnce((cb) => {
      emit = cb;
      return { data: { subscription: { unsubscribe } } };
    });
    const listener = vi.fn();
    const stop = repo.onAuthChange(listener);

    emit?.('SIGNED_IN', supabaseSession);
    emit?.('SIGNED_OUT', null);
    expect(listener).toHaveBeenNthCalledWith(1, 'signed_in', {
      user: { id: 'user-1', email: 'owner@example.com' },
      expiresAt: 1_800_000_000_000,
    });
    expect(listener).toHaveBeenNthCalledWith(2, 'signed_out', null);

    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('authRepo.requestPasswordReset', () => {
  it('sends the reset email with a trimmed address and optional redirect', async () => {
    await repo.requestPasswordReset(' owner@example.com', 'https://app.example/reset');
    expect(mock.auth.resetPasswordForEmail).toHaveBeenCalledWith('owner@example.com', {
      redirectTo: 'https://app.example/reset',
    });
    await repo.requestPasswordReset('owner@example.com');
    expect(mock.auth.resetPasswordForEmail).toHaveBeenLastCalledWith(
      'owner@example.com',
      undefined,
    );
  });

  it('email rate limit → rate_limited', async () => {
    mock.auth.resetPasswordForEmail.mockResolvedValueOnce({
      data: null,
      error: new AuthApiError('limit', 429, 'over_email_send_rate_limit'),
    } as never);
    expect((await rejection(repo.requestPasswordReset('a@b.c'))).kind).toBe('rate_limited');
  });
});

describe('authRepo.updatePassword', () => {
  it('updates the password', async () => {
    await repo.updatePassword('new-password');
    expect(mock.auth.updateUser).toHaveBeenCalledWith({ password: 'new-password' });
  });

  it('weak password → validation / weak_password', async () => {
    mock.auth.updateUser.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthApiError('weak', 422, 'weak_password'),
    } as never);
    const error = await rejection(repo.updatePassword('1'));
    expect(error.kind).toBe('validation');
    expect(error.reason).toBe('weak_password');
  });
});

describe('authRepo without a Supabase configuration', () => {
  const notConfigured = createAuthRepo(() => {
    throw new Error('Supabase is not configured');
  });

  it.each([
    ['signIn', () => notConfigured.signIn('a@b.c', 'pw')],
    ['signOut', () => notConfigured.signOut()],
    ['getSession', () => notConfigured.getSession()],
    ['requestPasswordReset', () => notConfigured.requestPasswordReset('a@b.c')],
    ['updatePassword', () => notConfigured.updatePassword('pw')],
  ])('%s rejects with AppError unknown / not_configured', async (_name, call) => {
    const error = await rejection(call());
    expect(error.kind).toBe('unknown');
    expect(error.reason).toBe('not_configured');
  });

  it('onAuthChange does not throw and reports initial_session without a session', async () => {
    const listener = vi.fn();
    expect(() => notConfigured.onAuthChange(listener)).not.toThrow();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledExactlyOnceWith('initial_session', null);
  });

  it('onAuthChange: unsubscribing before the microtask suppresses the call', async () => {
    const listener = vi.fn();
    const stop = notConfigured.onAuthChange(listener);
    stop();
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
  });
});

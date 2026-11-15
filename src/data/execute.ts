// Runs one PostgREST request and turns its `{ data, error }` result into data or an AppError.

import { AppError, toAppError, type DbErrorLike } from './errors';
import { readStoredAuthUser } from './storedSession';
import type { TypedSupabaseClient } from './supabaseClient';

/** What every postgrest-js builder resolves to (structurally). */
export interface DbResult<T> {
  data: T | null;
  error: DbErrorLike | null;
  status?: number;
}

/**
 * SQLSTATEs retried once automatically: the transaction was rolled back and the conflict is
 * short-lived, so an immediate retry is safe even for inserts (nothing was committed).
 * Lock/statement timeouts (55P03, 57014) are only flagged `retryable` — they already waited
 * seconds, so the caller decides.
 */
const AUTO_RETRY_CODES = new Set(['40P01', '40001']);
const AUTO_RETRY_DELAY_MS = 50;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hasSession(client: TypedSupabaseClient): Promise<boolean> {
  try {
    const { data } = await client.auth.getSession();
    return data.session !== null;
  } catch {
    return true; // Unknown: keep the original classification.
  }
}

async function attempt<R extends DbResult<unknown>>(
  request: () => PromiseLike<R>,
): Promise<R['data']> {
  let result: R;
  try {
    result = await request();
  } catch (thrown) {
    throw toAppError(thrown);
  }
  if (result.error) throw toAppError(result.error, result.status ?? null);
  return result.data;
}

/**
 * Executes `request` (a function so it can be rebuilt for a retry) and returns its data, or
 * throws an AppError. `null` data (e.g. `maybeSingle()` with no row) is returned as `null`.
 *
 * A 42501 (no privilege) normally means "not yours" → `not_found`; but if there is no session
 * at all, the request ran as `anon` (which has no grants), so it is reported as `auth_expired`.
 * Exception (M7.3b): if supabase-js still stores a session it merely could not refresh (offline
 * or auth server unreachable, e.g. right after reconnecting), the request ran as `anon` only
 * because the refresh is pending. That is a retryable `network` error with reason
 * `session_not_refreshed`, not `auth_expired` — the UI signs out on `auth_expired`, which would
 * delete a still-valid refresh token.
 */
export async function runDb<R extends DbResult<unknown>>(
  client: TypedSupabaseClient,
  request: () => PromiseLike<R>,
): Promise<R['data']> {
  try {
    try {
      return await attempt(request);
    } catch (error) {
      if (error instanceof AppError && error.code !== null && AUTO_RETRY_CODES.has(error.code)) {
        await delay(AUTO_RETRY_DELAY_MS);
        return await attempt(request);
      }
      throw error;
    }
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === '42501' && !(await hasSession(client))) {
      if (readStoredAuthUser() !== null) {
        throw new AppError('network', {
          reason: 'session_not_refreshed',
          retryable: true,
          code: appError.code,
          status: appError.status,
          cause: appError.cause,
        });
      }
      throw new AppError('auth_expired', {
        code: appError.code,
        status: appError.status,
        cause: appError.cause,
      });
    }
    throw appError;
  }
}

/**
 * Wraps the client getter so a missing configuration (no URL / publishable key) surfaces as an
 * AppError (`unknown`, reason `not_configured`) instead of a plain Error — repositories only
 * ever reject with AppError.
 */
export function safeClientGetter(getClient: () => TypedSupabaseClient): () => TypedSupabaseClient {
  return () => {
    try {
      return getClient();
    } catch (cause) {
      throw new AppError('unknown', { reason: 'not_configured', cause });
    }
  };
}

/** Like `runDb`, but a `null` result is a `not_found` error with the given reason. */
export async function runDbRequired<R extends DbResult<unknown>>(
  client: TypedSupabaseClient,
  request: () => PromiseLike<R>,
  notFoundReason: 'trip' | 'activity',
): Promise<NonNullable<R['data']>> {
  const data = await runDb(client, request);
  if (data === null || data === undefined) {
    throw new AppError('not_found', { reason: notFoundReason });
  }
  return data;
}

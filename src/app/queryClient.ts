import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isAppError } from '@/data';
import { isAbortedError } from '@/i18n/errors';

// Retry policy (UX-1). TanStack Query is the ONLY retry layer for reads: postgrest-js's own
// retries are disabled in the Supabase client (`db.retry: false`, src/data/supabaseClient.ts).
// Mutations are never retried automatically (`retry: false`); the data layer's single 50 ms
// re-run of a rolled-back deadlock/serialization failure (40P01/40001, src/data/execute.ts) is
// the only automatic repeat of a write, and it is safe because nothing was committed.

/** Queries retry at most this many times, and only for errors marked `retryable`. */
export const MAX_QUERY_RETRIES = 2;

/** Delay before retry number `failureCount + 1`: 1 s, then 2 s (a dead server surfaces in ~3 s). */
export function queryRetryDelay(failureCount: number): number {
  return Math.min(1_000 * 2 ** failureCount, 4_000);
}

/** True when the browser reports no network (`navigator.onLine === false`). */
function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Retry only transient failures; validation / not-found / auth errors will not fix themselves.
 * Offline, nothing is retried: the error surfaces at once (FR-8.3: the UI says so).
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isOffline()) return false;
  if (isAbortedError(error)) return false;
  if (isAppError(error)) return error.retryable && failureCount < MAX_QUERY_RETRIES;
  return failureCount < 1;
}

/** What is safe to log about an error: the AppError kind or the error's name, never its data. */
function errorLabel(error: unknown): string {
  if (isAppError(error)) return error.kind;
  if (error instanceof Error) return error.name;
  return typeof error;
}

function logError(error: unknown, source: string) {
  // Cancelled requests are not failures; an expired session is handled by AuthProvider.
  if (isAbortedError(error)) return;
  if (isAppError(error) && error.kind === 'auth_expired') return;
  console.error(`[${source}] request failed`, errorLabel(error));
}

export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({ onError: (error) => logError(error, 'query') }),
    mutationCache: new MutationCache({ onError: (error) => logError(error, 'mutation') }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: shouldRetryQuery,
        retryDelay: queryRetryDelay,
        // 'offlineFirst': run the request even when offline instead of pausing silently, so an
        // offline read fails fast with a `network` error (no retry offline, see above).
        networkMode: 'offlineFirst',
        refetchOnWindowFocus: true, // keeps devices in sync (PROJECT_PLAN §4.7)
      },
      // Never retried automatically. 'offlineFirst' so an offline write fails at once with a
      // `network` error instead of pausing with the dialog stuck in "saving" (NFR-1, FR-8.3).
      mutations: { retry: false, networkMode: 'offlineFirst' },
    },
  });
}

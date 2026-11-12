import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isAppError } from '@/data';
import { isAbortedError } from '@/i18n/errors';

/** Queries retry at most this many times, and only for errors marked `retryable`. */
export const MAX_QUERY_RETRIES = 2;

/** Retry only transient failures; validation / not-found / auth errors will not fix themselves. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
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
        refetchOnWindowFocus: true, // keeps devices in sync (PROJECT_PLAN §4.7)
      },
      mutations: { retry: false },
    },
  });
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { createTimeoutFetch } from './timeoutFetch';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/** Supabase client typed with the generated schema (`database.types.ts`). Internal to src/data. */
export type TypedSupabaseClient = SupabaseClient<Database>;

let client: TypedSupabaseClient | null = null;

/** `fetch` with the request deadline; shared by the Supabase client and the health check. */
const timeoutFetch = createTimeoutFetch();

export function isSupabaseConfigured(): boolean {
  return Boolean(url && publishableKey);
}

/**
 * Client options. `db.retry: false` turns off postgrest-js's built-in retries (3x with
 * 1/2/4 s backoff for GET/HEAD on network errors, 503 and 520). Read retries live in exactly one
 * layer, TanStack Query (`shouldRetryQuery` in src/app/queryClient.ts), driven by
 * `AppError.retryable`; stacking both made a dead connection take ~25 s to surface (UX-1).
 * Writes were never retried by postgrest-js (POST/PATCH/DELETE are not idempotent).
 *
 * `global.fetch` gives every request a deadline (`REQUEST_TIMEOUT_MS`, DATA-1): a timeout becomes
 * a retryable `network` AppError instead of a request that hangs forever. supabase-js hands the
 * same fetch to the Auth client, so token refreshes get the deadline too — deliberately: a
 * refresh runs under the auth lock, and every PostgREST request first waits for that lock
 * (`getSession`) to read the access token, so a hung refresh would stall all requests. A timed-out
 * refresh is an `AuthRetryableFetchError`, which keeps the session and retries later.
 */
export const SUPABASE_CLIENT_OPTIONS = {
  auth: { persistSession: true, autoRefreshToken: true },
  db: { retry: false },
  global: { fetch: timeoutFetch },
} as const;

/**
 * The single Supabase client. Internal to src/data — never export it from the
 * data layer's public index (PROJECT_PLAN §4.3).
 */
export function getSupabase(): TypedSupabaseClient {
  if (!url || !publishableKey) {
    throw new Error(
      'Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local (see .env.example).',
    );
  }
  client ??= createClient<Database>(url, publishableKey, SUPABASE_CLIENT_OPTIONS);
  return client;
}

/** Lightweight reachability check against the Supabase Auth health endpoint. */
export async function checkServerConnection(): Promise<boolean> {
  if (!url || !publishableKey) return false;
  try {
    const res = await timeoutFetch(`${url}/auth/v1/health`, {
      headers: { apikey: publishableKey },
    });
    return res.ok;
  } catch {
    return false;
  }
}

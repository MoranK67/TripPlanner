// Read-only access to the session supabase-js persisted in local storage (M7.3b, FR-8.3).
//
// Why: after the access token expires (~1 h) supabase-js must refresh it before it reports a
// session. Offline the refresh fails with a retryable network error; supabase-js then KEEPS the
// stored session (auth-js 2.119 `_callRefreshToken` removes it only for a non-retryable error,
// i.e. a rejected refresh token) but reports `INITIAL_SESSION` with `null`. Reading storage
// directly lets the app tell "a session is stored but could not be refreshed" apart from
// "signed out", and pick the persisted query cache of that user for offline read-only display.
//
// Threat model:
// - The stored user is NOT authenticated. It is unvalidated data from this device's own local
//   storage; anyone who can edit it can already read the persisted query cache in the same
//   storage directly. It is used only to select that user's persisted cache (buster
//   `<version>:<userId>`, DEC-037) for display. It is never sent to the server, never used for
//   a write and never treated as "signed in"; every server request still needs a real session
//   (RLS), and writes are disabled while the app runs on a stored-only session (useCanEdit).
// - Tokens never leave this module: the parsed object is reduced to `{ id, email }` at once and
//   nothing here logs.
// - If the refresh token is rejected, supabase-js deletes the stored session (and emits
//   SIGNED_OUT), so this reader then returns null and the UI falls back to signed-out.

/** The user of a stored (possibly expired, unverified) session. Read-only display only. */
export interface StoredAuthUser {
  id: string;
  email: string | null;
}

/** Minimal storage surface (window.localStorage in the browser). */
export interface ReadableStorage {
  getItem(key: string): string | null;
}

/**
 * Storage key supabase-js 2.x uses by default: `sb-<first label of the project host>-auth-token`
 * (SupabaseClient.ts). Pinned against the real client in storedSession.test.ts. Null for an
 * invalid URL.
 */
export function authStorageKey(supabaseUrl: string): string | null {
  try {
    const host = new URL(supabaseUrl.trim()).hostname;
    if (!host) return null;
    return `sb-${host.split('.')[0]}-auth-token`;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extracts `{ id, email }` from the raw stored value. Mirrors auth-js `_isValidSession`
 * (access_token, refresh_token and expires_at present) so that whatever supabase-js would discard
 * as invalid is also not reported here; additionally requires a non-empty refresh token (nothing
 * to resume without it) and a user id. Returns null for anything else, including bad JSON.
 */
export function parseStoredSessionUser(raw: string | null): StoredAuthUser | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (!('access_token' in value) || !('expires_at' in value)) return null;
  if (typeof value.refresh_token !== 'string' || value.refresh_token === '') return null;
  const user = value.user;
  if (!isRecord(user)) return null;
  if (typeof user.id !== 'string' || user.id.trim() === '') return null;
  return {
    id: user.id,
    email: typeof user.email === 'string' && user.email !== '' ? user.email : null,
  };
}

function defaultStorage(): ReadableStorage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null; // Access can throw (e.g. storage disabled by privacy settings).
  }
}

export interface StoredSessionSource {
  /** Supabase project URL; defaults to VITE_SUPABASE_URL. */
  url?: string | null;
  /** Defaults to window.localStorage (null when unavailable). */
  storage?: ReadableStorage | null;
}

/** Reads the user of the session stored by supabase-js, without validating or refreshing it. */
export function readStoredAuthUser(source: StoredSessionSource = {}): StoredAuthUser | null {
  const url = source.url !== undefined ? source.url : import.meta.env.VITE_SUPABASE_URL;
  if (!url) return null;
  const key = authStorageKey(url);
  if (key === null) return null;
  const storage = source.storage !== undefined ? source.storage : defaultStorage();
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  return parseStoredSessionUser(raw);
}

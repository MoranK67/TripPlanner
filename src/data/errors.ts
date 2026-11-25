// AppError: the only error type the data layer throws (PROJECT_PLAN §4.6, DEVELOPMENT_GUIDELINES §8).
//
// Raw server errors never reach the UI as text: `message` is a fixed English sentence per kind
// (for logs), the UI maps `kind` (and optionally `reason`) to Hebrew. The original error is kept
// in `cause` for logging only.
//
// Mapping follows the DB error contract in the header of
// supabase/migrations/20261112140400_m1_hardening.sql (DEC-020):
//   - TP_* codes travel in `message`; `details` carries a machine-readable reason;
//   - plain table writes surface SQLSTATEs in `code`;
//   - retry decisions use the SQLSTATE, never the HTTP status (PostgREST maps 40*/55*/57* to 500).

import { isAuthError, isAuthWeakPasswordError, type AuthError } from '@supabase/supabase-js';

/**
 * Error taxonomy. §4.6 kinds plus `invalid_credentials` and `rate_limited`, which the login and
 * password-reset screens need to tell apart from a generic failure.
 */
export const APP_ERROR_KINDS = [
  'network',
  'auth_expired',
  'invalid_credentials',
  'rate_limited',
  'conflict_overlap',
  'out_of_range',
  'validation',
  'not_found',
  'unknown',
] as const;

export type AppErrorKind = (typeof APP_ERROR_KINDS)[number];

/**
 * Why Supabase Auth rejected a new password (`weak_password`, UX-9): too short, missing required
 * character types, or found in known data breaches. Mirrors supabase-js `WeakPasswordReasons`.
 */
export const WEAK_PASSWORD_REASONS = ['length', 'characters', 'pwned'] as const;

export type WeakPasswordReason = (typeof WEAK_PASSWORD_REASONS)[number];

const KIND_MESSAGES: Record<AppErrorKind, string> = {
  network: 'The server could not be reached.',
  auth_expired: 'The session has expired or is missing.',
  invalid_credentials: 'The email or password is incorrect.',
  rate_limited: 'Too many requests; try again later.',
  conflict_overlap: 'The activity overlaps another activity.',
  out_of_range: 'The activity is outside the trip window.',
  validation: 'The data is invalid.',
  not_found: 'The item does not exist or is not accessible.',
  unknown: 'An unexpected error occurred.',
};

/**
 * Where in a multi-item request the error happened (`backupRepo.importAll`): 0-based indexes into
 * the array that was passed in. `activityIndex` is `null` for a trip-level problem.
 */
export interface AppErrorLocation {
  tripIndex: number;
  activityIndex: number | null;
}

export interface AppErrorOptions {
  /**
   * Machine-readable detail, e.g. the TP `details` value (`'outside_trip_window'`,
   * `'item:3:name'`, a `TripWindowError`), a constraint name or an auth error code.
   */
  reason?: string | null;
  /** True if trying again unchanged may succeed (network, deadlock, lock/statement timeout). */
  retryable?: boolean;
  /** Source code: the TP_* code, SQLSTATE, PGRST code or auth error code. */
  code?: string | null;
  /** HTTP status of the failed request, when known (0 = no response). */
  status?: number | null;
  /** The original error, for logs only. */
  cause?: unknown;
  /** Which trip / activity of a batch request failed, when known. */
  location?: AppErrorLocation | null;
  /** For reason `weak_password`: which password rules failed (may be empty). */
  weakPasswordReasons?: readonly WeakPasswordReason[];
}

export class AppError extends Error {
  override readonly name = 'AppError';
  readonly kind: AppErrorKind;
  readonly reason: string | null;
  readonly retryable: boolean;
  readonly code: string | null;
  readonly status: number | null;
  readonly location: AppErrorLocation | null;
  /** For reason `weak_password`: which password rules failed; empty when unknown or other. */
  readonly weakPasswordReasons: readonly WeakPasswordReason[];

  constructor(kind: AppErrorKind, options: AppErrorOptions = {}) {
    super(KIND_MESSAGES[kind], { cause: options.cause });
    this.kind = kind;
    this.reason = options.reason ?? null;
    this.retryable = options.retryable ?? false;
    this.code = options.code ?? null;
    this.status = options.status ?? null;
    this.location = options.location ?? null;
    this.weakPasswordReasons = options.weakPasswordReasons ?? [];
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

// --- PostgREST / Postgres -------------------------------------------------------------------

/** Shape of `PostgrestError` (and of the error object of any PostgREST response). */
export interface DbErrorLike {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
}

const TP_KINDS: Readonly<Record<string, AppErrorKind>> = {
  TP_OVERLAP: 'conflict_overlap',
  TP_OUT_OF_RANGE: 'out_of_range',
  TP_LIMIT: 'validation',
  TP_VALIDATION: 'validation',
  TP_NOT_FOUND: 'not_found',
};

const TP_MESSAGE = /^TP_[A-Z_]+$/;

/**
 * SQLSTATEs after which the transaction was rolled back and a retry may succeed:
 * class 08 connection, 40 transaction rollback (40001 serialization, 40P01 deadlock),
 * 53 insufficient resources, 55P03 lock_timeout, class 57 operator intervention (57014
 * statement_timeout, 57P01 admin shutdown, …).
 */
export function isRetryableSqlState(code: string): boolean {
  return /^(08|40|53|57)/.test(code) || code === '55P03';
}

/** Network failure texts from browsers / Node / React Native fetch implementations. */
const NETWORK_MESSAGE =
  /failed to fetch|networkerror|load failed|fetch failed|network request failed|err_network|econnrefused|econnreset|enotfound|etimedout|timeouterror/i;

function isNetworkMessage(message: string): boolean {
  return NETWORK_MESSAGE.test(message);
}

/** postgrest-js reports an aborted request as `AbortError: …` with status 0. */
function isAbortMessage(message: string): boolean {
  return /^aborterror\b/i.test(message);
}

/**
 * The request deadline passed (`RequestTimeoutError` from timeoutFetch.ts, or a DOM
 * `TimeoutError` from `AbortSignal.timeout`). postgrest-js reports it as `TimeoutError: …`.
 */
function isTimeoutMessage(message: string): boolean {
  return /^timeouterror\b/i.test(message);
}

/**
 * A timeout is a network failure the user must hear about, and trying again may succeed — unlike
 * an intentional cancel, which is silent.
 */
function timeoutError(options: AppErrorOptions): AppError {
  return new AppError('network', { ...options, reason: 'timeout', retryable: true });
}

/**
 * An intentional cancel (AbortController, e.g. TanStack Query cancelling a stale query): kind
 * `network` with reason `aborted` and not retryable, so hooks can recognize and ignore it.
 */
function abortError(options: AppErrorOptions): AppError {
  return new AppError('network', { ...options, reason: 'aborted', retryable: false });
}

/** `violates check constraint "x"` / `exclusion constraint "x"` / `foreign key constraint "x"`. */
function constraintName(message: string): string | null {
  return /constraint "([^"]+)"/.exec(message)?.[1] ?? null;
}

/** `null value in column "x" of relation …`. */
function columnName(message: string): string | null {
  return /column "([^"]+)"/.exec(message)?.[1] ?? null;
}

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Maps a PostgREST error (plus the HTTP status of the response, if known) to an AppError. */
export function fromDbError(error: DbErrorLike, status?: number | null): AppError {
  const message = typeof error.message === 'string' ? error.message : '';
  const code = nonEmpty(error.code);
  const base = { status: status ?? null, cause: error };

  // 1. Business errors raised by RPCs and triggers: message = code, details = reason.
  if (TP_MESSAGE.test(message)) {
    return new AppError(TP_KINDS[message] ?? 'unknown', {
      ...base,
      code: message,
      reason: nonEmpty(error.details),
    });
  }

  // 2. Postgres SQLSTATEs from plain table writes.
  if (code !== null && !code.startsWith('PGRST')) {
    const withCode = { ...base, code };
    if (code === '23P01') {
      // The only exclusion constraint is activities_no_overlap.
      return new AppError('conflict_overlap', { ...withCode, reason: 'overlap' });
    }
    if (code === '23514') {
      const constraint = constraintName(message);
      // Crossing midnight is out_of_range in the domain (DEC-014).
      const kind = constraint === 'activities_within_day' ? 'out_of_range' : 'validation';
      return new AppError(kind, { ...withCode, reason: constraint });
    }
    if (code === '23502') {
      return new AppError('validation', { ...withCode, reason: columnName(message) });
    }
    if (code === '23503') {
      return new AppError('not_found', { ...withCode, reason: constraintName(message) });
    }
    if (code.startsWith('22')) {
      // Data exceptions: malformed uuid/number/date (22P02, 22007, 22008), out of range (22003)…
      return new AppError('validation', withCode);
    }
    if (code === '42501') {
      // RLS violation or missing privilege: treated as "no access", never revealed as such.
      return new AppError('not_found', { ...withCode, reason: 'no_access' });
    }
    if (isRetryableSqlState(code)) {
      return new AppError('unknown', { ...withCode, retryable: true });
    }
    return new AppError('unknown', withCode);
  }

  // 3. PostgREST's own errors.
  if (code !== null) {
    const withCode = { ...base, code };
    if (code === 'PGRST116') return new AppError('not_found', withCode);
    // PGRST301–303: JWT invalid, missing or expired. PGRST300 (JWT secret missing) is a server
    // configuration error, so it falls through to unknown.
    if (/^PGRST30[1-3]$/.test(code)) return new AppError('auth_expired', withCode);
    // PGRST000–003: PostgREST cannot reach the database / pool timeout.
    if (/^PGRST00\d$/.test(code)) return new AppError('unknown', { ...withCode, retryable: true });
    return new AppError('unknown', withCode);
  }

  // 4. No code: transport-level failures (postgrest-js reports a failed fetch with status 0).
  if (isTimeoutMessage(message)) return timeoutError(base);
  if (isAbortMessage(message)) return abortError(base);
  if (status === 0 || isNetworkMessage(message)) {
    return new AppError('network', { ...base, retryable: true });
  }
  if (status === 401) return new AppError('auth_expired', base);
  if (status === 429) return new AppError('rate_limited', base);
  if (typeof status === 'number' && status >= 500) {
    return new AppError('unknown', { ...base, retryable: true });
  }
  return new AppError('unknown', base);
}

// --- Supabase Auth --------------------------------------------------------------------------

/** These codes all map to `invalid_credentials`; the specific code is kept in `reason`. */
const INVALID_CREDENTIAL_CODES = new Set([
  'invalid_credentials',
  'email_not_confirmed',
  'user_not_found',
  'user_banned',
]);

const RATE_LIMIT_CODES = new Set([
  'over_request_rate_limit',
  'over_email_send_rate_limit',
  'over_sms_send_rate_limit',
]);

const SESSION_CODES = new Set([
  'session_expired',
  'session_not_found',
  'refresh_token_not_found',
  'refresh_token_already_used',
  'bad_jwt',
  'no_authorization',
  'reauthentication_needed',
]);

const SESSION_ERROR_NAMES = new Set([
  'AuthSessionMissingError',
  'AuthInvalidJwtError',
  'AuthInvalidTokenResponseError',
]);

const AUTH_VALIDATION_CODES = new Set([
  'validation_failed',
  'bad_json',
  'email_address_invalid',
  'weak_password',
  'same_password',
]);

/** The known, de-duplicated `reasons` of an `AuthWeakPasswordError`; empty for anything else. */
function weakPasswordReasonsOf(error: AuthError): WeakPasswordReason[] {
  if (!isAuthWeakPasswordError(error) || !Array.isArray(error.reasons)) return [];
  const reasons: readonly unknown[] = error.reasons;
  return WEAK_PASSWORD_REASONS.filter((reason) => reasons.includes(reason));
}

/** Maps a Supabase Auth error to an AppError. */
export function fromAuthError(error: AuthError): AppError {
  const code = nonEmpty(error.code);
  const status = typeof error.status === 'number' ? error.status : null;
  const base = { code, status, cause: error, reason: code };

  if (error.name === 'AuthRetryableFetchError' || status === 0) {
    // auth-js keeps only the message of the failed fetch; timeoutFetch's says "timed out".
    if (/\btimed out\b/i.test(error.message)) return timeoutError(base);
    return new AppError('network', { ...base, retryable: true });
  }
  if (code !== null) {
    if (INVALID_CREDENTIAL_CODES.has(code)) return new AppError('invalid_credentials', base);
    if (RATE_LIMIT_CODES.has(code)) return new AppError('rate_limited', base);
    if (SESSION_CODES.has(code)) return new AppError('auth_expired', base);
    if (code === 'weak_password') {
      return new AppError('validation', {
        ...base,
        weakPasswordReasons: weakPasswordReasonsOf(error),
      });
    }
    if (AUTH_VALIDATION_CODES.has(code)) return new AppError('validation', base);
  }
  if (SESSION_ERROR_NAMES.has(error.name)) return new AppError('auth_expired', base);
  if (status === 429) return new AppError('rate_limited', base);
  // Older Auth servers report wrong credentials without a code.
  if (status === 400 && /invalid login credentials/i.test(error.message)) {
    return new AppError('invalid_credentials', { ...base, reason: 'invalid_credentials' });
  }
  if (status !== null && status >= 500) {
    return new AppError('unknown', { ...base, retryable: true });
  }
  return new AppError('unknown', base);
}

// --- Anything -------------------------------------------------------------------------------

function isDbErrorLike(value: unknown): value is DbErrorLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { message?: unknown }).message === 'string' &&
    'code' in value
  );
}

/**
 * Normalizes any thrown or returned error to an AppError. AppErrors pass through unchanged.
 * `status` is the HTTP status of the PostgREST response the error came with, if any.
 */
export function toAppError(error: unknown, status?: number | null): AppError {
  if (isAppError(error)) return error;
  if (isAuthError(error)) return fromAuthError(error);
  // Before the DB check: a DOMException has `message` and a numeric `code`, and is not an
  // Error subclass in every runtime.
  const name =
    typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : null;
  if (name === 'TimeoutError') return timeoutError({ cause: error, status: status ?? null });
  if (name === 'AbortError') return abortError({ cause: error, status: status ?? null });
  if (isDbErrorLike(error)) return fromDbError(error, status);
  if (error instanceof Error && isNetworkMessage(error.message)) {
    return new AppError('network', { retryable: true, cause: error, status: status ?? null });
  }
  return new AppError('unknown', { cause: error, status: status ?? null });
}

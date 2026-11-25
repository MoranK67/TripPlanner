// Maps AppError kinds (and some reasons) to Hebrew messages (DEVELOPMENT_GUIDELINES §8).
// Raw server text never reaches the user: anything unknown becomes `errors.kinds.unknown`.

import type { TFunction } from 'i18next';
import { isAppError, toAppError, type AppErrorKind, type WeakPasswordReason } from '@/data';

/**
 * Reasons with a more specific message than their kind. Keys live under `errors.reasons.*`.
 * Auth codes come from Supabase (`AppError.reason` keeps the auth error code).
 */
const REASON_MESSAGES: Readonly<Partial<Record<string, string>>> = {
  email_not_confirmed: 'errors.reasons.email_not_confirmed',
  user_banned: 'errors.reasons.user_banned',
  over_email_send_rate_limit: 'errors.reasons.over_email_send_rate_limit',
  weak_password: 'errors.reasons.weak_password',
  same_password: 'errors.reasons.same_password',
  email_address_invalid: 'errors.reasons.email_address_invalid',
  // M7.3b: a stored session could not be renewed yet (offline / right after reconnecting).
  session_not_refreshed: 'errors.reasons.session_not_refreshed',
};

/**
 * True for an intentional cancel (TanStack Query aborting a stale request): the data layer
 * reports it as kind `network` with reason `aborted`. Never show or log these as failures.
 */
export function isAbortedError(error: unknown): boolean {
  return isAppError(error) && error.reason === 'aborted';
}

/** Hebrew message for any thrown value. Uses the reason when it has its own message. */
export function errorMessage(error: unknown, t: TFunction): string {
  const appError = toAppError(error);
  // UX-9: name the password rules that failed; the generic reason text is only a fallback.
  if (appError.reason === 'weak_password' && appError.weakPasswordReasons.length > 0) {
    return appError.weakPasswordReasons
      .map((rule) => t(`errors.weakPassword.${rule satisfies WeakPasswordReason}`))
      .join(' ');
  }
  const reasonKey = appError.reason ? REASON_MESSAGES[appError.reason] : undefined;
  if (reasonKey) return t(reasonKey);
  return t(`errors.kinds.${appError.kind satisfies AppErrorKind}`);
}

/**
 * True when a write hit the request deadline (AppError `network` / reason `timeout`, DEC-032):
 * the server may still have committed it, so the outcome is unknown (UX-3).
 */
export function isTimeoutError(error: unknown): boolean {
  return isAppError(error) && error.kind === 'network' && error.reason === 'timeout';
}

/**
 * Hebrew message for a failed **create** (new trip / new activity). After a timeout the item may
 * have been saved anyway, so the message asks the user to check the list before trying again;
 * the create hooks refetch that list even on error, so a saved item shows up (UX-3).
 */
export function createErrorMessage(error: unknown, t: TFunction): string {
  return isTimeoutError(error) ? t('errors.createUncertain') : errorMessage(error, t);
}

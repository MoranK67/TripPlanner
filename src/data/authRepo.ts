// authRepo (PROJECT_PLAN §7.2, FR-1.x). Email + password only; sign-ups are disabled (FR-1.3),
// so there is deliberately no signUp. Supabase types do not leak: callers get AuthSession.

import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { AppError, toAppError } from './errors';
import { safeClientGetter } from './execute';
import { getSupabase, type TypedSupabaseClient } from './supabaseClient';

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface AuthSession {
  user: AuthUser;
  /** When the access token expires (epoch milliseconds); supabase-js refreshes it itself. */
  expiresAt: number | null;
}

export type AuthEvent =
  | 'initial_session'
  | 'signed_in'
  | 'signed_out'
  | 'token_refreshed'
  | 'user_updated'
  | 'password_recovery';

export type AuthChangeListener = (event: AuthEvent, session: AuthSession | null) => void;

export interface AuthRepo {
  /**
   * Throws `invalid_credentials`, `rate_limited`, `network`, … For `invalid_credentials` the
   * auth code stays in `reason` (`invalid_credentials`, `email_not_confirmed`, `user_not_found`,
   * `user_banned`), so the UI may word an unconfirmed or banned account differently.
   */
  signIn(email: string, password: string): Promise<AuthSession>;
  /**
   * Signs out this device only. Never fails because of the server: the local session is removed
   * even offline. Rejects only if the client is not configured.
   */
  signOut(): Promise<void>;
  /** The stored session (refreshed if needed), or null when signed out. */
  getSession(): Promise<AuthSession | null>;
  /**
   * Subscribes to auth changes; the listener is called right away with `initial_session`.
   * Never throws: without a Supabase configuration it reports `initial_session` with no session.
   * Do not await other repository calls inside the listener (supabase-js holds a lock while it
   * runs); schedule them instead. Returns an unsubscribe function.
   */
  onAuthChange(listener: AuthChangeListener): () => void;
  /**
   * Sends a reset link (FR-1.5). Succeeds for unknown emails too (no account enumeration).
   * `redirectTo` must be an allowed redirect URL in the Supabase dashboard.
   */
  requestPasswordReset(email: string, redirectTo?: string): Promise<void>;
  /** Sets a new password for the signed-in user (after following the reset link). */
  updatePassword(newPassword: string): Promise<void>;
}

export function sessionFromSupabase(session: Session | null): AuthSession | null {
  if (!session) return null;
  return {
    user: { id: session.user.id, email: session.user.email ?? null },
    expiresAt: typeof session.expires_at === 'number' ? session.expires_at * 1000 : null,
  };
}

const EVENTS: Readonly<Record<AuthChangeEvent, AuthEvent>> = {
  INITIAL_SESSION: 'initial_session',
  SIGNED_IN: 'signed_in',
  SIGNED_OUT: 'signed_out',
  TOKEN_REFRESHED: 'token_refreshed',
  USER_UPDATED: 'user_updated',
  PASSWORD_RECOVERY: 'password_recovery',
  MFA_CHALLENGE_VERIFIED: 'signed_in',
};

export function authEventFromSupabase(event: AuthChangeEvent): AuthEvent {
  return EVENTS[event] ?? 'user_updated';
}

async function call<T extends { error: unknown }>(request: () => Promise<T>): Promise<T> {
  let result: T;
  try {
    result = await request();
  } catch (thrown) {
    throw toAppError(thrown);
  }
  if (result.error) throw toAppError(result.error);
  return result;
}

export function createAuthRepo(getSupabaseClient: () => TypedSupabaseClient): AuthRepo {
  const getClient = safeClientGetter(getSupabaseClient);
  return {
    async signIn(email, password) {
      const { data } = await call(() =>
        getClient().auth.signInWithPassword({ email: email.trim(), password }),
      );
      const session = sessionFromSupabase(data.session);
      if (!session) throw new AppError('unknown', { reason: 'no_session' });
      return session;
    },

    async signOut() {
      // Local scope removes the stored session before contacting the server, so a failed
      // revocation (offline, already expired) still signs this device out; other devices stay
      // signed in. The returned error is therefore ignored.
      try {
        await getClient().auth.signOut({ scope: 'local' });
      } catch (thrown) {
        throw toAppError(thrown);
      }
    },

    async getSession() {
      const { data } = await call(() => getClient().auth.getSession());
      return sessionFromSupabase(data.session);
    },

    onAuthChange(listener) {
      let client: TypedSupabaseClient;
      try {
        client = getClient();
      } catch {
        // Not configured: nobody can be signed in. Report that like supabase-js would (an async
        // `initial_session` without a session) instead of throwing during subscription.
        let active = true;
        queueMicrotask(() => {
          if (active) listener('initial_session', null);
        });
        return () => {
          active = false;
        };
      }
      const { data } = client.auth.onAuthStateChange((event, session) => {
        listener(authEventFromSupabase(event), sessionFromSupabase(session));
      });
      return () => data.subscription.unsubscribe();
    },

    async requestPasswordReset(email, redirectTo) {
      await call(() =>
        getClient().auth.resetPasswordForEmail(
          email.trim(),
          redirectTo === undefined ? undefined : { redirectTo },
        ),
      );
    },

    async updatePassword(newPassword) {
      await call(() => getClient().auth.updateUser({ password: newPassword }));
    },
  };
}

export const authRepo: AuthRepo = createAuthRepo(getSupabase);

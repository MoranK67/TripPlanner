import { createContext, useContext } from 'react';
import type { AuthSession, StoredAuthUser } from '@/data';

/**
 * - `loading`: waiting for Supabase to report the stored session (`initial_session`).
 * - `signed_in`: a session the server accepted (or a still valid stored one). Only this may write.
 * - `stored_offline` (M7.3b): no usable session yet, but one is stored on this device and could
 *   not be renewed (offline, or the auth server is unreachable). The app shows that user's saved
 *   cache read-only and keeps trying to renew; nothing may be written.
 * - `signed_out`: no session.
 */
export type AuthStatus = 'loading' | 'signed_in' | 'stored_offline' | 'signed_out';

export interface AuthState {
  status: AuthStatus;
  /** The verified session; set only while `signed_in`. */
  session: AuthSession | null;
  /**
   * While `stored_offline`: the user of the stored session. UNVERIFIED local data: it only picks
   * that user's saved cache for read-only display (and labels the sign-out button). Never use it
   * to decide that someone may write, and never send it to the server.
   */
  storedUser: StoredAuthUser | null;
  /**
   * The user followed a password-reset link (`password_recovery`). The app sends them to the
   * set-new-password page until they finish or sign out.
   */
  recovery: boolean;
  /**
   * The last sign-out happened because the server rejected the session (`auth_expired`, or a
   * stored session whose renewal was refused).
   */
  expired: boolean;
  /**
   * While `signed_out`: true when a session was ended (sign-out, refused refresh token, also at
   * start-up), false when the start found nothing stored. The saved query cache is deleted only
   * when true (a start without any session keeps it for that user's next sign-in).
   */
  sessionEnded: boolean;
  /** Ends the recovery flow after the new password was saved. */
  finishRecovery: () => void;
  /** Signs this device out at the user's request (also works offline). */
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

import { createContext, useContext } from 'react';
import type { AuthSession } from '@/data';

export type AuthStatus = 'loading' | 'signed_in' | 'signed_out';

export interface AuthState {
  /** `loading` until Supabase reports the stored session (`initial_session`). */
  status: AuthStatus;
  session: AuthSession | null;
  /**
   * The user followed a password-reset link (`password_recovery`). The app sends them to the
   * set-new-password page until they finish or sign out.
   */
  recovery: boolean;
  /** The last sign-out happened because the server rejected the session (`auth_expired`). */
  expired: boolean;
  /** Ends the recovery flow after the new password was saved. */
  finishRecovery: () => void;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

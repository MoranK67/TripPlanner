import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { authRepo, isAppError, type AuthSession } from '@/data';
import { AuthContext, type AuthState, type AuthStatus } from './authContext';

function isAuthExpired(error: unknown): boolean {
  return isAppError(error) && error.kind === 'auth_expired';
}

/**
 * Tracks the Supabase session (FR-1.2: supabase-js persists it in local storage and refreshes it).
 * The status stays `loading` until the first event (`initial_session`), so guards never redirect
 * a signed-in user to the login page while the stored session is still being read.
 *
 * Cached server data belongs to one user: the query cache is cleared on sign-out and whenever a
 * session for a different user arrives (e.g. a sign-in in another tab).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [expired, setExpired] = useState(false);
  const lastUserId = useRef<string | null>(null);
  const signingOut = useRef(false);

  useEffect(() => {
    return authRepo.onAuthChange((event, nextSession) => {
      // Do not call other repositories here (supabase-js holds a lock while listeners run).
      const nextUserId = nextSession?.user.id ?? null;
      if (event === 'signed_out' || nextUserId === null) {
        queryClient.clear();
        setRecovery(false);
      } else if (lastUserId.current !== null && lastUserId.current !== nextUserId) {
        queryClient.clear();
      }
      lastUserId.current = nextUserId;
      if (nextUserId !== null) {
        setExpired(false);
        signingOut.current = false;
      }
      setSession(nextSession);
      setStatus(nextSession ? 'signed_in' : 'signed_out');
      if (event === 'password_recovery') setRecovery(true);
    });
  }, [queryClient]);

  // A request failed because the server no longer accepts the session: sign out locally so the
  // guard shows the login page (with an explanation) instead of a screen of failed requests.
  useEffect(() => {
    function handle(error: unknown) {
      if (!isAuthExpired(error) || signingOut.current) return;
      signingOut.current = true;
      setExpired(true);
      authRepo.signOut().catch((signOutError: unknown) => {
        console.error(
          '[auth] sign-out after expired session failed',
          isAppError(signOutError) ? signOutError.kind : 'unknown',
        );
      });
    }
    const unsubscribeQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') handle(event.action.error);
    });
    const unsubscribeMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') handle(event.action.error);
    });
    return () => {
      unsubscribeQueries();
      unsubscribeMutations();
    };
  }, [queryClient]);

  const finishRecovery = useCallback(() => setRecovery(false), []);

  const value = useMemo<AuthState>(
    () => ({ status, session, recovery, expired, finishRecovery }),
    [status, session, recovery, expired, finishRecovery],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EditLockProvider } from '@/components/ui';
import {
  authRepo,
  isAppError,
  type AuthEvent,
  type AuthSession,
  type StoredAuthUser,
} from '@/data';
import { platform } from '@/platform';
import { AuthContext, type AuthState, type AuthStatus } from './authContext';

/** While `stored_offline` and online, renewing the stored session is retried this often. */
export const SESSION_RESUME_INTERVAL_MS = 30_000;

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
 *
 * Offline start with an expired access token (M7.3b): supabase-js cannot refresh it, keeps the
 * stored session and reports no session. If one is stored, the status becomes `stored_offline`:
 * the cache of the stored user stays (read-only, writes locked via `EditLockProvider`), and the
 * session is renewed with `authRepo.resumeSession()` when the connection returns (and every
 * `SESSION_RESUME_INTERVAL_MS` while online). Renewed → `signed_in` (trips refetched); refused →
 * signed out with the "expired" explanation.
 *
 * SECURITY: the stored user is unverified local data. It only selects which saved cache to show;
 * `stored_offline` never counts as signed in, so nothing is written until the server has renewed
 * the session (and RLS still checks every request).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [status, setStatusState] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [storedUser, setStoredUser] = useState<StoredAuthUser | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [expired, setExpired] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const statusRef = useRef<AuthStatus>('loading');
  const lastUserId = useRef<string | null>(null);
  const signingOut = useRef(false);
  /** The user asked to sign out: the next sign-out is not an "expired session". */
  const userSignOut = useRef(false);
  const resuming = useRef(false);

  const setStatus = useCallback((next: AuthStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  /** `ended`: a session existed and was ended (sign-out, refused token), not "nothing stored". */
  const toSignedOut = useCallback(
    (ended: boolean) => {
      queryClient.clear();
      lastUserId.current = null;
      setRecovery(false);
      setSession(null);
      setStoredUser(null);
      setSessionEnded(ended);
      setStatus('signed_out');
    },
    [queryClient, setStatus],
  );

  const toSignedIn = useCallback(
    (event: AuthEvent, nextSession: AuthSession) => {
      const nextUserId = nextSession.user.id;
      if (lastUserId.current !== null && lastUserId.current !== nextUserId) queryClient.clear();
      lastUserId.current = nextUserId;
      setExpired(false);
      setSessionEnded(false);
      signingOut.current = false;
      userSignOut.current = false;
      setSession(nextSession);
      setStoredUser(null);
      setStatus('signed_in');
      if (event === 'password_recovery') setRecovery(true);
    },
    [queryClient, setStatus],
  );

  /** Read-only view of a stored session's cache (unverified user, see above). */
  const toStoredOffline = useCallback(
    (user: StoredAuthUser) => {
      if (lastUserId.current !== null && lastUserId.current !== user.id) queryClient.clear();
      lastUserId.current = user.id;
      setSession(null);
      setStoredUser(user);
      setStatus('stored_offline');
    },
    [queryClient, setStatus],
  );

  useEffect(() => {
    return authRepo.onAuthChange((event, nextSession) => {
      // Do not call other repositories here (supabase-js holds a lock while listeners run);
      // getStoredUser() only reads local storage and is safe.
      if (event === 'signed_out') {
        // While read-only, supabase-js's own refresh tick may be the first to see the refresh
        // token refused (before resume()): explain it on the login page like a refused resume.
        if (statusRef.current === 'stored_offline' && !userSignOut.current) setExpired(true);
        toSignedOut(true);
        return;
      }
      if (nextSession) {
        toSignedIn(event, nextSession);
        return;
      }
      const stored = authRepo.getStoredUser();
      if (stored) toStoredOffline(stored);
      else toSignedOut(false);
    });
  }, [toSignedIn, toSignedOut, toStoredOffline]);

  /** Tries to renew the stored session (never inside the auth listener). */
  const resume = useCallback(async () => {
    // Only a read-only phase is resumed; the outcome is judged against the state at the start.
    if (resuming.current || statusRef.current !== 'stored_offline') return;
    resuming.current = true;
    // Read afresh after the await (the status can change meanwhile; no narrowing from above).
    const currentStatus = (): AuthStatus => statusRef.current;
    try {
      const result = await authRepo.resumeSession();
      if (result.status === 'signed_in') {
        // supabase-js usually also emits `token_refreshed`; but a session renewed in another tab
        // comes back from storage without an event.
        if (currentStatus() === 'stored_offline') toSignedIn('token_refreshed', result.session);
      } else if (result.status === 'signed_out') {
        // The server refused the stored session (or it is gone). supabase-js may already have
        // emitted `signed_out`; either way the login page explains it, unless the user signed out.
        // Started in `stored_offline` (checked above); a sign-in meanwhile wins.
        if (currentStatus() === 'signed_in') return;
        if (!userSignOut.current) setExpired(true);
        if (currentStatus() === 'stored_offline') toSignedOut(true);
      }
      // `unreachable`: stay read-only and try again later.
    } finally {
      resuming.current = false;
    }
  }, [toSignedIn, toSignedOut]);

  // While only a stored session is known: renew it when the connection is back, then
  // periodically (supabase-js waits up to ~60 s before it retries a failed refresh itself).
  useEffect(() => {
    if (status !== 'stored_offline') return;
    const attempt = () => {
      if (platform.isOnline()) void resume();
    };
    attempt();
    const unsubscribe = platform.subscribeOnline((online) => {
      if (online) void resume();
    });
    const timer = setInterval(attempt, SESSION_RESUME_INTERVAL_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [status, resume]);

  // Renewed after a read-only phase: the shown trips may be old, so load them again.
  const previousStatus = useRef<AuthStatus>(status);
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = status;
    if (previous === 'stored_offline' && status === 'signed_in') {
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
    }
  }, [status, queryClient]);

  // A request failed because the server no longer accepts the session: sign out locally so the
  // guard shows the login page (with an explanation) instead of a screen of failed requests.
  // (A stored session that is merely not renewed yet fails with `network` /
  // `session_not_refreshed` instead, which must not sign out.)
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

  const signOut = useCallback(async () => {
    userSignOut.current = true;
    setExpired(false);
    try {
      await authRepo.signOut();
    } catch (error) {
      userSignOut.current = false;
      throw error;
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      session,
      storedUser,
      recovery,
      expired,
      sessionEnded,
      finishRecovery,
      signOut,
    }),
    [status, session, storedUser, recovery, expired, sessionEnded, finishRecovery, signOut],
  );

  // Only a server-confirmed session may write (see SECURITY above).
  const editLock = status === 'stored_offline' ? t('common.offline.sessionNotRenewed') : undefined;

  return (
    <AuthContext.Provider value={value}>
      <EditLockProvider reason={editLock}>{children}</EditLockProvider>
    </AuthContext.Provider>
  );
}

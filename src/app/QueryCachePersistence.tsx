import { IsRestoringProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/features/auth';
import {
  browserStorage,
  createQueryCachePersistence,
  type CacheStorage,
  type QueryCachePersistence as Persistence,
} from './queryPersistence';

/**
 * Connects the saved query cache to the signed-in user (M7.3, FR-8.3). Must sit inside
 * <AuthProvider> (which clears the in-memory cache on sign-out / user change).
 *
 * - Signed in: restore that user's saved cache, then keep saving. Until the restore is done,
 *   queries wait (`IsRestoringProvider`), so an offline start shows the cache, not an error.
 * - A stored session that could not be renewed yet (`stored_offline`, M7.3b): restore the
 *   stored user's cache for read-only display (same buster, so only that user's own cache).
 *   Renewing it for the same user keeps the cache running without a new restore.
 * - Signing out (signed in or stored_offline → signed out, incl. a refused renewal), or a
 *   `signed_out` event at start-up (refused refresh token, `sessionEnded`): delete the saved cache.
 * - A start-up with no stored session at all keeps the saved cache: it was not a sign-out, and
 *   it can only be restored for the same user.
 * - Another user signing in: their buster differs, so the old cache is deleted on restore.
 */
export function QueryCachePersistence({
  children,
  storage,
}: {
  children: ReactNode;
  /** For tests; defaults to localStorage. */
  storage?: CacheStorage;
}) {
  const queryClient = useQueryClient();
  const { status, session, storedUser, sessionEnded } = useAuth();
  // The stored user is unverified, but it only selects which saved cache to show (read-only).
  const userId =
    status === 'signed_in'
      ? (session?.user.id ?? null)
      : status === 'stored_offline'
        ? (storedUser?.id ?? null)
        : null;
  const [persistence] = useState<Persistence>(() =>
    createQueryCachePersistence(queryClient, storage ?? browserStorage() ?? null),
  );
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  // Reset during render (not in an effect) so a later sign-in waits for its own restore.
  if (userId === null && restoredFor !== null) setRestoredFor(null);

  const previousStatus = useRef(status);
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = status;
    if (status !== 'signed_out') return;
    // A session that ended (sign-out, refused refresh token, even right at start-up) takes its
    // saved cache with it.
    if (sessionEnded || previous === 'signed_in' || previous === 'stored_offline') {
      persistence.clear();
    }
  }, [status, sessionEnded, persistence]);

  useEffect(() => {
    if (userId === null) return;
    let active = true;
    void persistence.start(userId).then(() => {
      if (active) setRestoredFor(userId);
    });
    return () => {
      active = false;
      persistence.stop();
    };
  }, [userId, persistence]);

  const restoring = status === 'loading' || (userId !== null && restoredFor !== userId);
  return <IsRestoringProvider value={restoring}>{children}</IsRestoringProvider>;
}

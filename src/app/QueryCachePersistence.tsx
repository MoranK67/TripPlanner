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
 * - Signing out (signed in → signed out): delete the saved cache.
 * - A start-up without a session (e.g. supabase-js could not refresh an expired token offline)
 *   keeps the saved cache: it was not a sign-out, and it can only be restored for the same user.
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
  const { status, session } = useAuth();
  const userId = status === 'signed_in' ? (session?.user.id ?? null) : null;
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
    if (previous === 'signed_in' && status === 'signed_out') persistence.clear();
  }, [status, persistence]);

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

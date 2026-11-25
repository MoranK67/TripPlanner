// The bank's tag filter (FEAT-2) per trip, kept in memory only: it survives switching between the
// phone sheet and the side panel and between trips, and is forgotten on reload. It is per-user
// state: a trip's selection is dropped when that trip's cached data is removed, which is what
// sign-out and a user switch do (`queryClient.clear()` in AuthProvider) — the same signal the
// placement queue uses to release its state.

import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

const selected = new Map<string, string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setSelected(tripId: string, key: string | null) {
  if (key === null) selected.delete(tripId);
  else selected.set(tripId, key);
  for (const listener of listeners) listener();
}

const watched = new WeakSet<QueryClient>();

/** Drops a trip's selection when its detail query (`['trips', 'detail', id]`) leaves the cache. */
function watch(queryClient: QueryClient) {
  if (watched.has(queryClient)) return;
  watched.add(queryClient);
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'removed') return;
    const [scope, kind, tripId] = event.query.queryKey;
    if (scope === 'trips' && kind === 'detail' && typeof tripId === 'string') {
      if (selected.has(tripId)) setSelected(tripId, null);
    }
  });
}

/** Clears every trip's selection (tests). */
export function resetTagFilters(): void {
  selected.clear();
  for (const listener of listeners) listener();
}

/**
 * The selected tag key of `tripId` (`TripTag.key`), `null` = all, and its setter.
 */
export function useTagFilter(tripId: string): [string | null, (key: string | null) => void] {
  const queryClient = useQueryClient();
  useEffect(() => watch(queryClient), [queryClient]);
  const key = useSyncExternalStore(subscribe, () => selected.get(tripId) ?? null);
  const set = useCallback((next: string | null) => setSelected(tripId, next), [tripId]);
  return [key, set];
}

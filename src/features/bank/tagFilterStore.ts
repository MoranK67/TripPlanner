// The bank's tag filter (FEAT-2) per trip, kept in memory only: it survives switching between the
// phone sheet and the side panel and between trips, and is forgotten on reload.

import { useCallback, useSyncExternalStore } from 'react';

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

/** Clears every trip's selection (tests). */
export function resetTagFilters(): void {
  selected.clear();
  for (const listener of listeners) listener();
}

/**
 * The selected tag key of `tripId` (`TripTag.key`), `null` = all, and its setter.
 */
export function useTagFilter(tripId: string): [string | null, (key: string | null) => void] {
  const key = useSyncExternalStore(subscribe, () => selected.get(tripId) ?? null);
  const set = useCallback((next: string | null) => setSelected(tripId, next), [tripId]);
  return [key, set];
}

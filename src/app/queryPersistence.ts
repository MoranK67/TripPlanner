import { defaultShouldDehydrateQuery, type Query, type QueryClient } from '@tanstack/react-query';
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
  removeOldestQuery,
  type PersistedClient,
} from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';

// Offline read cache (M7.3, FR-8.3): the TanStack Query cache is saved to localStorage so the
// trips viewed last stay readable offline, also after a reload. Only successful queries are
// saved (never mutations), and a saved cache only ever comes back for the user who saved it.
// Auth tokens are not part of it: supabase-js keeps its own session storage.

/** localStorage key of the saved cache. */
export const QUERY_CACHE_STORAGE_KEY = 'trip-planner.query-cache';

/** A saved cache older than this is discarded; also the queries' `gcTime` (queryClient.ts). */
export const QUERY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Bump when the shape of cached data changes (domain types, query keys): every saved cache with
 * an older version is thrown away instead of being fed to screens that expect the new shape.
 */
export const QUERY_CACHE_VERSION = '1';

/** Saving runs at most once per this many ms (a drag or an import changes many queries at once). */
export const QUERY_CACHE_THROTTLE_MS = 1_000;

/**
 * The persister's `buster`: the cache format version **and the user id**. A cache saved by another
 * user (or by an older version) never matches, so it is deleted on restore instead of shown.
 */
export function queryCacheBuster(userId: string): string {
  return `${QUERY_CACHE_VERSION}:${userId}`;
}

/** Queries that are worth keeping offline: successful ones, except the live server check. */
export function shouldPersistQuery(query: Query): boolean {
  // A saved "connected" result would contradict the offline banner after a reload.
  return defaultShouldDehydrateQuery(query) && query.queryKey[0] !== 'server-health';
}

/** Minimal storage API (localStorage, or a fake in tests). */
export type CacheStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** `window.localStorage`, or undefined where it is missing or blocked (some private modes). */
export function browserStorage(): CacheStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export interface QueryCachePersistence {
  /**
   * Restores the user's saved cache into the query client (a cache of another user or version is
   * deleted instead), then keeps saving changes. Resolves once the restore is done; never rejects.
   */
  start(userId: string): Promise<void>;
  /** Stops saving (the saved cache stays, e.g. for the next offline start). */
  stop(): void;
  /** Stops saving and deletes the saved cache (sign-out). */
  clear(): void;
}

/** Marker: `serialize` returns it for a write that must be dropped (see below). */
const SKIP_WRITE = '';

export function createQueryCachePersistence(
  queryClient: QueryClient,
  /** `null`: nothing is saved or restored (no storage available). */
  storage: CacheStorage | null = browserStorage() ?? null,
): QueryCachePersistence {
  // Only writes for the currently active user get through. Saving is throttled, so a write
  // scheduled before a sign-out (or a switch to another user) can fire afterwards: it carries the
  // old buster, is turned into SKIP_WRITE and dropped, so a cleared cache is never re-created.
  let activeBuster: string | null = null;
  let unsubscribe: (() => void) | null = null;
  // Bumped by every start() and stop(): a restore that finishes after a newer start/stop (e.g.
  // React StrictMode's start → stop → start for the same user) must not subscribe as well.
  let generation = 0;

  const persister = createSyncStoragePersister({
    storage: storage && {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => {
        if (value !== SKIP_WRITE) storage.setItem(key, value);
      },
      removeItem: (key) => storage.removeItem(key),
    },
    key: QUERY_CACHE_STORAGE_KEY,
    throttleTime: QUERY_CACHE_THROTTLE_MS,
    serialize: (client: PersistedClient) =>
      client.buster === activeBuster ? JSON.stringify(client) : SKIP_WRITE,
    // Storage full: drop the oldest queries until it fits.
    retry: removeOldestQuery,
  });

  function stop() {
    generation += 1;
    activeBuster = null;
    unsubscribe?.();
    unsubscribe = null;
  }

  return {
    async start(userId) {
      stop();
      const run = generation;
      const buster = queryCacheBuster(userId);
      activeBuster = buster;
      try {
        await persistQueryClientRestore({
          queryClient,
          persister,
          buster,
          maxAge: QUERY_CACHE_MAX_AGE_MS,
        });
      } catch {
        // Unreadable cache: the persister already deleted it; the app simply loads from the server.
      }
      // Stopped, signed out, switched user or started again while restoring.
      if (run !== generation) return;
      unsubscribe?.();
      unsubscribe = persistQueryClientSubscribe({
        queryClient,
        persister,
        buster,
        dehydrateOptions: {
          shouldDehydrateQuery: shouldPersistQuery,
          shouldDehydrateMutation: () => false,
        },
      });
    },
    stop,
    clear() {
      stop();
      try {
        storage?.removeItem(QUERY_CACHE_STORAGE_KEY);
      } catch {
        // Storage unavailable: nothing was saved there either.
      }
    },
  };
}

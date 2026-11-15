import { QueryClient } from '@tanstack/react-query';
import {
  createQueryCachePersistence,
  QUERY_CACHE_MAX_AGE_MS,
  QUERY_CACHE_STORAGE_KEY,
  QUERY_CACHE_THROTTLE_MS,
  QUERY_CACHE_VERSION,
  queryCacheBuster,
  type CacheStorage,
} from './queryPersistence';
import { createQueryClient } from './queryClient';

function memoryStorage(): CacheStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

interface Saved {
  buster: string;
  timestamp: number;
  clientState: { queries: { queryKey: unknown[] }[]; mutations: unknown[] };
}

function saved(storage: CacheStorage): Saved | null {
  const raw = storage.getItem(QUERY_CACHE_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Saved) : null;
}

/** A cache as the app would have saved it for `userId`. */
function seed(
  storage: CacheStorage,
  userId: string,
  options: { buster?: string; age?: number } = {},
) {
  const source = new QueryClient();
  source.setQueryData(['trips', 'list'], [{ id: 't1', name: 'רומא' }]);
  storage.setItem(
    QUERY_CACHE_STORAGE_KEY,
    JSON.stringify({
      buster: options.buster ?? queryCacheBuster(userId),
      timestamp: Date.now() - (options.age ?? 0),
      clientState: {
        mutations: [],
        queries: source
          .getQueryCache()
          .getAll()
          .map((q) => ({ queryKey: q.queryKey, queryHash: q.queryHash, state: q.state })),
      },
    }),
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('query cache persistence (M7.3)', () => {
  it('keeps data for 7 days in memory and in storage', () => {
    expect(QUERY_CACHE_MAX_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(createQueryClient().getDefaultOptions().queries?.gcTime).toBe(QUERY_CACHE_MAX_AGE_MS);
  });

  it('ties the buster to the format version and the user', () => {
    expect(queryCacheBuster('u1')).toBe(`${QUERY_CACHE_VERSION}:u1`);
    expect(queryCacheBuster('u1')).not.toBe(queryCacheBuster('u2'));
  });

  it("restores the same user's saved cache", async () => {
    const storage = memoryStorage();
    seed(storage, 'u1');
    const client = new QueryClient();
    await createQueryCachePersistence(client, storage).start('u1');
    expect(client.getQueryData(['trips', 'list'])).toEqual([{ id: 't1', name: 'רומא' }]);
  });

  it("never restores another user's cache, and deletes it", async () => {
    const storage = memoryStorage();
    seed(storage, 'u1');
    const client = new QueryClient();
    await createQueryCachePersistence(client, storage).start('u2');
    expect(client.getQueryData(['trips', 'list'])).toBeUndefined();
    expect(storage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull();
  });

  it('discards a cache from an older format version', async () => {
    const storage = memoryStorage();
    seed(storage, 'u1', { buster: '0:u1' });
    const client = new QueryClient();
    await createQueryCachePersistence(client, storage).start('u1');
    expect(client.getQueryData(['trips', 'list'])).toBeUndefined();
    expect(storage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull();
  });

  it('discards a cache older than maxAge', async () => {
    const storage = memoryStorage();
    seed(storage, 'u1', { age: QUERY_CACHE_MAX_AGE_MS + 1000 });
    const client = new QueryClient();
    await createQueryCachePersistence(client, storage).start('u1');
    expect(client.getQueryData(['trips', 'list'])).toBeUndefined();
    expect(storage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull();
  });

  it('discards an unreadable cache without failing', async () => {
    const storage = memoryStorage();
    storage.setItem(QUERY_CACHE_STORAGE_KEY, '{not json');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      createQueryCachePersistence(new QueryClient(), storage).start('u1'),
    ).resolves.toBeUndefined();
    expect(storage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull();
  });

  it('saves successful queries only — no errors, no server check, no mutations', async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const persistence = createQueryCachePersistence(client, storage);
    await persistence.start('u1');

    client.setQueryData(['trips', 'list'], [{ id: 't1' }]);
    client.setQueryData(['server-health'], true);
    await client
      .fetchQuery({
        queryKey: ['trips', 'detail', 'x'],
        queryFn: () => Promise.reject(new Error('x')),
      })
      .catch(() => {});
    void client
      .getMutationCache()
      .build(client, { mutationFn: () => new Promise(() => {}) })
      .execute(undefined)
      .catch(() => {});
    await vi.advanceTimersByTimeAsync(QUERY_CACHE_THROTTLE_MS + 10);

    const state = saved(storage);
    expect(state?.buster).toBe(queryCacheBuster('u1'));
    expect(state?.clientState.queries.map((q) => q.queryKey)).toEqual([['trips', 'list']]);
    expect(state?.clientState.mutations).toEqual([]);
  });

  it('clear() deletes the saved cache, and a save still pending afterwards is dropped', async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const client = new QueryClient();
    const persistence = createQueryCachePersistence(client, storage);
    await persistence.start('u1');
    client.setQueryData(['trips', 'list'], [{ id: 't1' }]);
    await vi.advanceTimersByTimeAsync(QUERY_CACHE_THROTTLE_MS + 10);
    expect(saved(storage)).not.toBeNull();

    // A change right before sign-out schedules a throttled save…
    client.setQueryData(['trips', 'list'], [{ id: 't2' }]);
    persistence.clear();
    expect(storage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull();
    // …which must not re-create the cache once it fires.
    await vi.advanceTimersByTimeAsync(QUERY_CACHE_THROTTLE_MS + 10);
    expect(storage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull();

    // And nothing is saved any more.
    client.setQueryData(['trips', 'list'], [{ id: 't3' }]);
    await vi.advanceTimersByTimeAsync(QUERY_CACHE_THROTTLE_MS + 10);
    expect(storage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull();
  });

  it("a pending save of the previous user never lands under the next user's session", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const client = new QueryClient();
    const persistence = createQueryCachePersistence(client, storage);
    await persistence.start('u1');
    client.setQueryData(['trips', 'list'], [{ id: 'mine' }]);
    // Switch user before u1's throttled save fires.
    client.clear();
    await persistence.start('u2');
    await vi.advanceTimersByTimeAsync(QUERY_CACHE_THROTTLE_MS + 10);
    const state = saved(storage);
    expect(state === null || state.buster === queryCacheBuster('u2')).toBe(true);
    expect(JSON.stringify(state)).not.toContain('mine');
  });

  it('overlapping starts for the same user (StrictMode) leave no subscription behind', async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const client = new QueryClient();
    const persistence = createQueryCachePersistence(client, storage);
    // Not awaited: the second start begins while the first restore is still pending.
    const first = persistence.start('u1');
    persistence.stop();
    const second = persistence.start('u1');
    await Promise.all([first, second]);
    persistence.stop();

    client.setQueryData(['trips', 'list'], [{ id: 't1' }]);
    await vi.advanceTimersByTimeAsync(QUERY_CACHE_THROTTLE_MS + 10);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('only one subscription is active after overlapping starts', async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const client = new QueryClient();
    const persistence = createQueryCachePersistence(client, storage);
    const subscribers = () =>
      (client.getQueryCache() as unknown as { listeners: Set<unknown> }).listeners.size;
    const before = subscribers();
    await Promise.all([persistence.start('u1'), persistence.start('u1')]);
    expect(subscribers()).toBe(before + 1);
    persistence.stop();
    expect(subscribers()).toBe(before);
  });

  it('does nothing without storage', async () => {
    const client = new QueryClient();
    const persistence = createQueryCachePersistence(client, null);
    await expect(persistence.start('u1')).resolves.toBeUndefined();
    expect(() => persistence.clear()).not.toThrow();
  });
});

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { AuthProvider } from '@/features/auth';
import { QueryCachePersistence } from './QueryCachePersistence';
import {
  QUERY_CACHE_STORAGE_KEY,
  QUERY_CACHE_THROTTLE_MS,
  queryCacheBuster,
  type CacheStorage,
} from './queryPersistence';

type Listener = (event: string, session: unknown) => void;
const auth = vi.hoisted(() => ({
  listener: null as Listener | null,
  storedUser: null as { id: string; email: string | null } | null,
  resume: null as null | (() => Promise<unknown>),
}));

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return {
    ...actual,
    authRepo: {
      onAuthChange: (listener: Listener) => {
        auth.listener = listener;
        return () => {
          auth.listener = null;
        };
      },
      signOut: vi.fn(async () => {}),
      getStoredUser: () => auth.storedUser,
      resumeSession: () =>
        auth.resume?.() ??
        Promise.resolve({
          status: 'unreachable',
          user: auth.storedUser,
          error: new actual.AppError('network', { retryable: true }),
        }),
    },
  };
});

function session(userId: string) {
  return { user: { id: userId, email: `${userId}@example.com` }, expiresAt: null };
}

function emit(event: string, userId: string | null) {
  act(() => auth.listener?.(event, userId ? session(userId) : null));
}

function memoryStorage(): CacheStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

/** Saves what `useQuery` would have saved for `userId`: one trips list. */
function seed(storage: CacheStorage, userId: string, names: string[]) {
  const source = new QueryClient();
  source.setQueryData(['trips', 'list'], names);
  storage.setItem(
    QUERY_CACHE_STORAGE_KEY,
    JSON.stringify({
      buster: queryCacheBuster(userId),
      timestamp: Date.now(),
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

/** Reads the trips list; the server never answers (as offline), so only a restore can fill it. */
function TripNames() {
  const query = useQuery<string[]>({
    queryKey: ['trips', 'list'],
    queryFn: () => new Promise<string[]>(() => {}),
    staleTime: Infinity,
  });
  return <p data-testid="names">{query.data ? query.data.join(',') : 'none'}</p>;
}

function renderApp(storage: CacheStorage, page: React.ReactNode = <TripNames />) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <QueryCachePersistence storage={storage}>{page}</QueryCachePersistence>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

const names = () => screen.getByTestId('names').textContent;

afterEach(() => {
  auth.storedUser = null;
  auth.resume = null;
});

describe('QueryCachePersistence (M7.3)', () => {
  it("restores the signed-in user's saved trips (e.g. an offline start)", async () => {
    const storage = memoryStorage();
    seed(storage, 'u1', ['רומא', 'פריז']);
    renderApp(storage);
    emit('initial_session', 'u1');
    expect(await screen.findByText('רומא,פריז')).toBeInTheDocument();
  });

  it('holds queries until the restore is done, so the first fetch already sees the cache', async () => {
    const storage = memoryStorage();
    seed(storage, 'u1', ['רומא']);
    const seenAtFetch: unknown[] = [];
    let client: QueryClient | null = null;
    const queryFn = vi.fn(async () => {
      seenAtFetch.push(client?.getQueryData(['trips', 'list']));
      return ['רומא', 'חדש'];
    });
    function FetchingNames() {
      // staleTime 0: a mounted observer fetches as soon as it is allowed to.
      const query = useQuery<string[]>({ queryKey: ['trips', 'list'], queryFn, staleTime: 0 });
      return <p data-testid="names">{query.data ? query.data.join(',') : 'none'}</p>;
    }
    client = renderApp(storage, <FetchingNames />);

    // Auth still loading: restoring, nothing is fetched.
    await act(async () => {});
    expect(queryFn).not.toHaveBeenCalled();

    emit('initial_session', 'u1');
    expect(await screen.findByText('רומא,חדש')).toBeInTheDocument();
    expect(queryFn).toHaveBeenCalledTimes(1);
    // When the fetch started, the restored cache was already in place.
    expect(seenAtFetch).toEqual([['רומא']]);
  });

  it('deletes the saved cache and the in-memory data on sign-out', async () => {
    const storage = memoryStorage();
    seed(storage, 'u1', ['רומא']);
    const queryClient = renderApp(storage);
    emit('initial_session', 'u1');
    await screen.findByText('רומא');

    emit('signed_out', null);
    expect(storage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull();
    expect(queryClient.getQueryData(['trips', 'list'])).toBeUndefined();
  });

  it("never shows a previous user's trips to the next user, and deletes them", async () => {
    const storage = memoryStorage();
    seed(storage, 'u1', ['של משתמש אחר']);
    renderApp(storage);
    emit('initial_session', 'u2');
    // The restore for u2 is done once the query may fetch; nothing came from u1's cache.
    await act(async () => {});
    expect(names()).toBe('none');
    expect(storage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull();
  });

  it('a user switch in another tab drops the first user’s cache', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const storage = memoryStorage();
      seed(storage, 'u1', ['רומא']);
      const queryClient = renderApp(storage);
      emit('initial_session', 'u1');
      await screen.findByText('רומא');

      emit('signed_in', 'u2');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(QUERY_CACHE_THROTTLE_MS + 10);
      });
      expect(queryClient.getQueryData(['trips', 'list'])).toBeUndefined();
      expect(storage.getItem(QUERY_CACHE_STORAGE_KEY) ?? '').not.toContain('רומא');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the saved cache when the app starts without a session (not a sign-out)', async () => {
    const storage = memoryStorage();
    seed(storage, 'u1', ['רומא']);
    renderApp(storage);
    // E.g. supabase-js could not refresh an expired token offline: no session, no sign-out.
    emit('initial_session', null);
    await act(async () => {});
    expect(storage.getItem(QUERY_CACHE_STORAGE_KEY)).toContain('רומא');
  });

  it('deletes the saved cache when the start-up ends in a signed_out event (refused token)', async () => {
    const storage = memoryStorage();
    seed(storage, 'u1', ['רומא']);
    renderApp(storage);
    // supabase-js tried to refresh the stored session at start-up and the server refused it.
    emit('signed_out', null);
    await act(async () => {});
    expect(storage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull();
  });

  it('saves new data for the signed-in user', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const storage = memoryStorage();
      const queryClient = renderApp(storage);
      emit('initial_session', 'u1');
      await act(async () => {});
      act(() => {
        queryClient.setQueryData(['trips', 'list'], ['ליסבון']);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(QUERY_CACHE_THROTTLE_MS + 10);
      });
      const raw = storage.getItem(QUERY_CACHE_STORAGE_KEY) ?? '';
      expect(raw).toContain('ליסבון');
      expect(raw).toContain(queryCacheBuster('u1'));
      // Never the auth session or tokens: only query data.
      expect(raw).not.toContain('u1@example.com');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('QueryCachePersistence with a stored, unrenewed session (M7.3b)', () => {
  it("restores the stored user's saved trips read-only (offline start, expired token)", async () => {
    const storage = memoryStorage();
    seed(storage, 'u1', ['רומא']);
    auth.storedUser = { id: 'u1', email: null };
    renderApp(storage);
    emit('initial_session', null);
    expect(await screen.findByText('רומא')).toBeInTheDocument();
  });

  it("never restores another user's cache for the stored user", async () => {
    const storage = memoryStorage();
    seed(storage, 'u1', ['של משתמש אחר']);
    auth.storedUser = { id: 'u2', email: null };
    renderApp(storage);
    emit('initial_session', null);
    await act(async () => {});
    expect(names()).toBe('none');
    expect(storage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull();
  });

  it('keeps the cache when the session is renewed for the same user', async () => {
    const storage = memoryStorage();
    seed(storage, 'u1', ['רומא']);
    auth.storedUser = { id: 'u1', email: null };
    renderApp(storage);
    emit('initial_session', null);
    await screen.findByText('רומא');
    emit('token_refreshed', 'u1');
    await act(async () => {});
    expect(names()).toBe('רומא');
    expect(storage.getItem(QUERY_CACHE_STORAGE_KEY)).toContain('רומא');
  });

  it('deletes the saved cache when the renewal is refused', async () => {
    const storage = memoryStorage();
    seed(storage, 'u1', ['רומא']);
    auth.storedUser = { id: 'u1', email: null };
    const queryClient = renderApp(storage);
    emit('initial_session', null);
    await screen.findByText('רומא');
    emit('signed_out', null);
    expect(storage.getItem(QUERY_CACHE_STORAGE_KEY)).toBeNull();
    expect(queryClient.getQueryData(['trips', 'list'])).toBeUndefined();
  });
});

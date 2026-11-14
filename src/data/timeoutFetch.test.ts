import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { toAppError } from './errors';
import { runDb } from './execute';
import { createTimeoutFetch, REQUEST_TIMEOUT_MS, RequestTimeoutError } from './timeoutFetch';

type FetchArgs = Parameters<typeof fetch>;

/** A fetch that never answers but, like a real one, rejects with the signal's reason on abort. */
function hangingFetch() {
  return vi.fn(
    (_input: FetchArgs[0], init?: FetchArgs[1]) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const onAbort = () =>
          reject(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort);
      }),
  );
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function signalOf(mock: ReturnType<typeof vi.fn>, call = 0): AbortSignal {
  const init = mock.mock.calls[call]?.[1] as RequestInit | undefined;
  if (!init?.signal) throw new Error('fetch was called without a signal');
  return init.signal;
}

describe('createTimeoutFetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses a 15 s deadline by default', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(15_000);
  });

  it('passes a fast response through and leaves no timer behind', async () => {
    const base = vi.fn(async () => jsonResponse({ ok: true }, 201));
    const timedFetch = createTimeoutFetch(base);

    const response = await timedFetch('https://example.test/rest', {
      method: 'POST',
      headers: { apikey: 'k' },
      body: '{}',
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ ok: true });
    expect(base).toHaveBeenCalledWith('https://example.test/rest', {
      method: 'POST',
      headers: { apikey: 'k' },
      body: '{}',
      signal: expect.any(AbortSignal) as AbortSignal,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops wire-body headers (the buffered body is already decoded) and keeps the rest', async () => {
    const original = new Response('[]', {
      status: 200,
      headers: {
        'Content-Encoding': 'gzip',
        'Content-Length': '20',
        'Content-Range': '0-0/1',
        'Content-Type': 'application/json',
      },
    });
    const timedFetch = createTimeoutFetch(vi.fn(async () => original));

    const response = await timedFetch('https://example.test/rest');

    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('content-length')).toBeNull();
    expect(response.headers.get('content-range')).toBe('0-0/1');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual([]);
  });

  it('keeps the response URL and builds null-body statuses without a body', async () => {
    const original = new Response(null, { status: 204, statusText: 'No Content' });
    Object.defineProperty(original, 'url', { value: 'https://example.test/rest' });
    const timedFetch = createTimeoutFetch(vi.fn(async () => original));

    const response = await timedFetch('https://example.test/rest');

    expect(response.status).toBe(204);
    expect(response.statusText).toBe('No Content');
    expect(response.url).toBe('https://example.test/rest');
    expect(response.body).toBeNull();
  });

  it('rejects with RequestTimeoutError after the deadline and aborts the request', async () => {
    const base = hangingFetch();
    const timedFetch = createTimeoutFetch(base, 1_000);

    const result = timedFetch('https://example.test/rest');
    const assertion = expect(result).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(999);
    expect(signalOf(base).aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;

    expect(signalOf(base).aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out even when the fetch implementation ignores the abort signal', async () => {
    const base = vi.fn(() => new Promise<Response>(() => undefined));
    const timedFetch = createTimeoutFetch(base, 1_000);

    const result = timedFetch('https://example.test/rest');
    const assertion = expect(result).rejects.toMatchObject({
      name: 'TimeoutError',
      timeoutMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  it('times out when the headers arrive but the body stalls', async () => {
    const stalledBody = new ReadableStream<Uint8Array>({ start: () => undefined });
    const timedFetch = createTimeoutFetch(
      vi.fn(async () => new Response(stalledBody, { status: 200 })),
      1_000,
    );

    const result = timedFetch('https://example.test/rest');
    const assertion = expect(result).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  it('a caller abort rejects with the caller AbortError, not a timeout', async () => {
    const base = hangingFetch();
    const timedFetch = createTimeoutFetch(base, 1_000);
    const caller = new AbortController();

    const result = timedFetch('https://example.test/rest', { signal: caller.signal });
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(500);
    caller.abort();
    await assertion;

    expect(signalOf(base).aborted).toBe(true);
    expect(signalOf(base)).not.toBe(caller.signal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an already-aborted caller signal aborts at once', async () => {
    const base = hangingFetch();
    const timedFetch = createTimeoutFetch(base, 1_000);
    const caller = new AbortController();
    caller.abort();

    await expect(
      timedFetch('https://example.test/rest', { signal: caller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(signalOf(base).aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('combines the signal of a Request input with the deadline', async () => {
    const base = hangingFetch();
    const timedFetch = createTimeoutFetch(base, 1_000);
    const caller = new AbortController();
    const request = new Request('https://example.test/rest', { signal: caller.signal });

    const result = timedFetch(request);
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    caller.abort();
    await assertion;
    expect(signalOf(base).aborted).toBe(true);
  });

  it('still times out while a caller signal is attached, and detaches its listener', async () => {
    const base = hangingFetch();
    const timedFetch = createTimeoutFetch(base, 1_000);
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener');

    const result = timedFetch('https://example.test/rest', { signal: caller.signal });
    const assertion = expect(result).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;

    expect(caller.signal.aborted).toBe(false);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('detaches the caller listener after a fast response', async () => {
    const timedFetch = createTimeoutFetch(vi.fn(async () => jsonResponse([])));
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener');

    await timedFetch('https://example.test/rest', { signal: caller.signal });

    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes other fetch failures through unchanged', async () => {
    const failure = new TypeError('Failed to fetch');
    const timedFetch = createTimeoutFetch(vi.fn(async () => Promise.reject(failure)));

    await expect(timedFetch('https://example.test/rest')).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('timeout → AppError', () => {
  it('a thrown RequestTimeoutError → network / timeout, retryable (not aborted)', () => {
    const error = toAppError(new RequestTimeoutError(15_000));
    expect(error.kind).toBe('network');
    expect(error.reason).toBe('timeout');
    expect(error.retryable).toBe(true);
  });

  it('a DOM TimeoutError (AbortSignal.timeout) → network / timeout, retryable', () => {
    const error = toAppError(new DOMException('signal timed out', 'TimeoutError'));
    expect(error.kind).toBe('network');
    expect(error.reason).toBe('timeout');
    expect(error.retryable).toBe(true);
  });

  // End to end through the real supabase-js client: only the transport is fake.
  function clientWith(base: typeof fetch) {
    return createClient<Database>('https://example.supabase.co', 'sb_publishable_test', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      db: { retry: false },
      global: { fetch: createTimeoutFetch(base, 20) },
    });
  }

  it('a PostgREST read that hangs → network / timeout, retryable', async () => {
    const client = clientWith(hangingFetch());
    const error = await runDb(client, () => client.from('trips').select('id')).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ kind: 'network', reason: 'timeout', retryable: true });
  });

  it('a PostgREST write that hangs → network / timeout', async () => {
    const client = clientWith(hangingFetch());
    const error = await runDb(client, () =>
      client
        .from('activities')
        .update({ scheduled_date: '2026-12-01', start_minute: 600 })
        .eq('id', '00000000-0000-0000-0000-000000000001')
        .select('id'),
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'network', reason: 'timeout', retryable: true });
  });

  it('a caller abort through PostgREST stays network / aborted, not retryable', async () => {
    const client = clientWith(hangingFetch());
    const caller = new AbortController();
    const pending = runDb(client, () =>
      client.from('trips').select('id').abortSignal(caller.signal),
    ).catch((e: unknown) => e);
    caller.abort();
    expect(await pending).toMatchObject({ kind: 'network', reason: 'aborted', retryable: false });
  });

  it('an Auth request that hangs → network / timeout, retryable', async () => {
    const client = clientWith(hangingFetch());
    const { error } = await client.auth.signInWithPassword({
      email: 'a@example.test',
      password: 'secret-password',
    });
    expect(error).not.toBeNull();
    expect(toAppError(error)).toMatchObject({
      kind: 'network',
      reason: 'timeout',
      retryable: true,
    });
  });
});

describe('token refresh with a hanging server', () => {
  const STORAGE_KEY = 'tp-test-auth-token';

  function storedSession() {
    const now = Math.floor(Date.now() / 1000);
    return {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: now + 3600,
      user: {
        id: '00000000-0000-0000-0000-0000000000aa',
        aud: 'authenticated',
        app_metadata: {},
        user_metadata: {},
        created_at: '2026-11-01T00:00:00Z',
      },
    };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('times out as network / timeout and keeps the session in storage', async () => {
    vi.useFakeTimers();
    const memory = new Map<string, string>([[STORAGE_KEY, JSON.stringify(storedSession())]]);
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
    };
    const base = hangingFetch();
    const client = createClient<Database>('https://example.supabase.co', 'sb_publishable_test', {
      auth: {
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storage,
        storageKey: STORAGE_KEY,
      },
      db: { retry: false },
      global: { fetch: createTimeoutFetch(base) },
    });

    const pending = client.auth.refreshSession();
    // auth-js retries a retryable refresh failure while the next attempt still starts within its
    // 30 s tick: with a 15 s deadline that is two attempts, ~30 s in total.
    await vi.advanceTimersByTimeAsync(2 * REQUEST_TIMEOUT_MS + 1_000);
    const { error } = await pending;

    expect(error?.name).toBe('AuthRetryableFetchError');
    expect(toAppError(error)).toMatchObject({
      kind: 'network',
      reason: 'timeout',
      retryable: true,
    });
    const refreshCalls = base.mock.calls.filter(([url]) => String(url).includes('/token'));
    expect(refreshCalls).toHaveLength(2);
    expect(memory.has(STORAGE_KEY)).toBe(true);
    expect(JSON.parse(memory.get(STORAGE_KEY) ?? '{}')).toMatchObject({
      refresh_token: 'refresh-token',
    });
  });
});

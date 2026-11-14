const { createClient } = vi.hoisted(() => ({ createClient: vi.fn(() => ({})) }));

vi.mock('@supabase/supabase-js', () => ({ createClient }));

async function loadModule() {
  vi.resetModules();
  return import('./supabaseClient');
}

afterEach(() => {
  vi.unstubAllEnvs();
  createClient.mockClear();
});

describe('getSupabase', () => {
  it('disables postgrest-js retries so TanStack Query is the only retry layer (UX-1)', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    const { getSupabase, SUPABASE_CLIENT_OPTIONS } = await loadModule();

    getSupabase();
    getSupabase();

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'sb_publishable_test',
      SUPABASE_CLIENT_OPTIONS,
    );
    expect(SUPABASE_CLIENT_OPTIONS.db.retry).toBe(false);
    expect(SUPABASE_CLIENT_OPTIONS.auth).toEqual({ persistSession: true, autoRefreshToken: true });
  });

  it('gives every request (PostgREST and Auth) the request deadline via global.fetch', async () => {
    vi.useFakeTimers();
    const hanging = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', hanging);
    try {
      const { SUPABASE_CLIENT_OPTIONS } = await loadModule();
      const { REQUEST_TIMEOUT_MS, RequestTimeoutError } = await import('./timeoutFetch');

      const request = SUPABASE_CLIENT_OPTIONS.global.fetch('https://example.supabase.co/rest');
      const assertion = expect(request).rejects.toBeInstanceOf(RequestTimeoutError);
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      await assertion;
      expect(hanging).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('throws when the client is not configured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    const { getSupabase, isSupabaseConfigured } = await loadModule();

    expect(isSupabaseConfigured()).toBe(false);
    expect(() => getSupabase()).toThrow(/not configured/);
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe('checkServerConnection', () => {
  it('reports "not reachable" when the health check hangs past the deadline', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    try {
      const { checkServerConnection } = await loadModule();
      const { REQUEST_TIMEOUT_MS } = await import('./timeoutFetch');

      const result = checkServerConnection();
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      expect(await result).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

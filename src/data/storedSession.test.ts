import {
  authStorageKey,
  parseStoredSessionUser,
  readStoredAuthUser,
  type ReadableStorage,
} from './storedSession';

const URL_ = 'https://abcdefghij.supabase.co';
const KEY = 'sb-abcdefghij-auth-token';

function stored(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    access_token: 'access-secret',
    refresh_token: 'refresh-secret',
    expires_at: 1_700_000_000,
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: 'user-1', email: 'owner@example.com' },
    ...overrides,
  });
}

function storageWith(entries: Record<string, string>): ReadableStorage {
  return { getItem: (key) => entries[key] ?? null };
}

describe('authStorageKey', () => {
  it('uses the first label of the project host, like supabase-js', () => {
    expect(authStorageKey(URL_)).toBe(KEY);
    expect(authStorageKey(' https://xyz.example.com/ ')).toBe('sb-xyz-auth-token');
    expect(authStorageKey('http://127.0.0.1:54321')).toBe('sb-127-auth-token');
  });

  it('invalid URL → null', () => {
    expect(authStorageKey('not a url')).toBeNull();
    expect(authStorageKey('')).toBeNull();
  });

  it('matches the default storage key of the installed supabase-js client', async () => {
    const actual =
      await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
    const client = actual.createClient(URL_, 'sb_publishable_test', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    try {
      expect((client.auth as unknown as { storageKey: string }).storageKey).toBe(KEY);
    } finally {
      await client.auth.dispose();
    }
  });
});

describe('parseStoredSessionUser', () => {
  it('returns only id and email (no tokens), even for an expired session', () => {
    const user = parseStoredSessionUser(stored());
    expect(user).toEqual({ id: 'user-1', email: 'owner@example.com' });
    expect(JSON.stringify(user)).not.toMatch(/secret/);
  });

  it('missing or empty email → null email', () => {
    expect(parseStoredSessionUser(stored({ user: { id: 'u' } }))?.email).toBeNull();
    expect(parseStoredSessionUser(stored({ user: { id: 'u', email: '' } }))?.email).toBeNull();
  });

  it.each([
    ['null', null],
    ['empty', ''],
    ['bad JSON', '{oops'],
    ['JSON null', 'null'],
    ['array', '[]'],
    ['string', '"x"'],
    ['no access_token', stored({ access_token: undefined })],
    ['no expires_at', stored({ expires_at: undefined })],
    ['no refresh_token', stored({ refresh_token: undefined })],
    ['empty refresh_token', stored({ refresh_token: '' })],
    ['no user', stored({ user: undefined })],
    ['user not an object', stored({ user: 'user-1' })],
    ['blank user id', stored({ user: { id: '  ' } })],
    ['numeric user id', stored({ user: { id: 7 } })],
  ])('%s → null', (_name, raw) => {
    expect(parseStoredSessionUser(raw)).toBeNull();
  });
});

describe('readStoredAuthUser', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it('reads the session stored under the project key', () => {
    const storage = storageWith({ [KEY]: stored() });
    expect(readStoredAuthUser({ url: URL_, storage })).toEqual({
      id: 'user-1',
      email: 'owner@example.com',
    });
  });

  it('ignores sessions of other projects', () => {
    const storage = storageWith({ 'sb-other-auth-token': stored() });
    expect(readStoredAuthUser({ url: URL_, storage })).toBeNull();
  });

  it('no URL, invalid URL or no storage → null', () => {
    const storage = storageWith({ [KEY]: stored() });
    expect(readStoredAuthUser({ url: null, storage })).toBeNull();
    expect(readStoredAuthUser({ url: 'nope', storage })).toBeNull();
    expect(readStoredAuthUser({ url: URL_, storage: null })).toBeNull();
  });

  it('a throwing storage → null', () => {
    const storage: ReadableStorage = {
      getItem() {
        throw new Error('SecurityError');
      },
    };
    expect(readStoredAuthUser({ url: URL_, storage })).toBeNull();
  });

  it('defaults to VITE_SUPABASE_URL and window.localStorage', () => {
    vi.stubEnv('VITE_SUPABASE_URL', URL_);
    expect(readStoredAuthUser()).toBeNull();
    localStorage.setItem(KEY, stored());
    expect(readStoredAuthUser()?.id).toBe('user-1');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    expect(readStoredAuthUser()).toBeNull();
  });
});

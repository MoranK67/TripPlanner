// HTTP layer of the fake Supabase backend: turns intercepted browser requests to
// `<FAKE_SUPABASE_URL>/auth/v1/**` and `/rest/v1/**` into FakeDb calls and answers in the shapes
// supabase-js expects (GoTrue session JSON, PostgREST rows / error JSON).

import type { BrowserContext, Request, Route } from '@playwright/test';
import { DbFailure, FakeDb, isUuid, type FakeUser, type PgError } from './db';

/** Used as `VITE_SUPABASE_URL` by playwright.config.ts. */
export const FAKE_SUPABASE_URL = 'http://supabase.test';
/** Used as `VITE_SUPABASE_PUBLISHABLE_KEY` by playwright.config.ts (not a secret). */
export const FAKE_PUBLISHABLE_KEY = 'sb_publishable_e2e_fake_key_not_a_secret';
/** supabase-js storage key: `sb-<first label of the host>-auth-token`. */
export const AUTH_STORAGE_KEY = 'sb-supabase-auth-token';

/** Far-future expiry (2100-01-01) so the app never tries to refresh during a test. */
const EXPIRES_AT = 4_102_444_800;

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': 'content-range, x-supabase-api-version',
};

export interface LoggedRequest {
  method: string;
  /** Path after the host, e.g. `/rest/v1/rpc/update_trip_window`. */
  path: string;
  search: URLSearchParams;
  body: unknown;
  /** Wall-clock time (ms) the fake received it; for the failure log. */
  at: number;
}

/** What to do with a matching request instead of serving it. */
export type Fault =
  | { kind: 'network' } // the request fails at transport level (fetch rejects)
  | { kind: 'http'; status: number; body: unknown };

interface FaultRule {
  match: (req: LoggedRequest) => boolean;
  fault: Fault;
  /** Remaining uses; Infinity = until cleared. */
  remaining: number;
}

export interface SessionJson {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_in: number;
  expires_at: number;
  user: Record<string, unknown>;
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function json(status: number, body: unknown, extra: Record<string, string> = {}) {
  return {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json', ...extra },
    body: body === undefined ? '' : JSON.stringify(body),
  };
}

/**
 * One fake backend per test. Owns the data (`db`), the request log and fault injection.
 * Install it on a browser context with `install(context)`.
 */
export class FakeSupabase {
  readonly db = new FakeDb();
  readonly requests: LoggedRequest[] = [];
  private faults: FaultRule[] = [];
  private tokenCounter = 0;

  // --- sessions -------------------------------------------------------------------------------

  private userJson(user: FakeUser) {
    return {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      email_confirmed_at: '2026-01-01T00:00:00Z',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
  }

  /** Issues a session the way GoTrue does (unsigned JWT: the fake never verifies signatures). */
  issueSession(user: FakeUser): SessionJson {
    this.tokenCounter += 1;
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64url(
      JSON.stringify({
        sub: user.id,
        email: user.email,
        role: 'authenticated',
        aud: 'authenticated',
        aal: 'aal1',
        exp: EXPIRES_AT,
        iat: 1_700_000_000,
        session_id: `session-${this.tokenCounter}`,
      }),
    );
    const accessToken = `${header}.${payload}.fake-signature-${this.tokenCounter}`;
    const refreshToken = `refresh-${this.tokenCounter}`;
    this.db.accessTokens.set(accessToken, user.id);
    this.db.refreshTokens.set(refreshToken, user.id);
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
      expires_in: EXPIRES_AT - Math.floor(Date.now() / 1000),
      expires_at: EXPIRES_AT,
      user: this.userJson(user),
    };
  }

  /** Server-side revocation of every session (e.g. password changed elsewhere / expiry). */
  revokeAllSessions(): void {
    this.db.accessTokens.clear();
    this.db.refreshTokens.clear();
  }

  // --- fault injection ------------------------------------------------------------------------

  /**
   * Fails matching requests. `times` = how many requests (default: until `clearFaults()`).
   * Examples: `fail(rest('GET', 'trips'), { kind: 'network' })`.
   */
  fail(match: (req: LoggedRequest) => boolean, fault: Fault, times = Infinity): void {
    this.faults.push({ match, fault, remaining: times });
  }

  clearFaults(): void {
    this.faults = [];
  }

  /** Requests that reached the fake (also the faulted ones), optionally filtered. */
  requestsTo(match: (req: LoggedRequest) => boolean): LoggedRequest[] {
    return this.requests.filter(match);
  }

  // --- routing --------------------------------------------------------------------------------

  async install(context: BrowserContext): Promise<void> {
    await context.route(`${FAKE_SUPABASE_URL}/**`, (route) => this.handle(route));
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const method = request.method();
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    const url = new URL(request.url());
    const logged: LoggedRequest = {
      method,
      path: url.pathname,
      search: url.searchParams,
      body: parseBody(request),
      at: Date.now(),
    };
    this.requests.push(logged);

    const rule = this.faults.find((f) => f.remaining > 0 && f.match(logged));
    if (rule) {
      rule.remaining -= 1;
      if (rule.fault.kind === 'network') {
        await route.abort('internetdisconnected');
      } else {
        await route.fulfill(json(rule.fault.status, rule.fault.body));
      }
      return;
    }

    try {
      if (url.pathname.startsWith('/auth/v1/')) {
        await route.fulfill(this.handleAuth(logged, request));
      } else if (url.pathname.startsWith('/rest/v1/')) {
        await route.fulfill(this.handleRest(logged, request));
      } else {
        await route.fulfill(json(404, { message: 'not found' }));
      }
    } catch (error) {
      if (error instanceof DbFailure) {
        await route.fulfill(json(error.status, error.body));
        return;
      }
      throw error;
    }
  }

  /** The user of a known session token, else null (anonymous, unknown or invalid). */
  private userIdFrom(request: Request): string | null {
    return this.db.accessTokens.get(bearerToken(request)) ?? null;
  }

  /**
   * PostgREST's view of the caller. No session (supabase-js then sends the publishable key, which
   * the API gateway turns into the anon role) → anonymous. A token that is not a live session →
   * 401 like PostgREST: PGRST303 "JWT expired" for a JWT-shaped token (our revoked sessions stand
   * for expired ones), PGRST301 for something that is not a JWT at all.
   */
  private restCaller(request: Request): string | null {
    const token = bearerToken(request);
    if (token === '' || token === FAKE_PUBLISHABLE_KEY) return null;
    const userId = this.db.accessTokens.get(token);
    if (userId !== undefined) return userId;
    const parts = token.split('.').length;
    if (parts !== 3) {
      throw new DbFailure(401, {
        code: 'PGRST301',
        message: `Expected 3 parts in JWT; got ${parts}`,
        details: null,
        hint: null,
      });
    }
    throw new DbFailure(401, {
      code: 'PGRST303',
      message: 'JWT expired',
      details: null,
      hint: null,
    });
  }

  // --- GoTrue ---------------------------------------------------------------------------------

  private handleAuth(req: LoggedRequest, request: Request) {
    const route = req.path.slice('/auth/v1/'.length);
    const version = { 'x-supabase-api-version': '2024-01-01' };
    const authError = (status: number, code: string, msg: string) =>
      json(status, { code, error_code: code, msg }, version);

    if (route === 'health') return json(200, { version: 'fake', name: 'GoTrue' });

    if (route === 'token' && req.search.get('grant_type') === 'password') {
      const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
      const user = this.db.users.find(
        (u) => u.email.toLowerCase() === String(email ?? '').toLowerCase(),
      );
      if (!user || user.password !== password) {
        return authError(400, 'invalid_credentials', 'Invalid login credentials');
      }
      return json(200, this.issueSession(user), version);
    }

    if (route === 'token' && req.search.get('grant_type') === 'refresh_token') {
      const { refresh_token: token } = (req.body ?? {}) as { refresh_token?: string };
      const userId = token ? this.db.refreshTokens.get(token) : undefined;
      const user = this.db.users.find((u) => u.id === userId);
      if (!user || !token) {
        return authError(400, 'refresh_token_not_found', 'Invalid Refresh Token');
      }
      this.db.refreshTokens.delete(token);
      return json(200, this.issueSession(user), version);
    }

    if (route === 'user' && req.method === 'GET') {
      const userId = this.userIdFrom(request);
      const user = this.db.users.find((u) => u.id === userId);
      if (!user) return authError(403, 'bad_jwt', 'invalid JWT');
      return json(200, this.userJson(user), version);
    }

    if (route === 'logout') {
      // supabase-js signs out with scope=global: every refresh token of the user is revoked.
      // Already issued access tokens stay valid JWTs until they expire, as with real GoTrue, so
      // a query still in flight during sign-out does not turn into a 401.
      const userId = this.userIdFrom(request);
      for (const [token, owner] of this.db.refreshTokens) {
        if (owner === userId) this.db.refreshTokens.delete(token);
      }
      return { status: 204, headers: CORS_HEADERS, body: '' };
    }

    if (route === 'recover') return json(200, {}, version);

    return authError(404, 'not_found', `fake GoTrue does not implement ${route}`);
  }

  // --- PostgREST ------------------------------------------------------------------------------

  private handleRest(req: LoggedRequest, request: Request) {
    const resource = req.path.slice('/rest/v1/'.length);
    const userId = this.restCaller(request);
    const wantsObject = (request.headers()['accept'] ?? '').includes(
      'application/vnd.pgrst.object+json',
    );
    const prefer = request.headers()['prefer'] ?? '';
    const returnRepresentation = prefer.includes('return=representation');

    if (resource.startsWith('rpc/')) {
      if (userId === null) throw permissionDenied(resource.slice(4));
      const result = this.db.rpc(
        userId,
        resource.slice(4),
        (req.body ?? {}) as Record<string, unknown>,
      );
      return json(200, result);
    }

    const filters = eqFilters(req.search);
    if (filters.id !== undefined && !isUuid(filters.id)) {
      throw new DbFailure(400, {
        code: '22P02',
        message: `invalid input syntax for type uuid: "${filters.id}"`,
        details: null,
        hint: null,
      });
    }
    const matchesId = (id: string) => filters.id === undefined || filters.id === id;

    if (resource === 'trips') {
      if (req.method === 'GET') {
        let rows = this.db.visibleTrips(userId).filter((t) => matchesId(t.id));
        rows = sortRows(rows, req.search.get('order'));
        const select = req.search.get('select') ?? '*';
        const shaped = rows.map((row) => this.shapeTrip(row, select, req.search, userId));
        return this.rows(shaped, wantsObject);
      }
      if (req.method === 'POST') {
        if (userId === null) throw permissionDenied('trips');
        const body = Array.isArray(req.body) ? req.body[0] : req.body;
        const row = this.db.insertTrip(userId, (body ?? {}) as Record<string, unknown>);
        return returnRepresentation
          ? this.rows([{ ...row }], wantsObject, 201)
          : { status: 201, headers: CORS_HEADERS, body: '' };
      }
      if (req.method === 'DELETE') {
        if (userId !== null) this.db.deleteTrips(userId, matchesId);
        return { status: 204, headers: CORS_HEADERS, body: '' };
      }
    }

    if (resource === 'activities') {
      if (req.method === 'GET') {
        let rows = this.db.visibleActivities(userId).filter((a) => matchesId(a.id));
        rows = sortRows(rows, req.search.get('order'));
        return this.rows(
          rows.map((r) => ({ ...r })),
          wantsObject,
        );
      }
      if (req.method === 'POST') {
        if (userId === null) throw permissionDenied('activities');
        const body = Array.isArray(req.body) ? req.body[0] : req.body;
        const row = this.db.insertActivity(userId, (body ?? {}) as Record<string, unknown>);
        return returnRepresentation
          ? this.rows([{ ...row }], wantsObject, 201)
          : { status: 201, headers: CORS_HEADERS, body: '' };
      }
      if (req.method === 'DELETE') {
        if (userId !== null) this.db.deleteActivities(userId, matchesId);
        return { status: 204, headers: CORS_HEADERS, body: '' };
      }
    }

    throw new DbFailure(404, {
      code: 'PGRST205',
      message: `fake PostgREST does not implement ${req.method} ${resource}`,
      details: null,
      hint: null,
    });
  }

  /** `select=*` / column list / `*,activities(*)` with `activities.order=…`. */
  private shapeTrip(
    row: ReturnType<FakeDb['visibleTrips']>[number],
    select: string,
    search: URLSearchParams,
    userId: string | null,
  ): Record<string, unknown> {
    const parts = select.split(',').map((p) => p.trim());
    const out: Record<string, unknown> = {};
    for (const part of parts) {
      if (part === '*') Object.assign(out, row);
      else if (part.startsWith('activities(')) {
        const children = this.db.visibleActivities(userId).filter((a) => a.trip_id === row.id);
        out.activities = sortRows(children, search.get('activities.order')).map((a) => ({ ...a }));
      } else if (part in row) {
        out[part] = row[part as keyof typeof row];
      }
    }
    return out;
  }

  private rows(rows: unknown[], wantsObject: boolean, status = 200) {
    if (!wantsObject) return json(status, rows);
    if (rows.length !== 1) {
      return json(406, {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
        details: `The result contains ${rows.length} rows`,
        hint: null,
      } satisfies PgError);
    }
    return json(status, rows[0]);
  }
}

function permissionDenied(what: string): DbFailure {
  return new DbFailure(401, {
    code: '42501',
    message: `permission denied for ${what}`,
    details: null,
    hint: null,
  });
}

function bearerToken(request: Request): string {
  return (request.headers()['authorization'] ?? '').replace(/^Bearer\s+/i, '').trim();
}

function parseBody(request: Request): unknown {
  const text = request.postData();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** `id=eq.<value>` style filters (only `eq` is used by the app). */
function eqFilters(search: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of search) {
    if (key === 'select' || key === 'order' || key.includes('.')) continue;
    if (value.startsWith('eq.')) out[key] = value.slice(3);
  }
  return out;
}

/** PostgREST `order=a.asc,b.desc` (nullslast etc. ignored). */
function sortRows<T extends object>(rows: T[], order: string | null): T[] {
  if (!order) return [...rows];
  const keys = order.split(',').map((term) => {
    const [column, direction] = term.split('.');
    return { column: column as keyof T, desc: direction === 'desc' };
  });
  return [...rows].sort((a, b) => {
    for (const { column, desc } of keys) {
      const x = a[column];
      const y = b[column];
      if (x === y) continue;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const cmp = x < y ? -1 : 1;
      return desc ? -cmp : cmp;
    }
    return 0;
  });
}

// --- request matchers for fault injection / assertions -------------------------------------

/** A PostgREST table or RPC request, e.g. `rest('POST', 'activities')`, `rest('POST', 'rpc/update_activity')`. */
export function rest(method: string, resource: string) {
  return (req: LoggedRequest) => req.method === method && req.path === `/rest/v1/${resource}`;
}

/** Any PostgREST request. */
export function anyRest() {
  return (req: LoggedRequest) => req.path.startsWith('/rest/v1/');
}

export function auth(path: string) {
  return (req: LoggedRequest) => req.path === `/auth/v1/${path}`;
}

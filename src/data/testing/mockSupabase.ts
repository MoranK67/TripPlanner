// Test-only fake of the Supabase client (DEVELOPMENT_GUIDELINES §10: unit tests never call the
// real project). Every `from(...)`/`rpc(...)` chain is recorded; awaiting it resolves the next
// queued response, so a test states exactly which requests it expects.

import { vi } from 'vitest';
import type { DbErrorLike } from '../errors';
import type { TypedSupabaseClient } from '../supabaseClient';

export interface RecordedCall {
  method: string;
  args: unknown[];
}

export interface RecordedRequest {
  /** Table name for `from`, function name for `rpc`. */
  target: string;
  kind: 'from' | 'rpc';
  /** For `rpc`: the arguments object. */
  rpcArgs?: unknown;
  /** Builder calls after `from`/`rpc`, in order (select, eq, order, maybeSingle, …). */
  calls: RecordedCall[];
}

type Response =
  | { type: 'result'; data: unknown; error: DbErrorLike | null; status: number }
  | { type: 'throw'; error: unknown };

export function createMockSupabase() {
  const queue: Response[] = [];
  const requests: RecordedRequest[] = [];
  let session: unknown = { access_token: 't', user: { id: 'user-1' } };

  function next(): Promise<unknown> {
    const response = queue.shift();
    if (!response) return Promise.reject(new Error('mockSupabase: unexpected request'));
    if (response.type === 'throw') return Promise.reject(response.error);
    const { data, error, status } = response;
    return Promise.resolve({ data, error, status });
  }

  function builder(request: RecordedRequest): unknown {
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
              next().then(onFulfilled, onRejected);
          }
          return (...args: unknown[]) => {
            request.calls.push({ method: String(prop), args });
            return proxy;
          };
        },
      },
    );
    return proxy;
  }

  const auth = {
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(async () => ({ error: null })),
    resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
    updateUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    onAuthStateChange: vi.fn(),
  };

  const client = {
    from(table: string) {
      const request: RecordedRequest = { target: table, kind: 'from', calls: [] };
      requests.push(request);
      return builder(request);
    },
    rpc(fn: string, args: unknown) {
      const request: RecordedRequest = { target: fn, kind: 'rpc', rpcArgs: args, calls: [] };
      requests.push(request);
      return builder(request);
    },
    auth,
  };

  return {
    client: client as unknown as TypedSupabaseClient,
    auth,
    requests,
    /** Queue a successful response. */
    ok(data: unknown, status = 200) {
      queue.push({ type: 'result', data, error: null, status });
      return this;
    },
    /** Queue a PostgREST error response. */
    fail(error: DbErrorLike, status = 400) {
      queue.push({ type: 'result', data: null, error, status });
      return this;
    },
    /** Queue a rejected request (e.g. a thrown fetch error). */
    throws(error: unknown) {
      queue.push({ type: 'throw', error });
      return this;
    },
    /** Change what `auth.getSession()` reports (null = signed out). */
    setSession(value: unknown) {
      session = value;
    },
    /** Responses that were queued but never consumed. */
    pending() {
      return queue.length;
    },
  };
}

export type MockSupabase = ReturnType<typeof createMockSupabase>;

/** Method names of a recorded request, e.g. ['select', 'eq', 'maybeSingle']. */
export function methods(request: RecordedRequest | undefined): string[] {
  return request?.calls.map((call) => call.method) ?? [];
}

/** Arguments of the first call of `method` in a recorded request. */
export function argsOf(
  request: RecordedRequest | undefined,
  method: string,
): unknown[] | undefined {
  return request?.calls.find((call) => call.method === method)?.args;
}

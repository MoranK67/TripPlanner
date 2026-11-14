// A `fetch` wrapper that gives every Supabase request a deadline (DATA-1).
//
// Without it a request can hang forever (a stalled mobile connection, a proxy that never answers).
// Placement writes are serialised per trip (DEC-031), so one hung request would silently stall
// every later save of that trip. With it the request fails as a retryable `network` AppError and
// the UI shows its Hebrew toast.
//
// Implementation notes:
// - One code path for every browser: an own AbortController + setTimeout, linked to the caller's
//   signal by an event listener. `AbortSignal.any` (Safari 17.4+) and `AbortSignal.timeout`
//   (Safari 16+) are not used: the fallback would be needed for older iPhones anyway, and
//   `AbortSignal.timeout` cannot be cleared, so its timer would outlive every fast response.
// - The deadline covers the whole exchange including the body: the body is read inside the
//   wrapper and handed back as a new, buffered Response. Supabase responses are small JSON; no
//   caller streams.
// - A timeout rejects with `RequestTimeoutError` (name `TimeoutError`), never `AbortError`, so
//   errors.ts maps it to `network` / retryable — not to the silent `aborted` cancel. A real
//   caller abort (TanStack Query cancelling a stale query) still rejects with the caller's
//   AbortError, unchanged.
// - Requires `db.retry: false` (SUPABASE_CLIENT_OPTIONS): postgrest-js's own retry loop would
//   otherwise re-send a GET after a non-abort fetch failure, multiplying the wait, and retries
//   must stay in exactly one layer (TanStack Query, UX-1). Timeouts are not retried at all.

/** Deadline for one Supabase HTTP request, from sending to the last byte of the body. */
export const REQUEST_TIMEOUT_MS = 15_000;

/** Thrown when a request exceeds its deadline. Name matches the DOM `TimeoutError`. */
export class RequestTimeoutError extends Error {
  override readonly name = 'TimeoutError';
  readonly timeoutMs: number;

  constructor(timeoutMs: number, options?: { cause?: unknown }) {
    super(`The request timed out after ${timeoutMs} ms.`, options);
    this.timeoutMs = timeoutMs;
  }
}

/** Statuses whose Response must be built with a `null` body. */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function callerSignalOf(input: RequestInfo | URL, init: RequestInit | undefined) {
  if (init?.signal) return init.signal;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.signal;
  return null;
}

/**
 * Headers that describe the wire body, not the decoded bytes we hand back: `arrayBuffer()`
 * already undid any compression, so keeping them would misdescribe the new body.
 */
const WIRE_BODY_HEADERS = ['content-encoding', 'content-length'];

/**
 * Reads the whole body (under the deadline) and returns an equivalent buffered Response with the
 * same status, statusText, headers (minus WIRE_BODY_HEADERS) and url. Not preserved: `redirected`
 * and `type` (a constructed Response is always `type: 'default'`); no Supabase code reads them.
 */
async function buffered(response: Response): Promise<Response> {
  // Opaque or informational responses cannot be rebuilt; Supabase never produces them.
  if (response.status < 200) return response;
  const body = NULL_BODY_STATUSES.has(response.status) ? null : await response.arrayBuffer();
  const headers = new Headers(response.headers);
  for (const name of WIRE_BODY_HEADERS) headers.delete(name);
  const copy = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  Object.defineProperty(copy, 'url', { value: response.url });
  return copy;
}

/**
 * Wraps `baseFetch` so every request is aborted after `timeoutMs`. The caller's own signal
 * (`init.signal` or the Request's signal) keeps working: whichever comes first, the caller's
 * abort (rejects with its AbortError) or the deadline (rejects with RequestTimeoutError), wins.
 */
export function createTimeoutFetch(
  baseFetch: typeof fetch = (...args) => fetch(...args),
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): typeof fetch {
  return async (input, init) => {
    const callerSignal = callerSignalOf(input, init);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onCallerAbort: () => void = () => undefined;

    // Rejects on the first of: the deadline, the caller's abort. It also aborts the request, but
    // settles by itself — even a fetch implementation that ignores its signal cannot hang.
    const stopped = new Promise<never>((_, reject) => {
      const stop = (reason: unknown) => {
        controller.abort(reason);
        reject(reason);
      };
      onCallerAbort = () =>
        stop(
          // Older Safari has no `signal.reason`: fall back to the standard AbortError.
          (callerSignal?.reason as unknown) ??
            new DOMException('The operation was aborted.', 'AbortError'),
        );
      if (callerSignal?.aborted) onCallerAbort();
      else callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
      timer = setTimeout(() => stop(new RequestTimeoutError(timeoutMs)), timeoutMs);
    });

    const work = (async () =>
      buffered(await baseFetch(input, { ...init, signal: controller.signal })))();
    // Whichever loses the race rejects later with nobody listening: keep that quiet.
    work.catch(() => undefined);
    stopped.catch(() => undefined);

    try {
      return await Promise.race([work, stopped]);
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  };
}

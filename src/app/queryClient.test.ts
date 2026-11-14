import { onlineManager } from '@tanstack/react-query';
import { AppError } from '@/data';
import {
  createQueryClient,
  MAX_QUERY_RETRIES,
  queryRetryDelay,
  shouldRetryQuery,
} from './queryClient';

/** Sets both what the policy reads (`navigator.onLine`) and TanStack's own online state. */
function setOnline(online: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
  onlineManager.setOnline(online);
}

afterEach(() => {
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('shouldRetryQuery', () => {
  it('retries retryable errors a limited number of times', () => {
    const error = new AppError('network', { retryable: true });
    expect(shouldRetryQuery(0, error)).toBe(true);
    expect(shouldRetryQuery(MAX_QUERY_RETRIES, error)).toBe(false);
  });

  it('never retries aborted, validation or auth errors', () => {
    expect(shouldRetryQuery(0, new AppError('network', { reason: 'aborted' }))).toBe(false);
    expect(shouldRetryQuery(0, new AppError('validation'))).toBe(false);
    expect(shouldRetryQuery(0, new AppError('auth_expired'))).toBe(false);
  });

  it('retries a retryable SQLSTATE online, but not a non-retryable one', () => {
    setOnline(true);
    const deadlock = new AppError('unknown', { code: '40P01', retryable: true });
    expect(shouldRetryQuery(0, deadlock)).toBe(true);
    expect(shouldRetryQuery(1, deadlock)).toBe(true);
    expect(shouldRetryQuery(2, deadlock)).toBe(false);
    expect(shouldRetryQuery(0, new AppError('unknown', { code: '42P01' }))).toBe(false);
    expect(shouldRetryQuery(0, new AppError('not_found', { code: 'PGRST116' }))).toBe(false);
  });

  it('retries an unknown (non-AppError) error once', () => {
    setOnline(true);
    expect(shouldRetryQuery(0, new Error('boom'))).toBe(true);
    expect(shouldRetryQuery(1, new Error('boom'))).toBe(false);
  });

  it('never retries while offline', () => {
    setOnline(false);
    expect(shouldRetryQuery(0, new AppError('network', { retryable: true }))).toBe(false);
    expect(shouldRetryQuery(0, new Error('boom'))).toBe(false);
  });
});

describe('queryRetryDelay', () => {
  it('backs off 1 s then 2 s, capped at 4 s', () => {
    expect(queryRetryDelay(0)).toBe(1_000);
    expect(queryRetryDelay(1)).toBe(2_000);
    expect(queryRetryDelay(2)).toBe(4_000);
    expect(queryRetryDelay(10)).toBe(4_000);
  });
});

describe('createQueryClient retry behaviour', () => {
  it('offline: a read fails at once, with a single attempt', async () => {
    setOnline(false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = createQueryClient();
    const error = new AppError('network', { retryable: true });
    const queryFn = vi.fn(() => Promise.reject(error));

    const started = Date.now();
    await expect(client.fetchQuery({ queryKey: ['offline'], queryFn })).rejects.toBe(error);

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('online: a retryable read is tried 1 + MAX_QUERY_RETRIES times with backoff', async () => {
    setOnline(true);
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = createQueryClient();
    const error = new AppError('network', { retryable: true });
    const queryFn = vi.fn(() => Promise.reject(error));

    const result = client.fetchQuery({ queryKey: ['online'], queryFn });
    const settled = expect(result).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(0);
    expect(queryFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(queryFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(queryFn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(queryFn).toHaveBeenCalledTimes(1 + MAX_QUERY_RETRIES);
    await settled;
  });

  it('online: a non-retryable read is tried once', async () => {
    setOnline(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = createQueryClient();
    const error = new AppError('validation');
    const queryFn = vi.fn(() => Promise.reject(error));

    await expect(client.fetchQuery({ queryKey: ['bad'], queryFn })).rejects.toBe(error);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('offline: a mutation fails at once and is never retried', async () => {
    setOnline(false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = createQueryClient();
    const error = new AppError('network', { retryable: true });
    const mutationFn = vi.fn(() => Promise.reject(error));

    await expect(
      client.getMutationCache().build(client, { mutationFn }).execute(undefined),
    ).rejects.toBe(error);
    expect(mutationFn).toHaveBeenCalledTimes(1);
  });
});

describe('createQueryClient error logging', () => {
  async function fail(error: unknown) {
    const client = createQueryClient();
    await client
      .fetchQuery({ queryKey: ['x'], queryFn: () => Promise.reject(error) })
      .catch(() => {});
  }

  it('ignores aborted requests and expired sessions', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await fail(new AppError('network', { reason: 'aborted' }));
    await fail(new AppError('auth_expired'));
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('logs only the kind or name, never the error data', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await fail(new AppError('unknown'));
    expect(consoleError).toHaveBeenLastCalledWith('[query] request failed', 'unknown');
    await fail(new TypeError('secret@example.com'));
    expect(consoleError).toHaveBeenLastCalledWith('[query] request failed', 'TypeError');
    await fail({ email: 'secret@example.com' });
    expect(consoleError).toHaveBeenLastCalledWith('[query] request failed', 'object');
    consoleError.mockRestore();
  });
});

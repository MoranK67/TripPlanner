import { AppError } from '@/data';
import { createQueryClient, MAX_QUERY_RETRIES, shouldRetryQuery } from './queryClient';

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

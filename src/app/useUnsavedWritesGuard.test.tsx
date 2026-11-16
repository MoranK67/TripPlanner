import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { isDataWrite, useUnsavedWritesGuard } from './useUnsavedWritesGuard';

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  renderHook(() => useUnsavedWritesGuard(), { wrapper });
  return queryClient;
}

/** Starts a mutation with `mutationKey` that stays pending until the returned function is called. */
function startMutation(queryClient: QueryClient, mutationKey: readonly unknown[]) {
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => (finish = resolve));
  const mutation = queryClient.getMutationCache().build(queryClient, {
    mutationKey,
    mutationFn: () => done,
  });
  const result = mutation.execute(undefined);
  return async () => {
    finish();
    await act(() => result);
  };
}

/** Dispatches `beforeunload` and tells whether the browser would ask "leave the site?". */
function unloadIsBlocked(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('isDataWrite', () => {
  it.each([
    [['trips', 'create'], true],
    [['activities', 'trip-1', 'import'], true],
    [['placement', 'trip-1'], true],
    [['backup', 'import'], true],
    [['backup', 'export'], false],
    [undefined, false],
  ] as const)('%j → %s', (key, expected) => {
    expect(isDataWrite(key)).toBe(expected);
  });
});

describe('useUnsavedWritesGuard (UX-4)', () => {
  it('does not block leaving when nothing is being saved', () => {
    setup();
    expect(unloadIsBlocked()).toBe(false);
  });

  it('blocks leaving while a write is pending, and stops once it is done', async () => {
    const queryClient = setup();
    let finish: () => Promise<void> = async () => {};
    act(() => {
      finish = startMutation(queryClient, ['activities', 'trip-1', 'create']);
    });
    await waitFor(() => expect(unloadIsBlocked()).toBe(true));
    await finish();
    await waitFor(() => expect(unloadIsBlocked()).toBe(false));
  });

  it('ignores mutations that only read (building the backup file)', async () => {
    const queryClient = setup();
    let finish: () => Promise<void> = async () => {};
    act(() => {
      finish = startMutation(queryClient, ['backup', 'export']);
    });
    await waitFor(() => expect(queryClient.isMutating()).toBe(1));
    expect(unloadIsBlocked()).toBe(false);
    await finish();
  });
});

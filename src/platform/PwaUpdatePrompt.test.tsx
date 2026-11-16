import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import type { PwaUpdater, PwaUpdateState } from './pwa';
import { ACTIVATION_FALLBACK_MS, PwaUpdatePrompt } from './PwaUpdatePrompt';

function fakeUpdater() {
  let state: PwaUpdateState = { needRefresh: false, reloadNeeded: false };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<PwaUpdateState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  const updater: PwaUpdater = {
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    start: vi.fn(),
    applyUpdate: vi.fn(() => Promise.resolve()),
    dismiss: vi.fn(() => set({ needRefresh: false })),
  };
  return { updater, set };
}

/** Starts a mutation that stays pending until `done` resolves. */
function PendingWrite({ done }: { done: Promise<void> }) {
  const { mutate } = useMutation({ mutationFn: () => done });
  useEffect(() => mutate(), [mutate]);
  return null;
}

function setup(opts: { enabled?: boolean; pendingWrite?: boolean } = {}) {
  const fake = fakeUpdater();
  const reload = vi.fn();
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => (finish = resolve));
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      {opts.pendingWrite && <PendingWrite done={done} />}
      <PwaUpdatePrompt updater={fake.updater} enabled={opts.enabled ?? true} reload={reload} />
    </QueryClientProvider>,
  );
  return { ...fake, reload, release: () => act(async () => finish()) };
}

describe('PwaUpdatePrompt', () => {
  it('registers the service worker and shows nothing until an update is waiting', () => {
    const { updater } = setup();
    expect(updater.start).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not register in the native shells', () => {
    const { updater, set } = setup({ enabled: false });
    act(() => set({ needRefresh: true }));
    expect(updater.start).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('offers the update and applies it on "רענון"', () => {
    const { updater, set } = setup();
    act(() => set({ needRefresh: true }));
    expect(screen.getByRole('status')).toHaveTextContent('גרסה חדשה זמינה');
    fireEvent.click(screen.getByRole('button', { name: 'רענון' }));
    expect(updater.applyUpdate).toHaveBeenCalledTimes(1);
  });

  it('"לא עכשיו" hides the prompt', () => {
    const { updater, set } = setup();
    act(() => set({ needRefresh: true }));
    fireEvent.click(screen.getByRole('button', { name: 'לא עכשיו' }));
    expect(updater.dismiss).toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('reloads once the new version controls the page', () => {
    const { reload, set } = setup();
    act(() => set({ reloadNeeded: true }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits for pending writes before activating and reloading', async () => {
    const { updater, reload, set, release } = setup({ pendingWrite: true });
    act(() => set({ needRefresh: true }));
    fireEvent.click(screen.getByRole('button', { name: /רענון/ }));
    expect(updater.applyUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('ממתין לסיום השמירה');

    await release();
    await waitFor(() => expect(updater.applyUpdate).toHaveBeenCalledTimes(1));
    expect(reload).not.toHaveBeenCalled();
  });

  it('defers a reload triggered from another tab while a write is pending', async () => {
    const { reload, set, release } = setup({ pendingWrite: true });
    act(() => set({ reloadNeeded: true }));
    expect(reload).not.toHaveBeenCalled();
    await release();
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('reloads anyway when the new version never reports control after activation', async () => {
    vi.useFakeTimers();
    try {
      const { updater, reload, set } = setup();
      act(() => set({ needRefresh: true }));
      fireEvent.click(screen.getByRole('button', { name: 'רענון' }));
      expect(updater.applyUpdate).toHaveBeenCalledTimes(1);

      await act(() => vi.advanceTimersByTimeAsync(ACTIVATION_FALLBACK_MS - 100));
      expect(reload).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(200));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the fallback reload also waits for pending writes', async () => {
    vi.useFakeTimers();
    try {
      const { updater, reload, set, release } = setup({ pendingWrite: true });
      act(() => set({ needRefresh: true }));
      fireEvent.click(screen.getByRole('button', { name: /רענון/ }));
      // Nothing is activated (so no fallback timer runs) while the write is pending.
      await act(() => vi.advanceTimersByTimeAsync(ACTIVATION_FALLBACK_MS * 2));
      expect(updater.applyUpdate).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();

      await release();
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(updater.applyUpdate).toHaveBeenCalledTimes(1);
      await act(() => vi.advanceTimersByTimeAsync(ACTIVATION_FALLBACK_MS + 100));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

import { onlineManager, QueryClient, QueryObserver } from '@tanstack/react-query';
import { syncOnlineManagerWithPlatform } from './onlineManager';

function setBrowserOnline(online: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

afterEach(() => {
  vi.restoreAllMocks();
  syncOnlineManagerWithPlatform(); // back to the (online) jsdom default
});

describe('syncOnlineManagerWithPlatform (M7.3)', () => {
  it('starts offline when the page loads offline (TanStack alone would assume online)', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    syncOnlineManagerWithPlatform();
    expect(onlineManager.isOnline()).toBe(false);
  });

  it('follows online / offline events from the platform', () => {
    syncOnlineManagerWithPlatform();
    expect(onlineManager.isOnline()).toBe(true);
    setBrowserOnline(false);
    expect(onlineManager.isOnline()).toBe(false);
    setBrowserOnline(true);
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('refetches observed queries when the connection comes back after an offline start', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    syncOnlineManagerWithPlatform();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, networkMode: 'offlineFirst' } },
    });
    client.mount();
    const queryFn = vi.fn(async () => ['רומא']);
    client.setQueryData(['trips', 'list'], ['מהמטמון']);
    const observer = new QueryObserver(client, { queryKey: ['trips', 'list'], queryFn });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1)); // mount fetch (stale data)
    await vi.waitFor(() => expect(client.isFetching()).toBe(0));

    setBrowserOnline(true);
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    unsubscribe();
    client.unmount();
  });
});

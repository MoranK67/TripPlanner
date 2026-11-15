import { onlineManager } from '@tanstack/react-query';
import { platform } from '@/platform';

/**
 * Makes TanStack's onlineManager follow the platform adapter, the same source as
 * `useOnlineStatus()` / `useCanEdit()` (M7.3). TanStack's own listener starts as "online" even
 * when the page loads offline, so after an offline reload the reconnect would not count as a
 * change and cached screens would not refetch. Here the state is read at start-up and every
 * change is forwarded, so going back online counts as a reconnect.
 *
 * On a reconnect TanStack refetches the observed queries per their `refetchOnReconnect` option.
 * By default that is only stale ones, so after a short offline spell fresh-looking (< staleTime)
 * data would not reload; queryClient.ts therefore sets `refetchOnReconnect: 'always'`.
 */
export function syncOnlineManagerWithPlatform(): void {
  onlineManager.setEventListener((setOnline) => {
    setOnline(platform.isOnline());
    return platform.subscribeOnline((online) => setOnline(online));
  });
}

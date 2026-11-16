import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import { AuthProvider } from '@/features/auth';
import { PwaUpdatePrompt } from '@/platform';
import { syncOnlineManagerWithPlatform } from './onlineManager';
import { QueryCachePersistence } from './QueryCachePersistence';
import { createQueryClient } from './queryClient';

// Once per app load, outside React's render: TanStack's onlineManager is a global singleton.
syncOnlineManagerWithPlatform();

/**
 * App-wide providers. AuthProvider also signs out when a request reports `auth_expired`;
 * QueryCachePersistence keeps the signed-in user's cache in localStorage for offline reading
 * (M7.3) and deletes it on sign-out. PwaUpdatePrompt registers the service worker (web builds) and
 * offers a reload when a new version is ready (M8.3).
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <QueryCachePersistence>{children}</QueryCachePersistence>
        </AuthProvider>
        {/* Service worker registration + "new version" prompt (M8.3); waits for pending writes. */}
        <PwaUpdatePrompt />
      </ToastProvider>
    </QueryClientProvider>
  );
}

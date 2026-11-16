// Service worker registration and update state for the installable web app (M8.3).
//
// Web only: the Tauri and Capacitor shells serve their files locally and must not register a SW.
// Update strategy = "prompt": a new version is downloaded in the background but takes over only
// after the user taps "refresh" (PwaUpdatePrompt), and the actual reload waits until no write is
// pending (the placement queue, DEC-031). An update activated from another tab is deferred the
// same way through `reloadNeeded`.
import type { RegisterSWOptions } from 'virtual:pwa-register';

export type RegisterSW = (options: RegisterSWOptions) => (reloadPage?: boolean) => Promise<void>;

export interface PwaUpdateState {
  /** A new version is installed and waiting; offer the user a refresh. */
  needRefresh: boolean;
  /** The new version already controls this page; reload as soon as it is safe. */
  reloadNeeded: boolean;
}

export interface PwaUpdater {
  getState(): PwaUpdateState;
  subscribe(listener: () => void): () => void;
  /** Register the SW once (later calls are no-ops). */
  start(): void;
  /** User agreed: activate the waiting version. The page reload follows via `reloadNeeded`. */
  applyUpdate(): Promise<void>;
  /** User chose "not now": hide the prompt until the next update is found. */
  dismiss(): void;
}

/** How often an open app checks for a new deployment (ms). */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function createPwaUpdater(loadRegister: () => Promise<RegisterSW>): PwaUpdater {
  let state: PwaUpdateState = { needRefresh: false, reloadNeeded: false };
  const listeners = new Set<() => void>();
  let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined;
  let started: Promise<void> | undefined;

  const set = (patch: Partial<PwaUpdateState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  const start = () => {
    if (started) return;
    started = loadRegister()
      .then((register) => {
        updateSW = register({
          onNeedRefresh: () => set({ needRefresh: true }),
          // Never let the plugin reload by itself: the prompt reloads once writes are done.
          onNeedReload: () => set({ reloadNeeded: true }),
          onRegisteredSW: (_url, registration) => {
            if (!registration) return;
            // Known limit: workbox-window reacts only to the FIRST `updatefound` of a page's
            // lifetime. If a second deployment lands while an earlier update is still waiting
            // (user chose "not now"), this page is not told again; the waiting SW is replaced
            // by the newer one and the next page load / "refresh" picks that up.
            setInterval(() => {
              if (navigator.onLine) void registration.update().catch(() => undefined);
            }, UPDATE_CHECK_INTERVAL_MS);
          },
          onRegisterError: (error: unknown) => {
            // Not fatal: the app works online without a SW, it just isn't available offline.
            console.warn('Service worker registration failed', error);
          },
        });
      })
      .catch((error: unknown) => {
        console.warn('Service worker registration failed', error);
      });
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    async applyUpdate() {
      await started;
      await updateSW?.(true);
    },
    dismiss: () => set({ needRefresh: false }),
  };
}

/** The app-wide updater (the virtual module is provided by vite-plugin-pwa). */
export const pwaUpdater: PwaUpdater = createPwaUpdater(() =>
  import('virtual:pwa-register').then((m) => m.registerSW),
);

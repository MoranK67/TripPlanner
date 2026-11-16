import { useIsMutating } from '@tanstack/react-query';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { platform } from './platform';
import { pwaUpdater, type PwaUpdater } from './pwa';

/**
 * After the waiting SW was told to activate, reload anyway if its `controlling` event has not
 * arrived by then (e.g. the message was lost); still only when no write is pending.
 */
export const ACTIVATION_FALLBACK_MS = 5000;

export interface PwaUpdatePromptProps {
  /** Injected in tests. */
  updater?: PwaUpdater;
  /** Register the SW? Web only: the native shells serve their files locally. */
  enabled?: boolean;
  /** Injected in tests. */
  reload?: () => void;
}

/**
 * Registers the service worker (web only) and, when a new version is waiting, shows a small
 * "new version available — refresh" bar. The reload never happens while a write is pending
 * (placement queue, saves): it waits until every mutation has settled.
 *
 * Mount once inside QueryClientProvider and the i18n setup.
 */
export function PwaUpdatePrompt({
  updater = pwaUpdater,
  enabled = platform.kind === 'web',
  reload = () => window.location.reload(),
}: PwaUpdatePromptProps) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(updater.subscribe, updater.getState, updater.getState);
  const pendingWrites = useIsMutating() > 0;
  const [requested, setRequested] = useState(false);
  const [activationTimedOut, setActivationTimedOut] = useState(false);
  const applying = useRef(false);
  const reloading = useRef(false);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (enabled) updater.start();
  }, [enabled, updater]);

  useEffect(() => () => clearTimeout(fallbackTimer.current), []);

  // The user asked for the update: activate the new SW (once) when no write is in flight.
  useEffect(() => {
    if (!requested || pendingWrites || state.reloadNeeded || applying.current) return;
    applying.current = true;
    void updater.applyUpdate().then(() => {
      fallbackTimer.current = setTimeout(() => setActivationTimedOut(true), ACTIVATION_FALLBACK_MS);
    });
  }, [requested, pendingWrites, state.reloadNeeded, updater]);

  // The new SW controls the page (this tab or another tab accepted), or it never reported
  // control after activation: reload once writes are done.
  useEffect(() => {
    if (reloading.current || pendingWrites) return;
    if (state.reloadNeeded || activationTimedOut) {
      reloading.current = true;
      clearTimeout(fallbackTimer.current);
      reload();
    }
  }, [state.reloadNeeded, activationTimedOut, pendingWrites, reload]);

  if (!enabled || (!state.needRefresh && !state.reloadNeeded)) return null;

  const waiting = pendingWrites && (requested || state.reloadNeeded);

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        // inset-x-4 + mx-auto + w-fit centres without physical left/right (RTL-safe); above the
        // home indicator on iPhone.
        'fixed inset-x-4 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-[2500] mx-auto flex w-fit max-w-[min(480px,100%)] flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-[var(--radius-card)] bg-panel px-4 py-2.5 text-sm text-ink shadow-[var(--shadow-pop)]'
      }
    >
      <span>{waiting ? t('pwa.waitingForSave') : t('pwa.updateAvailable')}</span>
      <span className="flex gap-2">
        <Button
          variant="primary"
          size="sm"
          loading={requested || state.reloadNeeded}
          onClick={() => setRequested(true)}
        >
          {t('pwa.reload')}
        </Button>
        {!requested && !state.reloadNeeded && (
          <Button variant="ghost" size="sm" onClick={() => updater.dismiss()}>
            {t('pwa.later')}
          </Button>
        )}
      </span>
    </div>
  );
}

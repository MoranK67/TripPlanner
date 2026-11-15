import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth';
import { useOnlineStatus } from '@/platform';

/**
 * Offline notice under the app header (M7.3, FR-8.3): saved trips can still be viewed, editing
 * comes back with the connection. Also shown while the device is online again but a stored
 * session is still being renewed (`stored_offline`, M7.3b; supabase-js can take up to ~90 s), so
 * the read-only screen says "reconnecting" instead of looking broken.
 *
 * The live region is always in the DOM so screen readers announce the text when it appears; it
 * is polite, so it never interrupts.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const online = useOnlineStatus();
  const { status } = useAuth();
  const message = !online
    ? t('app.offline')
    : status === 'stored_offline'
      ? t('app.reconnecting')
      : null;
  return (
    <div role="status" className="empty:hidden">
      {message && (
        <p className="m-0 border-b border-line bg-accent-soft px-4 py-2 text-center text-[13.5px] leading-relaxed font-medium text-accent-ink tablet:px-5">
          {message}
        </p>
      )}
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import { useOnlineStatus } from '@/platform';

/**
 * Offline notice under the app header (M7.3, FR-8.3): saved trips can still be viewed, editing
 * comes back with the connection. The live region is always in the DOM so screen readers announce
 * the text when it appears; it is polite, so it never interrupts.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const online = useOnlineStatus();
  return (
    <div role="status" className="empty:hidden">
      {!online && (
        <p className="m-0 border-b border-line bg-accent-soft px-4 py-2 text-center text-[13.5px] leading-relaxed font-medium text-accent-ink tablet:px-5">
          {t('app.offline')}
        </p>
      )}
    </div>
  );
}

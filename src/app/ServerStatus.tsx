import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { cx } from '@/components/ui';
import { checkServerConnection, isSupabaseConfigured } from '@/data';
import { useOnlineStatus } from '@/platform';

/**
 * Small chip showing whether the app can reach Supabase (M0 smoke check). `compact` (phone
 * header, PHONE-1): only the colored dot; the text stays for screen readers and as a tooltip.
 */
export function ServerStatus({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const configured = isSupabaseConfigured();
  const online = useOnlineStatus();
  const { data, isPending } = useQuery({
    queryKey: ['server-health'],
    queryFn: checkServerConnection,
    enabled: configured,
    staleTime: 60_000,
  });

  let label: string;
  let dot: string;
  if (!online) {
    // The browser has no network at all; the offline banner explains what still works.
    label = t('server.offline');
    dot = 'bg-danger-ink';
  } else if (!configured) {
    label = t('server.notConfigured');
    dot = 'bg-danger-ink';
  } else if (isPending) {
    label = t('server.checking');
    dot = 'bg-muted';
  } else if (data) {
    label = t('server.ok');
    dot = 'bg-ok';
  } else {
    label = t('server.error');
    dot = 'bg-danger-ink';
  }

  if (compact) {
    return (
      <span
        className={cx('flex size-6 shrink-0 items-center justify-center', className)}
        role="status"
        title={label}
      >
        <span className={`inline-block size-2.5 rounded-full ${dot}`} aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  return (
    <span
      className={cx(
        'flex items-center gap-2 rounded-full bg-bg px-3 py-1 text-xs text-ink-soft',
        className,
      )}
      role="status"
    >
      <span className={`inline-block size-2 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}

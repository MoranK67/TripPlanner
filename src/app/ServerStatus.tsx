import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { checkServerConnection, isSupabaseConfigured } from '@/data';

/** Small chip showing whether the app can reach Supabase (M0 smoke check). */
export function ServerStatus() {
  const { t } = useTranslation();
  const configured = isSupabaseConfigured();
  const { data, isPending } = useQuery({
    queryKey: ['server-health'],
    queryFn: checkServerConnection,
    enabled: configured,
    staleTime: 60_000,
  });

  let label: string;
  let dot: string;
  if (!configured) {
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

  return (
    <span
      className="flex items-center gap-2 rounded-full bg-bg px-3 py-1 text-xs text-muted"
      role="status"
    >
      <span className={`inline-block size-2 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}

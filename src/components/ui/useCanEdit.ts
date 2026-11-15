import { useTranslation } from 'react-i18next';
import { useOnlineStatus } from '@/platform';

export interface CanEdit {
  /** False while offline: cached trips stay readable, but nothing may be saved (FR-8.3). */
  canEdit: boolean;
  /** Why editing is off (Hebrew), for a disabled control's `title` or a visible note; else undefined. */
  reason: string | undefined;
}

/**
 * Whether the user may change data right now (M7.3, FR-8.3). Offline the app shows cached trips
 * read-only: edit controls are disabled with `reason` (rather than failing), and no mutation may
 * start. Shared by every feature, so all screens agree on what "offline" means
 * (`useOnlineStatus()` from the platform adapter, the same source as TanStack's onlineManager).
 */
export function useCanEdit(): CanEdit {
  const { t } = useTranslation();
  const online = useOnlineStatus();
  return { canEdit: online, reason: online ? undefined : t('common.offline.editDisabled') };
}

import { useTranslation } from 'react-i18next';
import { useOnlineStatus } from '@/platform';
import { useEditLock } from './editLockContext';

export interface CanEdit {
  /**
   * False while offline, or while the session is not confirmed by the server (M7.3b): cached
   * trips stay readable, but nothing may be saved (FR-8.3).
   */
  canEdit: boolean;
  /** Why editing is off (Hebrew), for a disabled control's `title` or a visible note; else undefined. */
  reason: string | undefined;
}

/**
 * Whether the user may change data right now (M7.3, FR-8.3). Offline the app shows cached trips
 * read-only: edit controls are disabled with `reason` (rather than failing), and no mutation may
 * start. Shared by every feature, so all screens agree on what "offline" means
 * (`useOnlineStatus()` from the platform adapter, the same source as TanStack's onlineManager).
 *
 * An `EditLockProvider` above (set by AuthProvider while only a stored, unrenewed session is
 * known) also turns editing off, with its own reason; offline, the offline reason wins.
 */
export function useCanEdit(): CanEdit {
  const { t } = useTranslation();
  const online = useOnlineStatus();
  const lock = useEditLock();
  if (!online) return { canEdit: false, reason: t('common.offline.editDisabled') };
  if (lock !== undefined) return { canEdit: false, reason: lock };
  return { canEdit: true, reason: undefined };
}

import { cx } from './cx';
import { useCanEdit } from './useCanEdit';

/**
 * Inline note for dialogs while offline: says why the save button is disabled (FR-8.3). Renders
 * nothing online. Dialogs cover the app's offline banner, so they repeat the reason themselves.
 */
export function OfflineNote({ className }: { className?: string }) {
  const { canEdit, reason } = useCanEdit();
  if (canEdit) return null;
  return (
    <p
      data-testid="offline-note"
      className={cx(
        'mt-0 mb-3.5 rounded-xl bg-accent-soft px-3 py-2 text-[13.5px] leading-relaxed text-accent-ink',
        className,
      )}
    >
      {reason}
    </p>
  );
}

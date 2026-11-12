import { useTranslation } from 'react-i18next';
import { cx } from './cx';

export interface LoadingStateProps {
  /** Text next to the spinner (also announced). Defaults to "טוען…". */
  label?: string;
  className?: string;
}

/** Centered spinner + text for a page or panel that is waiting for data. */
export function LoadingState({ label, className }: LoadingStateProps) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className={cx(
        'flex items-center justify-center gap-2.5 p-8 text-sm text-ink-soft',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="inline-block size-4 shrink-0 rounded-full border-2 border-accent-strong border-t-transparent motion-safe:animate-spin"
      />
      {label ?? t('common.loading')}
    </div>
  );
}

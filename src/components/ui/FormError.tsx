import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * Form-level error (server or network failure), shown above the fields. `role="alert"` so it is
 * announced when it appears. Field-specific messages belong in `<Field error>` instead.
 */
export function FormError({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="alert"
      className={cx(
        'mt-0 mb-3.5 rounded-xl bg-danger/40 px-3 py-2 text-[13.5px] leading-relaxed text-danger-ink',
        className,
      )}
    >
      {children}
    </p>
  );
}

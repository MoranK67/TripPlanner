import { forwardRef, type SelectHTMLAttributes } from 'react';
import { controlClass } from './controlStyles';
import { cx } from './cx';
import { useFieldControlProps } from './fieldContext';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Native <select> (best keyboard / screen-reader / mobile support) with a pastel look.
 * The chevron sits at the inline end, so it flips correctly in RTL.
 * Pass <option> elements as children.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(props, ref) {
  const { className, ...rest } = useFieldControlProps(props);
  return (
    <div className={cx('relative', className)}>
      <select
        ref={ref}
        className={cx(controlClass, 'cursor-pointer appearance-none pe-9')}
        {...rest}
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 12 8"
        className="pointer-events-none absolute end-3 top-1/2 h-2 w-3 -translate-y-1/2 text-ink-soft"
      >
        <path
          d="M1 1.5 6 6.5 11 1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
});

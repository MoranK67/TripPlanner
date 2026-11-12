import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'soft' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm' | 'icon';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink enabled:hover:bg-accent-hover',
  soft: 'bg-accent-soft text-accent-ink enabled:hover:bg-accent-soft-hover',
  // Prototype used `muted` here, which is below WCAG AA (2.96:1); ink-soft keeps the look and passes.
  ghost: 'bg-transparent text-ink-soft enabled:hover:bg-line enabled:hover:text-ink',
  danger: 'bg-danger text-danger-ink enabled:hover:bg-danger-hover',
};

// Heights: 40 / 32 px with a mouse, bumped to 44 / 40 px on touch screens (touch-friendly targets).
const sizes: Record<ButtonSize, string> = {
  md: 'min-h-10 px-4 py-2 text-sm pointer-coarse:min-h-11',
  sm: 'min-h-8 px-3 py-1.5 text-[13px] pointer-coarse:min-h-10',
  icon: 'size-9 p-0 text-lg leading-none pointer-coarse:size-11',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the full width of the container. */
  fullWidth?: boolean;
  /** Shows a spinner, sets `aria-busy` and blocks clicks while an action runs. */
  loading?: boolean;
}

/**
 * Pill-shaped button matching the prototype.
 * For `size="icon"` pass an `aria-label` — the visible content is only a symbol.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'soft',
    size = 'md',
    fullWidth = false,
    loading = false,
    disabled,
    className,
    type = 'button',
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full border-0 font-medium transition',
        'enabled:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink',
        variants[variant],
        sizes[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden="true"
          data-testid="button-spinner"
          className="inline-block size-3.5 shrink-0 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin"
        />
      )}
      {children}
    </button>
  );
});

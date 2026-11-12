import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'soft' | 'ghost' | 'danger';
type Size = 'md' | 'sm';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-strong',
  soft: 'bg-accent-soft text-accent-ink hover:bg-[#e9e2fb]',
  ghost: 'bg-transparent text-muted hover:bg-line',
  danger: 'bg-danger text-danger-ink hover:bg-[#f2aeba]',
};

const sizes: Record<Size, string> = {
  md: 'px-4 py-2 text-sm',
  sm: 'px-3 py-1.5 text-[13px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/** Pill-shaped button matching the prototype. Full primitive set comes in M3.1. */
export function Button({
  variant = 'soft',
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`cursor-pointer whitespace-nowrap rounded-full border-0 font-medium transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    />
  );
}

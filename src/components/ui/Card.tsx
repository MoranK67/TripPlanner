import type { HTMLAttributes } from 'react';

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-[var(--radius-card)] border border-line bg-panel p-6 shadow-[var(--shadow-card)] ${className}`}
      {...rest}
    />
  );
}

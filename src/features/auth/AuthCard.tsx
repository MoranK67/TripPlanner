import type { ReactNode } from 'react';
import { Card } from '@/components/ui';

/** Narrow centered card used by the login and password screens. */
export function AuthCard({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-full place-items-center py-6">
      <Card className="w-full max-w-[400px] p-6 tablet:p-8">
        <h2 className="mt-0 mb-2 text-[22px] font-bold">{title}</h2>
        {intro && <p className="mt-0 mb-5 leading-relaxed text-ink-soft">{intro}</p>}
        {children}
      </Card>
    </div>
  );
}

/** Text link styled for the auth screens. */
export const authLinkClass =
  'rounded text-[13.5px] font-medium text-accent-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink';

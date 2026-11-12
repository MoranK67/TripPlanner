import type { ReactNode } from 'react';
import { Card } from '@/components/ui';

/** One titled card on the /dev/ui gallery page. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="mb-4">
      <h3 className="mt-0 mb-4 text-base font-bold">{title}</h3>
      {children}
    </Card>
  );
}

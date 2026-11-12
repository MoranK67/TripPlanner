import type { ReactNode } from 'react';
import { cx } from './cx';

export interface SidebarLayoutProps {
  /** Side panel content (the activity bank). Shown on the start side — the right in Hebrew. */
  sidebar: ReactNode;
  /** Accessible name of the side panel landmark, e.g. "מאגר אטרקציות". */
  sidebarLabel: string;
  /** Main content (the timetable). */
  children: ReactNode;
  className?: string;
}

/**
 * Two-pane page layout from the prototype (`#main`): side panel + main area, filling the height
 * of the app's main region so each pane scrolls on its own.
 * - desktop (≥ 900 px): 270 px side panel
 * - tablet (601–899 px): 240 px side panel
 * - phone (≤ 600 px): stacked; the side panel is capped at a third of the screen height
 */
export function SidebarLayout({ sidebar, sidebarLabel, children, className }: SidebarLayoutProps) {
  return (
    <div
      className={cx(
        'grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2.5',
        'tablet:grid-cols-[240px_minmax(0,1fr)] tablet:grid-rows-1 tablet:gap-4',
        'desktop:grid-cols-[270px_minmax(0,1fr)]',
        className,
      )}
    >
      <aside
        aria-label={sidebarLabel}
        className="flex max-h-[34dvh] min-h-0 min-w-0 flex-col tablet:max-h-none"
      >
        {sidebar}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-col">{children}</div>
    </div>
  );
}

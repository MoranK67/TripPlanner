import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router-dom';
import { HeaderSlotProvider } from '@/components/ui';
import { ServerStatus } from './ServerStatus';

export const MAIN_CONTENT_ID = 'main-content';

/**
 * App shell (M3.4), matching the prototype: a white header bar (logo + title, then page controls)
 * over a main region that fills the rest of the screen. Mobile-first breakpoints from tokens.css:
 * phone ≤ 600 px (tighter padding, smaller title, page controls on their own row), `tablet:` and
 * `desktop:` (≥ 900 px). Pages put their header controls in via <HeaderActions>.
 */
export function AppLayout() {
  const { t } = useTranslation();
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);

  return (
    <div className="flex h-full flex-col">
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="sr-only rounded-full bg-panel px-4 py-2 text-sm font-medium text-accent-ink shadow-[var(--shadow-pop)] focus:not-sr-only focus:absolute focus:start-3 focus:top-3 focus:z-[4000]"
      >
        {t('app.skipToContent')}
      </a>
      <header className="flex flex-wrap items-center gap-2.5 border-b border-line bg-panel px-4 py-2.5 tablet:gap-4 tablet:px-5 tablet:py-3">
        <Link
          to="/trips"
          className="me-auto flex min-w-0 items-center gap-2.5 rounded-xl no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
        >
          <img src="/icon.svg" alt="" width={36} height={36} className="shrink-0 rounded-xl" />
          <h1 className="m-0 truncate text-[17px] font-bold tracking-tight text-ink tablet:text-[19px]">
            {t('app.title')}
          </h1>
        </Link>
        <ServerStatus />
        {/* Page controls (prototype `.trip-bar`): a full row on phones, inline from tablet up. */}
        <div
          ref={setHeaderSlot}
          data-testid="header-slot"
          className="flex w-full flex-wrap items-center gap-2 empty:hidden tablet:w-auto"
        />
      </header>
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-auto px-4 pt-2.5 pb-4 outline-none tablet:px-5 tablet:py-4"
      >
        <HeaderSlotProvider target={headerSlot}>
          <Outlet />
        </HeaderSlotProvider>
      </main>
    </div>
  );
}

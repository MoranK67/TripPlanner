import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router-dom';
import {
  cx,
  HeaderMenuButton,
  HeaderMenuProvider,
  HeaderSlotProvider,
  useBreakpoint,
} from '@/components/ui';
import { SignOutButton } from '@/features/auth';
import { OfflineBanner } from './OfflineBanner';
import { ServerStatus } from './ServerStatus';
import { useUnsavedWritesGuard } from './useUnsavedWritesGuard';

export const MAIN_CONTENT_ID = 'main-content';

/**
 * App shell (M3.4), matching the prototype: a white header bar (logo + title, then page controls)
 * over a main region that fills the rest of the screen. Mobile-first breakpoints from tokens.css:
 * phone ≤ 600 px (tighter padding, smaller title, page controls on their own row), `tablet:` and
 * `desktop:` (≥ 900 px). Pages put their header controls in via <HeaderActions>.
 *
 * Phones (PHONE-1) get one slim row instead, so the planner keeps most of the screen: the logo
 * (home link), the page's main control (the trip selector, marked `data-header-primary`; without
 * one the app title is shown), a status dot and a "⋯" menu holding every <HeaderAction> of the
 * shell and the page (edit, export, delete, new trip, backup, sign out).
 */
export function AppLayout() {
  const { t } = useTranslation();
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
  // Closing the tab mid-save would drop the write (UX-4).
  useUnsavedWritesGuard();

  const compact = useBreakpoint() === 'phone';

  return (
    <HeaderMenuProvider collapsed={compact}>
      <div className="flex h-full flex-col">
        <a
          href={`#${MAIN_CONTENT_ID}`}
          className="sr-only rounded-full bg-panel px-4 py-2 text-sm font-medium text-accent-ink shadow-[var(--shadow-pop)] focus:not-sr-only focus:absolute focus:start-3 focus:top-3 focus:z-[4000]"
        >
          {t('app.skipToContent')}
        </a>
        {/* One header and one slot element for every width: crossing the phone breakpoint (e.g.
            rotating the phone) only changes classes, so the page controls portalled into the
            slot, and any dialog they have open, stay mounted (PHONE-1). On phones the row is
            reordered visually (logo, page control, status dot, "⋯"); focus order is unchanged. */}
        <header
          className={cx(
            'flex items-center border-b border-line bg-panel',
            compact
              ? 'group/header min-h-[52px] gap-2 px-3 py-1'
              : 'flex-wrap gap-2.5 px-4 py-2.5 tablet:gap-4 tablet:px-5 tablet:py-3',
          )}
        >
          <Link
            to="/trips"
            className={cx(
              'me-auto flex min-w-0 items-center rounded-xl no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink',
              compact ? 'gap-2' : 'gap-2.5',
            )}
          >
            <img
              src="/icon.svg"
              alt=""
              width={compact ? 32 : 36}
              height={compact ? 32 : 36}
              className="shrink-0 rounded-xl"
            />
            {/* Phones: with a page control in the row (trip page) the title is for screen
                readers only. */}
            <h1
              className={cx(
                'm-0 truncate text-[17px] font-bold tracking-tight text-ink',
                compact ? 'group-has-[[data-header-primary]]/header:sr-only' : 'tablet:text-[19px]',
              )}
            >
              {t('app.title')}
            </h1>
          </Link>
          <ServerStatus compact={compact} className={compact ? 'order-2' : undefined} />
          <SignOutButton />
          {/* Page controls (prototype `.trip-bar`): inline from tablet up; on phones the slim
              row's flexible middle. */}
          <div
            ref={setHeaderSlot}
            data-testid="header-slot"
            className={cx(
              'flex items-center gap-2 empty:hidden',
              compact ? 'order-1 min-w-0 flex-1' : 'w-full flex-wrap tablet:w-auto',
            )}
          />
          {compact && <HeaderMenuButton label={t('app.moreActions')} className="order-3" />}
        </header>
        <OfflineBanner />
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-auto px-3 pt-2 pb-4 outline-none tablet:px-5 tablet:py-4"
        >
          <HeaderSlotProvider target={headerSlot}>
            <Outlet />
          </HeaderSlotProvider>
        </main>
      </div>
    </HeaderMenuProvider>
  );
}

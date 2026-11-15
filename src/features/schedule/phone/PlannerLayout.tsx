import type { ReactNode } from 'react';
import { SidebarLayout, useBreakpoint } from '@/components/ui';
import { BankSheet } from './BankSheet';
import { PlannerModeContext } from './plannerMode';

export interface PlannerLayoutProps {
  /** The bank panel (bank feature). */
  bank: ReactNode;
  /** Accessible name of the bank region, e.g. "מאגר אטרקציות". */
  bankLabel: string;
  /** Number of activities in the bank (shown on the phone's collapsed sheet). */
  bankCount: number;
  /** The `Timetable` (and anything that goes with it in the main area). */
  children: ReactNode;
}

/**
 * The planner page layout, chosen by screen width (DEC-018):
 * - tablet / desktop: the bank in a side panel next to the multi-day timetable (`SidebarLayout`);
 * - phone (< 601 px, M7.1): the timetable shows one day at a time (a `Timetable` inside reads this
 *   from context) and the bank is a bottom sheet.
 * Render it inside the `TimetableDragRoot`, so blocks drag between the bank and the timetable.
 */
export function PlannerLayout({ bank, bankLabel, bankCount, children }: PlannerLayoutProps) {
  const phone = useBreakpoint() === 'phone';
  if (!phone) {
    return (
      <PlannerModeContext.Provider value="grid">
        <SidebarLayout sidebarLabel={bankLabel} sidebar={bank}>
          {children}
        </SidebarLayout>
      </PlannerModeContext.Provider>
    );
  }
  return (
    <PlannerModeContext.Provider value="day">
      <div data-testid="planner-phone" className="flex h-full min-h-0 flex-col gap-2">
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        <BankSheet label={bankLabel} count={bankCount}>
          {bank}
        </BankSheet>
      </div>
    </PlannerModeContext.Provider>
  );
}

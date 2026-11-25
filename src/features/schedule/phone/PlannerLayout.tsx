import type { ReactNode } from 'react';
import { SidebarLayout, SlotHeightContext, useBreakpoint } from '@/components/ui';
import { TimetableMetricsContext } from '../metricsContext';
import { PHONE_METRICS } from '../timetableLayout';
import { BankSheet } from './BankSheet';
import { PlannerModeContext } from './plannerMode';

/** Where the bank is shown: the side panel (tablet / desktop) or the phone's bottom sheet. */
export type BankPlacement = 'panel' | 'sheet';

export interface PlannerLayoutProps {
  /**
   * The bank panel (bank feature). A function gets where it is shown, so the panel can adapt
   * (UX-7: inside the sheet, whose handle already shows the title, it drops its own title / card).
   */
  bank: ReactNode | ((placement: BankPlacement) => ReactNode);
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
 *   from context) and the bank is a bottom sheet. Rows are denser (PHONE-2: `PHONE_METRICS`), and
 *   the bank's blocks use the same scale (`SlotHeightContext`), as FR-3.3 asks.
 * Render it inside the `TimetableDragRoot`, so blocks drag between the bank and the timetable.
 */
export function PlannerLayout({ bank, bankLabel, bankCount, children }: PlannerLayoutProps) {
  const phone = useBreakpoint() === 'phone';
  const renderBank = (placement: BankPlacement) =>
    typeof bank === 'function' ? bank(placement) : bank;
  if (!phone) {
    return (
      <PlannerModeContext.Provider value="grid">
        <SidebarLayout sidebarLabel={bankLabel} sidebar={renderBank('panel')}>
          {children}
        </SidebarLayout>
      </PlannerModeContext.Provider>
    );
  }
  return (
    <PlannerModeContext.Provider value="day">
      <TimetableMetricsContext.Provider value={PHONE_METRICS}>
        <SlotHeightContext.Provider value={PHONE_METRICS.slotHeight}>
          <div data-testid="planner-phone" className="flex h-full min-h-0 flex-col gap-1.5">
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
            <BankSheet label={bankLabel} count={bankCount}>
              {renderBank('sheet')}
            </BankSheet>
          </div>
        </SlotHeightContext.Provider>
      </TimetableMetricsContext.Provider>
    </PlannerModeContext.Provider>
  );
}

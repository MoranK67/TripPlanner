import { forwardRef } from 'react';
import { DayPicker } from 'react-day-picker';
import { he } from 'react-day-picker/locale';
import 'react-day-picker/style.css';
import { localIsoDate, type IsoDate } from '@/domain';
import { nextRange, type DayRange } from './tripForm';

/** Local-midnight Date for an ISO date (react-day-picker works with local dates). */
function toDate(date: IsoDate | undefined): Date | undefined {
  if (!date) return undefined;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export interface TripRangeCalendarProps {
  value: DayRange;
  onChange: (range: DayRange) => void;
  /** Id of the visible group label. */
  labelledBy: string;
  /** Ids of hint / error text. */
  describedBy?: string;
  invalid?: boolean;
}

/**
 * The single range calendar of the trip dialog (FR-2.3): Hebrew, right-to-left, week starts on
 * Sunday. Selection rules are in `nextRange`; the component only translates dates. The wrapper is
 * a focusable group so the form can move focus to it when the dates are invalid.
 */
export const TripRangeCalendar = forwardRef<HTMLDivElement, TripRangeCalendarProps>(
  function TripRangeCalendar({ value, onChange, labelledBy, describedBy, invalid }, ref) {
    const from = toDate(value.from);
    return (
      <div
        ref={ref}
        role="group"
        tabIndex={-1}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className="trip-calendar flex justify-center rounded-[var(--radius-field)] border border-line-strong bg-bg px-1 py-2 outline-none focus-visible:ring-2 focus-visible:ring-accent-ink aria-invalid:border-danger-ink"
      >
        <DayPicker
          mode="range"
          locale={he}
          dir="rtl"
          showOutsideDays
          defaultMonth={from}
          selected={from ? { from, to: toDate(value.to) } : undefined}
          onSelect={(_range, day) => onChange(nextRange(value, localIsoDate(day)))}
        />
      </div>
    );
  },
);

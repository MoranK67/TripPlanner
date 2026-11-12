import type { TFunction } from 'i18next';
import {
  formatLongDate,
  formatShortDate,
  minuteLabel,
  tripDayCount,
  type TripWindow,
} from '@/domain';

/**
 * "12 בנובמבר 2026 10:00 עד 15 בנובמבר 2026 20:00" (`long`, trips list) or "12.11 10:00 עד
 * 15.11 20:00" (`short`, header bar, as in the prototype).
 */
export function tripRangeLabel(window: TripWindow, t: TFunction, style: 'long' | 'short'): string {
  const date = style === 'long' ? formatLongDate : formatShortDate;
  return t('trips.range', {
    startDate: date(window.startDate),
    startTime: minuteLabel(window.startMinute),
    endDate: date(window.endDate),
    endTime: minuteLabel(window.endMinute),
  });
}

/** "יום אחד" / "יומיים" / "4 ימים" (FR-2.8). */
export function tripDaysLabel(window: TripWindow, t: TFunction): string {
  return t('trips.days', { count: tripDayCount(window) });
}

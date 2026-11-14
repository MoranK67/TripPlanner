import type { TFunction } from 'i18next';
import type { ExportLayout } from '@/domain';
import type { ExportText } from './drawTimetable';

/**
 * Words drawn on the image, from `export.*` (the layout model only carries numbers and
 * domain-formatted dates, DEC-013 / DEC-016).
 */
export function exportText(layout: ExportLayout, t: TFunction): ExportText {
  const range = t('export.subtitle', {
    start: `${layout.start.shortDateLabel} ${layout.start.timeLabel}`,
    end: `${layout.end.shortDateLabel} ${layout.end.timeLabel}`,
  });
  return {
    subtitle: (page) =>
      page.pageCount > 1
        ? `${range} · ${t('export.pageOf', { page: page.pageNumber, total: page.pageCount })}`
        : range,
    dayCaption: (day) => t('export.dayCaption', { date: day.shortDateLabel, n: day.dayNumber }),
  };
}

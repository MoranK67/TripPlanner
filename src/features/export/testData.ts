// Test-only fixtures for the export feature.
import type { Activity, Trip } from '@/domain';

export const trip: Pick<Trip, 'name' | 'window'> = {
  name: 'רומא',
  window: { startDate: '2026-05-01', startMinute: 600, endDate: '2026-05-03', endMinute: 1080 },
};

export function placed(
  id: string,
  date: string,
  startMinute: number,
  durationMinutes: number,
  overrides: Partial<Activity> = {},
): Activity {
  return {
    id,
    tripId: 'trip-1',
    name: `אטרקציה ${id}`,
    durationMinutes,
    color: '#ffd6e0',
    placement: { date, startMinute },
    bankPosition: 0,
    ...overrides,
  };
}

/** Day 1 10:00 for three hours; day 2 07:00 for 30 minutes (widens the fitted range to 07:00). */
export const activities: Activity[] = [
  placed('a1', '2026-05-01', 600, 180, { name: 'הקולוסיאום והפורום הרומי', color: '#cde5ff' }),
  placed('a2', '2026-05-02', 420, 30, { name: 'קפה', color: '#ffe3c2' }),
  { ...placed('a3', '2026-05-02', 0, 60), placement: null, name: 'במאגר' },
];

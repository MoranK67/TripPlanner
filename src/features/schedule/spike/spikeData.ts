// SPIKE (M5.1) — throwaway. In-memory demo trip for the drag spike page.

import { addDays, canPlace, PALETTE, tripDays, type Activity, type TripWindow } from '@/domain';

const TRIP_ID = 'spike-trip';

export function spikeWindow(dayCount: number): TripWindow {
  const startDate = '2026-12-01';
  return {
    startDate,
    startMinute: 14 * 60,
    endDate: addDays(startDate, dayCount - 1),
    endMinute: 11 * 60,
  };
}

export const SAMPLE_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const;
const BANK_DURATIONS = [60, 90, 120, 30, 180, 60, 30, 240, 120, 90];

/** 10 bank activities plus up to two placed ones per day (≈180 blocks on a 90-day trip). */
export function seedActivities(window: TripWindow, nameOf: (i: number) => string): Activity[] {
  const bank: Activity[] = BANK_DURATIONS.map((durationMinutes, i) => ({
    id: `bank-${i}`,
    tripId: TRIP_ID,
    name: nameOf(i),
    durationMinutes,
    color: PALETTE[i % PALETTE.length] ?? PALETTE[0],
    placement: null,
    bankPosition: i + 1,
  }));
  const placed: Activity[] = [];
  tripDays(window).forEach((date, d) => {
    const candidates = [
      { startMinute: 9 * 60, durationMinutes: 90 },
      { startMinute: 15 * 60, durationMinutes: 60 },
    ];
    candidates.forEach((c, k) => {
      const subject = { id: `p-${d}-${k}`, tripId: TRIP_ID, durationMinutes: c.durationMinutes };
      const target = { date, startMinute: c.startMinute };
      if (!canPlace({ window, activities: placed }, subject, target).ok) return;
      const i = d * 2 + k;
      placed.push({
        ...subject,
        name: nameOf(i),
        color: PALETTE[(i + 3) % PALETTE.length] ?? PALETTE[0],
        placement: target,
        bankPosition: 0,
      });
    });
  });
  return [...bank, ...placed];
}

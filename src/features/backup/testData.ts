// Test-only backup fixtures.
import { PALETTE, type TripWithActivities } from '@/domain';

/**
 * A prototype backup ("גיבוי" button) with one good trip and one trip without a name. The good
 * trip has a placed activity, a bank activity, an overlapping one (→ bank), one without a name
 * (skipped) and one with a bad colour (replaced).
 */
export const prototypeBackup = {
  format: 'trip-planner-prototype-backup',
  version: 1,
  exportedAt: '2026-11-10T08:00:00.000Z',
  trips: [
    {
      id: 't1',
      name: 'רומא',
      startDate: '2026-05-01',
      startSlot: 20,
      endDate: '2026-05-03',
      endSlot: 36,
      colorIdx: 12,
      items: [
        {
          id: 'i1',
          name: 'קולוסיאום',
          duration: 120,
          color: '#FFD6E0',
          day: '2026-05-01',
          slot: 20,
        },
        { id: 'i2', name: 'פנתאון', duration: 60, color: '#CDE5FF', day: null, slot: null },
        { id: 'i3', name: 'חופף', duration: 60, color: '#CDE5FF', day: '2026-05-01', slot: 21 },
        { id: 'i4', name: '', duration: 60, color: '#CDE5FF', day: null, slot: null },
        { id: 'i5', name: 'צבע', duration: 60, color: 'red', day: '', slot: null },
      ],
    },
    {
      id: 't2',
      name: '',
      startDate: '2026-06-01',
      startSlot: 0,
      endDate: '2026-06-02',
      endSlot: 48,
      colorIdx: 0,
      items: [],
    },
  ],
};

export const storedTrips: TripWithActivities[] = [
  {
    trip: {
      id: 'trip-a',
      name: 'פריז',
      window: { startDate: '2026-07-10', startMinute: 540, endDate: '2026-07-11', endMinute: 1200 },
      colorCursor: 3,
    },
    activities: [
      {
        id: 'a1',
        tripId: 'trip-a',
        name: 'הלובר',
        durationMinutes: 180,
        color: PALETTE[0],
        placement: { date: '2026-07-10', startMinute: 600 },
        bankPosition: 1,
      },
      {
        id: 'a2',
        tripId: 'trip-a',
        name: 'שייט',
        durationMinutes: 90,
        color: PALETTE[1],
        placement: null,
        bankPosition: 2,
      },
    ],
  },
  {
    trip: {
      id: 'trip-b',
      name: 'לונדון',
      window: { startDate: '2026-08-01', startMinute: 0, endDate: '2026-08-01', endMinute: 1440 },
      colorCursor: 0,
    },
    activities: [],
  },
];

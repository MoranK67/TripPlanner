import { PALETTE, parseImport, type Activity } from '@/domain';
import { previewColors } from './previewColors';

function activity(overrides: Partial<Activity>): Activity {
  return {
    id: 'a',
    tripId: 'trip-1',
    name: 'קפה',
    durationMinutes: 60,
    color: PALETTE[0],
    placement: null,
    bankPosition: 1,
    ...overrides,
  };
}

const rows = (text: string) => parseImport(text).rows;

describe('previewColors (FR-6.4, FEAT-2)', () => {
  it('gives untagged rows consecutive cursor colours and skips invalid rows', () => {
    expect(previewColors(rows('א;1\nבלי זמן\nב;2'), 8, [])).toEqual([PALETTE[8], null, PALETTE[9]]);
  });

  it('gives rows with the same tag the colour of the first one, without moving the cursor', () => {
    const text = 'א;1;מרכז\nב;1;נמל\nג;1;מרכז\nד;1';
    expect(previewColors(rows(text), 0, [])).toEqual([
      PALETTE[0],
      PALETTE[1],
      PALETTE[0],
      PALETTE[2],
    ]);
  });

  it('matches a tag the trip already uses, case-insensitively, by its oldest member', () => {
    const existing = [
      activity({ id: 'new', tag: 'Center', color: PALETTE[6], createdAt: '2026-02-01T00:00:00Z' }),
      activity({ id: 'old', tag: 'center', color: PALETTE[4], createdAt: '2026-01-01T00:00:00Z' }),
    ];
    expect(previewColors(rows('א;1;CENTER\nב;1'), 7, existing)).toEqual([PALETTE[4], PALETTE[7]]);
  });
});

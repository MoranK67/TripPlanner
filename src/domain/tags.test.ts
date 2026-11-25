import { PALETTE, TAG_MAX, TAG_MIN } from './constants';
import {
  isValidTag,
  matchesTag,
  normalizeTag,
  sameTag,
  tagColor,
  tagKey,
  tripTags,
  validateTag,
} from './tags';
import type { Activity } from './types';

let nextId = 0;
function activity(tag: string | null | undefined, color: string = PALETTE[0]): Activity {
  nextId += 1;
  const base: Activity = {
    id: `a${nextId}`,
    tripId: 't1',
    name: `Activity ${nextId}`,
    durationMinutes: 60,
    color,
    placement: null,
    bankPosition: nextId,
  };
  return tag === undefined ? base : { ...base, tag };
}

describe('tag constants', () => {
  it('mirror the DB rule (1–30 characters)', () => {
    expect(TAG_MIN).toBe(1);
    expect(TAG_MAX).toBe(30);
  });
});

describe('normalizeTag', () => {
  it.each([
    ['מרכז העיר', 'מרכז העיר'],
    ['  יום 3  ', 'יום 3'],
    ['יום \t\n  3', 'יום 3'],
    ['a\u00A0\u00A0b', 'a b'],
    ['\u200Fמרכז\u200E', 'מרכז'],
    ['\uFEFFx\u2066', 'x'],
    ['Old Town', 'Old Town'],
  ])('%j → %j', (raw, expected) => {
    expect(normalizeTag(raw)).toBe(expected);
  });

  it.each([[''], ['   '], ['\t\n'], ['\u200F'], [null], [undefined]])('%j → null', (raw) => {
    expect(normalizeTag(raw)).toBeNull();
  });

  it('keeps other control characters for validateTag to report', () => {
    expect(normalizeTag('a\u0007b')).toBe('a\u0007b');
  });

  it('does not change case', () => {
    expect(normalizeTag('Centre')).toBe('Centre');
  });
});

describe('validateTag', () => {
  it('accepts 1 and TAG_MAX characters, counted in code points', () => {
    expect(validateTag('x')).toBeNull();
    expect(validateTag('א'.repeat(TAG_MAX))).toBeNull();
    expect(validateTag('🎨'.repeat(TAG_MAX))).toBeNull(); // 60 UTF-16 units
  });

  it('rejects more than TAG_MAX characters', () => {
    expect(validateTag('א'.repeat(TAG_MAX + 1))).toBe('too_long');
  });

  it.each([[''], ['   ']])('rejects blank %j as empty', (tag) => {
    expect(validateTag(tag)).toBe('empty');
  });

  it.each([[' a'], ['a '], ['a\t']])('rejects untrimmed %j', (tag) => {
    expect(validateTag(tag)).toBe('not_trimmed');
  });

  it.each([['a\u0000b'], ['a\u0007b'], ['a\nb'], ['a\u007Fb'], ['a\u0085b'], ['a\u009Fb']])(
    'rejects control characters in %j',
    (tag) => {
      expect(validateTag(tag)).toBe('control_char');
    },
  );

  it('accepts everything normalizeTag produces from ordinary text', () => {
    for (const raw of ['  יום   ב׳ ', 'Old\tTown', "יום ב'", 'שוק 🍋']) {
      const tag = normalizeTag(raw);
      expect(tag).not.toBeNull();
      expect(validateTag(tag as string)).toBeNull();
    }
  });
});

describe('isValidTag', () => {
  it('accepts null (no tag) and valid tags, rejects invalid ones', () => {
    expect(isValidTag(null)).toBe(true);
    expect(isValidTag('מרכז')).toBe(true);
    expect(isValidTag('')).toBe(false);
    expect(isValidTag('x'.repeat(TAG_MAX + 1))).toBe(false);
  });
});

describe('tagKey / sameTag', () => {
  it('compares case-insensitively after normalizing', () => {
    expect(tagKey('  Old   Town ')).toBe('old town');
    expect(sameTag('Old Town', 'old town')).toBe(true);
    expect(sameTag(' מרכז ', 'מרכז')).toBe(true);
    expect(sameTag('מרכז', 'מרכז העיר')).toBe(false);
  });

  it('never treats missing tags as the same tag', () => {
    expect(tagKey(null)).toBeNull();
    expect(tagKey('  ')).toBeNull();
    expect(sameTag(null, null)).toBe(false);
    expect(sameTag(undefined, '')).toBe(false);
    expect(sameTag('a', null)).toBe(false);
  });
});

describe('tagColor', () => {
  const a = activity('Old Town', PALETTE[2]);
  const b = activity('old town', PALETTE[5]);
  const c = activity(null, PALETTE[7]);
  const d = activity(undefined, PALETTE[8]);
  const list = [c, d, a, b];

  it('returns the colour of the first activity with the same tag (case-insensitive)', () => {
    expect(tagColor(list, 'OLD TOWN')).toBe(PALETTE[2]);
    expect(tagColor(list, '  old   town ')).toBe(PALETTE[2]);
  });

  it('ignores the activity being edited', () => {
    expect(tagColor(list, 'old town', a.id)).toBe(PALETTE[5]);
    expect(tagColor([a], 'old town', a.id)).toBeNull();
  });

  it('returns null for an unknown, empty or missing tag', () => {
    expect(tagColor(list, 'Harbour')).toBeNull();
    expect(tagColor(list, '')).toBeNull();
    expect(tagColor(list, null)).toBeNull();
    expect(tagColor(list, undefined)).toBeNull();
    expect(tagColor([], 'x')).toBeNull();
  });
});

describe('tagColor — group order like the DB (created_at, bank_position, id)', () => {
  const member = (id: string, color: string, extra: Partial<Activity>): Activity => ({
    ...activity('יום 1', color),
    id,
    ...extra,
  });

  it('picks the oldest by createdAt, whatever the list order', () => {
    const list = [
      member('x', PALETTE[1], { createdAt: '2026-11-25T10:00:00.5+00:00', bankPosition: 0 }),
      member('y', PALETTE[2], { createdAt: '2026-11-25T10:00:00+00:00', bankPosition: 9 }),
      member('z', PALETTE[3], { createdAt: '2026-11-25T10:00:00.25+00:00', bankPosition: 1 }),
    ];
    expect(tagColor(list, 'יום 1')).toBe(PALETTE[2]);
    expect(tripTags(list)[0]?.color).toBe(PALETTE[2]);
  });

  it('breaks createdAt ties by bank position, then by id', () => {
    const at = '2026-11-25T10:00:00+00:00';
    expect(
      tagColor(
        [
          member('a', PALETTE[1], { createdAt: at, bankPosition: 2 }),
          member('b', PALETTE[2], { createdAt: at, bankPosition: 1 }),
        ],
        'יום 1',
      ),
    ).toBe(PALETTE[2]);
    expect(
      tagColor(
        [
          member('b', PALETTE[1], { createdAt: at, bankPosition: 1 }),
          member('a', PALETTE[2], { createdAt: at, bankPosition: 1 }),
          member('c', PALETTE[3], { createdAt: at, bankPosition: 1 }),
        ],
        'יום 1',
      ),
    ).toBe(PALETTE[2]);
  });

  it('treats activities without createdAt (not saved yet) as the newest', () => {
    const list = [
      member('new', PALETTE[1], { bankPosition: 0 }),
      member('saved', PALETTE[2], { createdAt: '2026-01-01T00:00:00+00:00', bankPosition: 5 }),
      member('new2', PALETTE[3], { bankPosition: -1 }),
    ];
    expect(tagColor(list, 'יום 1')).toBe(PALETTE[2]);
    expect(tagColor(list, 'יום 1', 'saved')).toBe(PALETTE[3]);
  });
});

describe('tripTags', () => {
  it('lists distinct tags with first spelling, first colour and count, Hebrew-sorted', () => {
    const list = [
      activity('מרכז', PALETTE[1]),
      activity(null),
      activity('Old Town', PALETTE[2]),
      activity(' מרכז ', PALETTE[3]),
      activity(undefined),
      activity('old town', PALETTE[4]),
      activity('אגם', PALETTE[6]),
      activity('Old Town', PALETTE[2]),
    ];
    expect(tripTags(list)).toEqual([
      { tag: 'אגם', key: 'אגם', color: PALETTE[6], count: 1 },
      { tag: 'מרכז', key: 'מרכז', color: PALETTE[1], count: 2 },
      { tag: 'Old Town', key: 'old town', color: PALETTE[2], count: 3 },
    ]);
  });

  it('is empty when no activity has a tag', () => {
    expect(tripTags([activity(null), activity(undefined)])).toEqual([]);
    expect(tripTags([])).toEqual([]);
  });
});

describe('matchesTag', () => {
  it('matches every activity for null ("all") and only same-tag ones otherwise', () => {
    const tagged = activity('Old Town');
    const untagged = activity(null);
    expect(matchesTag(tagged, null)).toBe(true);
    expect(matchesTag(untagged, null)).toBe(true);
    expect(matchesTag(tagged, 'old town')).toBe(true);
    expect(matchesTag(tagged, 'harbour')).toBe(false);
    expect(matchesTag(untagged, 'old town')).toBe(false);
  });
});

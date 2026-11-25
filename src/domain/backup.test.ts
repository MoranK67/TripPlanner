import {
  APP_BACKUP_FORMAT,
  PROTOTYPE_BACKUP_FORMAT,
  backupFileName,
  createBackupFile,
  parseBackup,
  serializeBackup,
  toBackupTrip,
  type BackupParseResult,
} from './backup';
import { MAX_BACKUP_ACTIVITIES, MAX_BACKUP_TEXT_LENGTH, MAX_BACKUP_TRIPS } from './constants';
import type { Activity, TripWithActivities } from './types';

// --- Fixtures --------------------------------------------------------------------------------

function protoItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    name: 'מוזיאון',
    duration: 120,
    color: '#ffd6e0',
    day: null,
    slot: null,
    ...overrides,
  };
}

function protoTrip(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    name: 'רומא',
    startDate: '2027-03-01',
    startSlot: 20, // 10:00
    endDate: '2027-03-03',
    endSlot: 40, // 20:00
    colorIdx: 13,
    items: [],
    ...overrides,
  };
}

function protoFile(trips: unknown[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: PROTOTYPE_BACKUP_FORMAT,
    version: 1,
    exportedAt: '2026-11-14T10:00:00.000Z',
    trips,
    ...overrides,
  });
}

function appTrip(overrides: Record<string, unknown> = {}) {
  return {
    name: 'פריז',
    window: { startDate: '2027-05-10', startMinute: 600, endDate: '2027-05-11', endMinute: 1440 },
    colorCursor: 3,
    activities: [],
    ...overrides,
  };
}

function appFile(trips: unknown[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: APP_BACKUP_FORMAT,
    version: 1,
    exportedAt: '2026-11-14T10:00:00.000Z',
    trips,
    ...overrides,
  });
}

function expectOk(result: BackupParseResult) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result;
}

function warningCodes(result: BackupParseResult) {
  return result.warnings.map((w) => w.code);
}

// --- File-level ------------------------------------------------------------------------------

describe('parseBackup — file level', () => {
  it.each([
    ['empty text', ''],
    ['not JSON', 'hello'],
    ['truncated JSON', '{"format": "trip-planner-backup", "trips": ['],
  ])('rejects %s as invalid_json', (_label, text) => {
    expect(parseBackup(text)).toEqual({ ok: false, error: 'invalid_json', warnings: [] });
  });

  it.each([
    ['a JSON array', '[]'],
    ['a JSON string', '"x"'],
    ['null', 'null'],
    ['an object without marker', JSON.stringify({ trips: [protoTrip()] })],
    ['an unknown marker', JSON.stringify({ format: 'other', version: 1, trips: [] })],
  ])('rejects %s as unknown_format', (_label, text) => {
    expect(parseBackup(text)).toMatchObject({ ok: false, error: 'unknown_format' });
  });

  it.each([3, 0, '1', '2', null, undefined, 1.5])(
    'rejects app version %s as unsupported_version',
    (v) => {
      expect(parseBackup(appFile([appTrip()], { version: v }))).toMatchObject({
        ok: false,
        error: 'unsupported_version',
      });
    },
  );

  it.each([2, 0, '1', null, undefined, 1.5])(
    'rejects prototype version %s as unsupported_version',
    (v) => {
      expect(parseBackup(protoFile([protoTrip()], { version: v }))).toMatchObject({
        ok: false,
        error: 'unsupported_version',
      });
    },
  );

  it.each([1, 2])('reads app version %s and reports it', (v) => {
    expect(expectOk(parseBackup(appFile([appTrip()], { version: v }))).version).toBe(v);
  });

  it('rejects a file whose trips is not an array', () => {
    expect(parseBackup(appFile([], { trips: { a: 1 } }))).toMatchObject({
      ok: false,
      error: 'invalid_structure',
    });
    expect(parseBackup(protoFile([], { trips: undefined }))).toMatchObject({
      ok: false,
      error: 'invalid_structure',
    });
  });

  it('rejects a file with no trips', () => {
    expect(parseBackup(appFile([]))).toEqual({ ok: false, error: 'no_trips', warnings: [] });
  });

  it('rejects text longer than the limit before parsing', () => {
    expect(parseBackup(' '.repeat(MAX_BACKUP_TEXT_LENGTH + 1))).toMatchObject({
      ok: false,
      error: 'too_large',
    });
  });

  it('accepts a byte-order mark', () => {
    expect(parseBackup(`\uFEFF${appFile([appTrip()])}`).ok).toBe(true);
  });

  it('returns exportedAt when it is text, else null', () => {
    expect(expectOk(parseBackup(appFile([appTrip()]))).exportedAt).toBe('2026-11-14T10:00:00.000Z');
    expect(expectOk(parseBackup(appFile([appTrip()], { exportedAt: 5 }))).exportedAt).toBeNull();
  });

  it('reports no_valid_trips with the reasons when every trip is skipped', () => {
    const result = parseBackup(appFile([appTrip({ name: '' }), 42]));
    expect(result).toMatchObject({ ok: false, error: 'no_valid_trips' });
    expect(warningCodes(result)).toEqual(['trip_name_invalid', 'trip_invalid']);
  });

  it(`rejects more than ${MAX_BACKUP_TRIPS} valid trips`, () => {
    const trips = Array.from({ length: MAX_BACKUP_TRIPS + 1 }, () => appTrip());
    expect(parseBackup(appFile(trips))).toMatchObject({ ok: false, error: 'too_many_trips' });
    expect(parseBackup(appFile(trips.slice(1))).ok).toBe(true);
  });

  it(`counts only valid trips against the limit`, () => {
    const trips = [...Array.from({ length: MAX_BACKUP_TRIPS }, () => appTrip()), 'junk'];
    expect(parseBackup(appFile(trips)).ok).toBe(true);
  });

  it(`rejects more than ${MAX_BACKUP_ACTIVITIES} activities in total`, () => {
    const half = MAX_BACKUP_ACTIVITIES / 2;
    const activity = { name: 'א', durationMinutes: 30, color: '#FFD6E0', placement: null };
    const trip = (n: number) => appTrip({ activities: Array.from({ length: n }, () => activity) });
    expect(parseBackup(appFile([trip(half), trip(half)])).ok).toBe(true);
    expect(parseBackup(appFile([trip(half), trip(half + 1)]))).toMatchObject({
      ok: false,
      error: 'too_many_activities',
    });
  });
});

// --- Prototype format ------------------------------------------------------------------------

describe('parseBackup — prototype format', () => {
  it('maps slots to minutes, wraps the colour cursor and keeps item order', () => {
    const text = protoFile([
      protoTrip({
        items: [
          protoItem({ id: 'a', name: 'לובר', duration: 180, day: '2027-03-01', slot: 20 }),
          protoItem({ id: 'b', name: 'שייט', duration: 90, color: '#CDE5FF' }),
          protoItem({
            id: 'c',
            name: 'ארוחה',
            duration: 60,
            color: '#DAD4FA',
            day: '2027-03-03',
            slot: 38,
          }),
          protoItem({ id: 'd', name: 'גלידה', duration: 30, day: '', slot: 4 }),
        ],
      }),
    ]);
    const result = expectOk(parseBackup(text));
    expect(result.format).toBe('prototype');
    expect(result.version).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(result.activityCount).toBe(4);
    expect(result.trips).toEqual([
      {
        name: 'רומא',
        window: {
          startDate: '2027-03-01',
          startMinute: 600,
          endDate: '2027-03-03',
          endMinute: 1200,
        },
        colorCursor: 3,
        activities: [
          {
            name: 'לובר',
            durationMinutes: 180,
            color: '#FFD6E0',
            placement: { date: '2027-03-01', startMinute: 600 },
            tag: null,
          },
          { name: 'שייט', durationMinutes: 90, color: '#CDE5FF', placement: null, tag: null },
          {
            name: 'ארוחה',
            durationMinutes: 60,
            color: '#DAD4FA',
            placement: { date: '2027-03-03', startMinute: 1140 },
            tag: null,
          },
          { name: 'גלידה', durationMinutes: 30, color: '#FFD6E0', placement: null, tag: null },
        ],
      },
    ]);
  });

  it('accepts an end slot of 48 (24:00) and a missing items list', () => {
    const trip = protoTrip({ endSlot: 48, items: undefined });
    const result = expectOk(parseBackup(protoFile([trip])));
    expect(result.trips[0]?.window.endMinute).toBe(1440);
    expect(result.trips[0]?.activities).toEqual([]);
  });

  it.each([
    ['missing colorIdx', undefined, 0],
    ['negative colorIdx', -1, 9],
    ['non-number colorIdx', 'x', 0],
    ['fractional colorIdx', 12.7, 2],
  ])('normalises %s', (_label, colorIdx, expected) => {
    const result = expectOk(parseBackup(protoFile([protoTrip({ colorIdx })])));
    expect(result.trips[0]?.colorCursor).toBe(expected);
  });

  it('sends a half-set placement (day without slot) to the bank', () => {
    const text = protoFile([protoTrip({ items: [protoItem({ day: '2027-03-02', slot: null })] })]);
    const result = expectOk(parseBackup(text));
    expect(result.trips[0]?.activities[0]?.placement).toBeNull();
    expect(result.warnings).toEqual([
      {
        code: 'placement_invalid',
        tripIndex: 0,
        tripName: 'רומא',
        activityIndex: 0,
        activityName: 'מוזיאון',
      },
    ]);
  });

  it('skips an item that is not an object and keeps the rest', () => {
    const text = protoFile([protoTrip({ items: [42, protoItem()] })]);
    const result = expectOk(parseBackup(text));
    expect(result.trips[0]?.activities).toHaveLength(1);
    expect(warningCodes(result)).toEqual(['activity_invalid']);
  });

  it('sends a fractional slot to the bank', () => {
    const text = protoFile([protoTrip({ items: [protoItem({ day: '2027-03-02', slot: 3.5 })] })]);
    expect(warningCodes(parseBackup(text))).toEqual(['placement_invalid']);
  });

  it('rejects an off-grid trip slot', () => {
    const result = parseBackup(protoFile([protoTrip({ startSlot: 0.5 })]));
    expect(result).toMatchObject({ ok: false, error: 'no_valid_trips' });
    expect(warningCodes(result)).toEqual(['trip_window_invalid']);
  });
});

// --- App format ------------------------------------------------------------------------------

describe('parseBackup — app format', () => {
  it('parses trips and activities', () => {
    const text = appFile([
      appTrip({
        activities: [
          {
            name: 'מגדל אייפל',
            durationMinutes: 120,
            color: '#c8ebe3',
            placement: { date: '2027-05-10', startMinute: 600 },
          },
          { name: 'לובר', durationMinutes: 240, color: '#FFF1B5', placement: null },
          { name: 'קרואסון', durationMinutes: 30, color: '#FFE3C2' },
        ],
      }),
    ]);
    const result = expectOk(parseBackup(text));
    expect(result.format).toBe('app');
    expect(result.trips[0]).toEqual({
      name: 'פריז',
      window: { startDate: '2027-05-10', startMinute: 600, endDate: '2027-05-11', endMinute: 1440 },
      colorCursor: 3,
      activities: [
        {
          name: 'מגדל אייפל',
          durationMinutes: 120,
          color: '#C8EBE3',
          placement: { date: '2027-05-10', startMinute: 600 },
          tag: null,
        },
        { name: 'לובר', durationMinutes: 240, color: '#FFF1B5', placement: null, tag: null },
        { name: 'קרואסון', durationMinutes: 30, color: '#FFE3C2', placement: null, tag: null },
      ],
    });
  });

  describe('tags (FEAT-2, version 2)', () => {
    const tagged = (tag: unknown) => ({
      name: 'לובר',
      durationMinutes: 60,
      color: '#FFF1B5',
      placement: null,
      tag,
    });

    it('reads and normalizes tags', () => {
      const result = expectOk(
        parseBackup(
          appFile(
            [appTrip({ activities: [tagged('מרכז'), tagged('  Old   Town '), tagged(null)] })],
            { version: 2 },
          ),
        ),
      );
      expect(result.warnings).toEqual([]);
      expect(result.trips[0]?.activities.map((a) => a.tag)).toEqual(['מרכז', 'Old Town', null]);
    });

    it('treats a missing or blank tag as no tag, without a warning', () => {
      const noTag = { name: 'לובר', durationMinutes: 60, color: '#FFF1B5', placement: null };
      const result = expectOk(
        parseBackup(appFile([appTrip({ activities: [noTag, tagged('   ')] })], { version: 2 })),
      );
      expect(result.warnings).toEqual([]);
      expect(result.trips[0]?.activities.map((a) => a.tag)).toEqual([null, null]);
    });

    it('keeps the activity but drops an invalid tag, with a warning', () => {
      const activities = [
        tagged('x'.repeat(31)),
        tagged('a\u0007b'),
        tagged(7),
        tagged({ tag: 'x' }),
        tagged('ok'),
      ];
      const result = expectOk(parseBackup(appFile([appTrip({ activities })], { version: 2 })));
      expect(result.trips[0]?.activities.map((a) => a.tag)).toEqual([null, null, null, null, 'ok']);
      expect(result.warnings).toEqual(
        [0, 1, 2, 3].map((activityIndex) => ({
          code: 'activity_tag_dropped',
          tripIndex: 0,
          tripName: 'פריז',
          activityIndex,
          activityName: 'לובר',
        })),
      );
    });

    it('still reads version 1 files (no tags)', () => {
      const result = expectOk(
        parseBackup(appFile([appTrip({ activities: [tagged(undefined)] })], { version: 1 })),
      );
      expect(result.version).toBe(1);
      expect(result.trips[0]?.activities[0]?.tag).toBeNull();
    });
  });

  it('keeps going after a skipped trip and indexes warnings by file position', () => {
    const result = expectOk(parseBackup(appFile([null, appTrip({ name: 'ב' })])));
    expect(result.trips.map((t) => t.name)).toEqual(['ב']);
    expect(result.warnings).toEqual([
      {
        code: 'trip_invalid',
        tripIndex: 0,
        tripName: null,
        activityIndex: null,
        activityName: null,
      },
    ]);
  });

  it.each([
    ['missing window', { window: undefined }],
    ['window not an object', { window: 'x' }],
    ['date as number', { window: { ...appTrip().window, startDate: 20270510 } }],
    ['minute as text', { window: { ...appTrip().window, endMinute: '1440' } }],
    ['impossible date', { window: { ...appTrip().window, endDate: '2027-02-30' } }],
    [
      'end before start',
      {
        window: {
          startDate: '2027-05-10',
          startMinute: 600,
          endDate: '2027-05-10',
          endMinute: 600,
        },
      },
    ],
    [
      'longer than 90 days',
      { window: { startDate: '2027-01-01', startMinute: 0, endDate: '2027-04-01', endMinute: 60 } },
    ],
  ])('skips a trip with %s', (_label, overrides) => {
    const result = parseBackup(appFile([appTrip(overrides), appTrip()]));
    expect(expectOk(result).trips).toHaveLength(1);
    expect(warningCodes(result)).toEqual(['trip_window_invalid']);
  });

  it('accepts exactly 90 days', () => {
    const window = {
      startDate: '2027-01-01',
      startMinute: 0,
      endDate: '2027-03-31',
      endMinute: 60,
    };
    expect(expectOk(parseBackup(appFile([appTrip({ window })]))).warnings).toEqual([]);
  });

  it.each([
    ['missing', undefined],
    ['blank', '   '],
    ['too long', 'א'.repeat(51)],
    ['not text', 7],
  ])('skips a trip whose name is %s', (_label, name) => {
    const result = parseBackup(appFile([appTrip({ name }), appTrip()]));
    expect(warningCodes(result)).toEqual(['trip_name_invalid']);
  });

  it('skips a trip whose activities are not a list', () => {
    const result = parseBackup(appFile([appTrip({ activities: {} }), appTrip()]));
    expect(warningCodes(result)).toEqual(['trip_invalid']);
    expect(result.warnings[0]?.tripName).toBe('פריז');
  });

  it.each([
    ['not an object', 'x', 'activity_invalid'],
    ['without a name', { durationMinutes: 60, color: '#FFD6E0' }, 'activity_name_invalid'],
    [
      'with a 61-character name',
      { name: 'א'.repeat(61), durationMinutes: 60 },
      'activity_name_invalid',
    ],
    ['with a blank name', { name: ' ', durationMinutes: 60 }, 'activity_name_invalid'],
    ['with duration 0', { name: 'x', durationMinutes: 0 }, 'activity_duration_invalid'],
    ['with duration 45', { name: 'x', durationMinutes: 45 }, 'activity_duration_invalid'],
    ['with duration 1470', { name: 'x', durationMinutes: 1470 }, 'activity_duration_invalid'],
    ['with duration as text', { name: 'x', durationMinutes: '60' }, 'activity_duration_invalid'],
  ])('skips an activity %s', (_label, activity, code) => {
    const ok = { name: 'נשאר', durationMinutes: 60, color: '#FFD6E0', placement: null };
    const result = expectOk(parseBackup(appFile([appTrip({ activities: [activity, ok] })])));
    expect(result.trips[0]?.activities.map((a) => a.name)).toEqual(['נשאר']);
    expect(result.activityCount).toBe(1);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code, tripIndex: 0, activityIndex: 0 }),
    ]);
  });

  it.each([['#FFF'], ['red'], [null], [undefined], ['#GGGGGG']])(
    'replaces colour %s with a palette colour by position',
    (color) => {
      const activities = [
        { name: 'a', durationMinutes: 60, color: '#FFD6E0' },
        { name: 'b', durationMinutes: 60, color },
      ];
      const result = expectOk(parseBackup(appFile([appTrip({ activities })])));
      expect(result.trips[0]?.activities[1]?.color).toBe('#FFE3C2');
      expect(result.warnings).toEqual([
        {
          code: 'activity_color_replaced',
          tripIndex: 0,
          tripName: 'פריז',
          activityIndex: 1,
          activityName: 'b',
        },
      ]);
    },
  );

  it('keeps colours outside the palette (the DB only checks the format)', () => {
    const activities = [{ name: 'a', durationMinutes: 60, color: '#123abc' }];
    const result = expectOk(parseBackup(appFile([appTrip({ activities })])));
    expect(result.trips[0]?.activities[0]?.color).toBe('#123ABC');
    expect(result.warnings).toEqual([]);
  });

  describe('placements', () => {
    // Trip window: 2027-05-10 10:00 → 2027-05-11 24:00.
    function placedResult(placements: unknown[], durationMinutes = 60) {
      const activities = placements.map((placement, i) => ({
        name: `p${i}`,
        durationMinutes,
        color: '#FFD6E0',
        placement,
      }));
      return expectOk(parseBackup(appFile([appTrip({ activities })])));
    }

    it.each([
      ['not an object', 'x', 'placement_invalid'],
      ['date missing', { startMinute: 600 }, 'placement_invalid'],
      ['minute as text', { date: '2027-05-10', startMinute: '600' }, 'placement_invalid'],
      ['bad date', { date: '2027-13-01', startMinute: 600 }, 'placement_invalid'],
      ['off-grid minute', { date: '2027-05-10', startMinute: 615 }, 'placement_invalid'],
      ['minute 1440', { date: '2027-05-11', startMinute: 1440 }, 'placement_invalid'],
      ['before the trip start', { date: '2027-05-10', startMinute: 540 }, 'placement_out_of_range'],
      [
        'on a day outside the trip',
        { date: '2027-05-12', startMinute: 600 },
        'placement_out_of_range',
      ],
      ['crossing midnight', { date: '2027-05-11', startMinute: 1410 }, 'placement_out_of_range'],
    ])('sends a placement %s to the bank', (_label, placement, code) => {
      const result = placedResult([placement]);
      expect(result.trips[0]?.activities[0]?.placement).toBeNull();
      expect(warningCodes(result)).toEqual([code]);
    });

    it('accepts the first enabled slot and the last slot of the day', () => {
      const result = placedResult([
        { date: '2027-05-10', startMinute: 600 },
        { date: '2027-05-11', startMinute: 1380 },
      ]);
      expect(result.warnings).toEqual([]);
      expect(result.trips[0]?.activities.every((a) => a.placement !== null)).toBe(true);
    });

    it('keeps the first of two overlapping activities and banks the second', () => {
      const result = placedResult([
        { date: '2027-05-10', startMinute: 600 },
        { date: '2027-05-10', startMinute: 630 },
        { date: '2027-05-10', startMinute: 660 }, // touches the first: half-open, no overlap
        { date: '2027-05-11', startMinute: 630 }, // same time, other day
      ]);
      expect(result.trips[0]?.activities.map((a) => a.placement?.startMinute ?? null)).toEqual([
        600,
        null,
        660,
        630,
      ]);
      expect(result.warnings).toEqual([
        expect.objectContaining({
          code: 'placement_overlap',
          activityIndex: 1,
          activityName: 'p1',
        }),
      ]);
    });

    it('does not let a banked activity block later placements', () => {
      const result = placedResult(
        [
          { date: '2027-05-10', startMinute: 540 }, // out of range → bank
          { date: '2027-05-10', startMinute: 600 },
        ],
        120,
      );
      expect(result.trips[0]?.activities[1]?.placement).toEqual({
        date: '2027-05-10',
        startMinute: 600,
      });
    });
  });
});

// --- Serialising -----------------------------------------------------------------------------

function activity(overrides: Partial<Activity>): Activity {
  return {
    id: 'x',
    tripId: 't',
    name: 'x',
    durationMinutes: 60,
    color: '#FFD6E0',
    placement: null,
    bankPosition: 0,
    ...overrides,
  };
}

const stored: TripWithActivities = {
  trip: {
    id: 't',
    name: 'ברצלונה',
    window: { startDate: '2027-06-01', startMinute: 480, endDate: '2027-06-03', endMinute: 1320 },
    colorCursor: 4,
  },
  activities: [
    activity({ id: 'b2', name: 'bank-second', bankPosition: 5 }),
    activity({
      id: 'p2',
      name: 'placed-later',
      placement: { date: '2027-06-02', startMinute: 600 },
    }),
    activity({ id: 'b1', name: 'bank-first', bankPosition: 1.5, color: '#CDE5FF' }),
    activity({
      id: 'p1',
      name: 'placed-first',
      placement: { date: '2027-06-01', startMinute: 900 },
    }),
    activity({
      id: 'p0',
      name: 'placed-same-day',
      placement: { date: '2027-06-02', startMinute: 480 },
    }),
  ],
};

describe('toBackupTrip', () => {
  it('drops ids and orders placed (timetable order) before bank (bank order)', () => {
    const trip = toBackupTrip(stored);
    expect(trip.name).toBe('ברצלונה');
    expect(trip.colorCursor).toBe(4);
    expect(trip.activities.map((a) => a.name)).toEqual([
      'placed-first',
      'placed-same-day',
      'placed-later',
      'bank-first',
      'bank-second',
    ]);
    expect(trip.activities[3]).toEqual({
      name: 'bank-first',
      durationMinutes: 60,
      color: '#CDE5FF',
      placement: null,
      tag: null,
    });
    expect(Object.keys(trip.activities[0] ?? {})).not.toContain('id');
  });

  it('includes the tag (normalized; missing → null)', () => {
    const trip = toBackupTrip({
      trip: stored.trip,
      activities: [
        activity({ id: 'a', bankPosition: 1, tag: ' Old  Town ' }),
        activity({ id: 'b', bankPosition: 2, tag: null }),
        activity({ id: 'c', bankPosition: 3 }),
      ],
    });
    expect(trip.activities.map((a) => a.tag)).toEqual(['Old Town', null, null]);
  });

  it('does not share objects with the input', () => {
    const trip = toBackupTrip(stored);
    expect(trip.window).not.toBe(stored.trip.window);
    expect(trip.activities[0]?.placement).not.toBe(stored.activities[3]?.placement);
  });
});

describe('createBackupFile / serializeBackup', () => {
  const now = new Date('2026-11-14T08:30:00.000Z');

  it('adds the format marker, version and timestamp', () => {
    const file = createBackupFile([stored], now);
    expect(file).toMatchObject({
      format: 'trip-planner-backup',
      version: 2,
      exportedAt: '2026-11-14T08:30:00.000Z',
    });
    expect(file.trips).toHaveLength(1);
  });

  it('round-trips through parseBackup without warnings', () => {
    const text = serializeBackup([stored, { ...stored, activities: [] }], now);
    expect(text.endsWith('\n')).toBe(true);
    const result = expectOk(parseBackup(text));
    expect(result.format).toBe('app');
    expect(result.warnings).toEqual([]);
    expect(result.exportedAt).toBe('2026-11-14T08:30:00.000Z');
    expect(result.trips).toEqual([
      toBackupTrip(stored),
      toBackupTrip({ ...stored, activities: [] }),
    ]);
  });

  it('round-trips tags', () => {
    const withTags: TripWithActivities = {
      ...stored,
      activities: stored.activities.map((a, i) => ({ ...a, tag: i % 2 === 0 ? 'מרכז' : null })),
    };
    const result = expectOk(parseBackup(serializeBackup([withTags], now)));
    expect(result.version).toBe(2);
    expect(result.trips).toEqual([toBackupTrip(withTags)]);
    expect(result.trips[0]?.activities.filter((a) => a.tag === 'מרכז')).toHaveLength(3);
  });

  it('serialises an empty account (which parseBackup then reports as no_trips)', () => {
    expect(parseBackup(serializeBackup([], now))).toMatchObject({ ok: false, error: 'no_trips' });
  });
});

describe('backupFileName', () => {
  it('uses the date', () => {
    expect(backupFileName('2026-11-14')).toBe('trip-planner-backup-2026-11-14.json');
  });
});

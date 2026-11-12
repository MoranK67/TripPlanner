import { MAX_TRIP_DAYS, PALETTE } from './constants';
import {
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  buildExportLayout,
  EXPORT_DEFAULT_END_MINUTE,
  EXPORT_DEFAULT_START_MINUTE,
  exportMinuteRange,
  exportRows,
  fitOnA4,
  fittedExportRange,
  pageOrientation,
  paginateDays,
  PDF_DAYS_PER_PAGE,
  rowSpanInRange,
} from './exportLayout';
import { addDays, formatWeekday } from './time';
import type { Activity, TripWindow } from './types';

const W: TripWindow = {
  startDate: '2026-11-12',
  startMinute: 600, // 10:00
  endDate: '2026-11-14',
  endMinute: 1200, // 20:00
};

let nextId = 0;
function activity(
  durationMinutes: number,
  placement: Activity['placement'] = null,
  overrides: Partial<Activity> = {},
): Activity {
  nextId += 1;
  return {
    id: `a${String(nextId).padStart(3, '0')}`,
    tripId: 't1',
    name: `Activity ${nextId}`,
    durationMinutes,
    color: PALETTE[nextId % PALETTE.length] as string,
    placement,
    bankPosition: nextId,
    ...overrides,
  };
}

const at = (date: string, startMinute: number) => ({ date, startMinute });

describe('fittedExportRange (FR-7.3, prototype fittedRange)', () => {
  it.each<[string, Activity[], number, number]>([
    ['no activities → 08:00–22:00', [], 480, 1320],
    ['bank activities are ignored', [activity(600)], 480, 1320],
    ['inside the default range → unchanged', [activity(120, at('2026-11-13', 600))], 480, 1320],
    [
      'earlier start widens, rounded down to the hour',
      [activity(60, at('2026-11-13', 390))],
      360,
      1320,
    ],
    ['later end widens, rounded up to the hour', [activity(60, at('2026-11-13', 1290))], 480, 1380],
    ['ending at 24:00 → 24:00', [activity(120, at('2026-11-13', 1320))], 480, 1440],
    ['starting at 00:00 → 00:00', [activity(30, at('2026-11-13', 0))], 0, 1320],
    ['a 24 h activity → full day', [activity(1440, at('2026-11-13', 0))], 0, 1440],
    [
      'widened by activities on different days',
      [activity(60, at('2026-11-12', 1380)), activity(60, at('2026-11-14', 300))],
      300,
      1440,
    ],
    [
      'activities on dates outside the trip are ignored',
      [activity(60, at('2026-11-20', 0))],
      480,
      1320,
    ],
  ])('%s', (_, acts, start, end) => {
    expect(fittedExportRange(W, acts)).toEqual({ startMinute: start, endMinute: end });
  });

  it('uses the documented defaults', () => {
    expect(EXPORT_DEFAULT_START_MINUTE).toBe(480);
    expect(EXPORT_DEFAULT_END_MINUTE).toBe(1320);
  });
});

describe('exportMinuteRange', () => {
  const acts = [activity(60, at('2026-11-13', 390))];
  it('full → 00:00–24:00 regardless of activities', () => {
    expect(exportMinuteRange('full', W, acts)).toEqual({ startMinute: 0, endMinute: 1440 });
  });
  it('fitted → fittedExportRange', () => {
    expect(exportMinuteRange('fitted', W, acts)).toEqual(fittedExportRange(W, acts));
  });
});

describe('exportRows', () => {
  it('one row per slot with labels on full hours', () => {
    const rows = exportRows({ startMinute: 480, endMinute: 600 });
    expect(rows).toEqual([
      { index: 0, startMinute: 480, isHourStart: true, label: '08:00' },
      { index: 1, startMinute: 510, isHourStart: false, label: null },
      { index: 2, startMinute: 540, isHourStart: true, label: '09:00' },
      { index: 3, startMinute: 570, isHourStart: false, label: null },
    ]);
  });
  it('full day → 48 rows, last starts at 23:30', () => {
    const rows = exportRows({ startMinute: 0, endMinute: 1440 });
    expect(rows).toHaveLength(48);
    expect(rows.at(-1)).toMatchObject({ startMinute: 1410, label: null });
    expect(rows.filter((r) => r.label !== null)).toHaveLength(24);
  });
  it.each([
    [600, 600],
    [700, 600],
  ])('empty or inverted range [%s,%s) → no rows', (s, e) => {
    expect(exportRows({ startMinute: s, endMinute: e })).toEqual([]);
  });
});

describe('rowSpanInRange (half-open)', () => {
  const R = { startMinute: 480, endMinute: 1320 };
  it.each<[number, number, { top: number; height: number } | null]>([
    [480, 540, { top: 0, height: 2 }],
    [600, 690, { top: 4, height: 3 }],
    [420, 540, { top: 0, height: 2 }], // clipped at top
    [1260, 1440, { top: 26, height: 2 }], // clipped at bottom
    [0, 1440, { top: 0, height: 28 }], // larger than the range
    [420, 480, null], // ends exactly at the range start
    [1320, 1380, null], // starts exactly at the range end
    [0, 60, null],
    [600, 615, { top: 4, height: 0.5 }], // off-grid stays proportional
  ])('[%s,%s) → %j', (s, e, expected) => {
    expect(rowSpanInRange(R, s, e)).toEqual(expected);
  });
});

describe('paginateDays', () => {
  it.each<[number, number | undefined, number[]]>([
    [0, 7, []],
    [1, 7, [1]],
    [7, 7, [7]],
    [8, 7, [7, 1]],
    [14, 7, [7, 7]],
    [90, 7, [7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 6]],
    [10, undefined, [10]],
    [10, 0, [10]],
    [10, -3, [10]],
    [10, Number.NaN, [10]],
    [10, Infinity, [10]],
    [10, 3.9, [3, 3, 3, 1]],
  ])('%s items, size %s → %j', (n, size, sizes) => {
    const items = Array.from({ length: n }, (_, i) => i);
    const pages = paginateDays(items, size);
    expect(pages.map((p) => p.length)).toEqual(sizes);
    expect(pages.flat()).toEqual(items);
  });
  it('does not return the input array itself', () => {
    const items = [1, 2];
    expect(paginateDays(items)[0]).not.toBe(items);
  });
});

describe('buildExportLayout', () => {
  it('builds header, range, rows and day columns with partial first/last day bounds', () => {
    const layout = buildExportLayout({ name: 'רומא', window: W }, [], { hourRange: 'fitted' });
    expect(layout.tripName).toBe('רומא');
    expect(layout.start).toEqual({
      date: '2026-11-12',
      minute: 600,
      shortDateLabel: '12.11',
      timeLabel: '10:00',
    });
    expect(layout.end).toMatchObject({ shortDateLabel: '14.11', timeLabel: '20:00' });
    expect(layout.hourRange).toBe('fitted');
    expect(layout.range).toEqual({ startMinute: 480, endMinute: 1320 });
    expect(layout.rows).toHaveLength(28);
    expect(layout.dayCount).toBe(3);
    expect(layout.days.map((d) => [d.date, d.dayNumber, d.tripDayIndex])).toEqual([
      ['2026-11-12', 1, 0],
      ['2026-11-13', 2, 1],
      ['2026-11-14', 3, 2],
    ]);
    const [first, middle, last] = layout.days;
    expect(first?.weekdayLabel).toBe(formatWeekday('2026-11-12'));
    expect(first?.shortDateLabel).toBe('12.11');
    // First day: enabled from 10:00 → 08:00–10:00 disabled.
    expect(first?.bounds).toEqual({ startMinute: 600, endMinute: 1440 });
    expect(first?.disabled).toEqual([{ startMinute: 480, endMinute: 600, top: 0, height: 4 }]);
    expect(middle?.disabled).toEqual([]);
    // Last day: enabled until 20:00 → 20:00–22:00 disabled.
    expect(last?.bounds).toEqual({ startMinute: 0, endMinute: 1200 });
    expect(last?.disabled).toEqual([{ startMinute: 1200, endMinute: 1320, top: 24, height: 4 }]);
    expect(layout.days.every((d) => d.blocks.length === 0)).toBe(true);
  });

  it('empty trip (no activities) → one page, no blocks; full-day range', () => {
    const layout = buildExportLayout({ name: 'x', window: W }, [], { hourRange: 'full' });
    expect(layout.range).toEqual({ startMinute: 0, endMinute: 1440 });
    expect(layout.rows).toHaveLength(48);
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]?.days).toHaveLength(3);
    expect(layout.days[0]?.disabled).toEqual([
      { startMinute: 0, endMinute: 600, top: 0, height: 20 },
    ]);
    expect(layout.days[2]?.disabled).toEqual([
      { startMinute: 1200, endMinute: 1440, top: 40, height: 8 },
    ]);
  });

  it('single-day trip: both bounds on the same column', () => {
    const window: TripWindow = {
      startDate: '2026-11-12',
      startMinute: 540,
      endDate: '2026-11-12',
      endMinute: 900,
    };
    const layout = buildExportLayout({ name: 'x', window }, [], {
      hourRange: 'fitted',
      daysPerPage: PDF_DAYS_PER_PAGE,
    });
    expect(layout.dayCount).toBe(1);
    expect(layout.pages).toEqual([{ index: 0, pageNumber: 1, pageCount: 1, days: layout.days }]);
    expect(layout.days[0]?.bounds).toEqual({ startMinute: 540, endMinute: 900 });
    expect(layout.days[0]?.disabled).toEqual([
      { startMinute: 480, endMinute: 540, top: 0, height: 2 },
      { startMinute: 900, endMinute: 1320, top: 14, height: 14 },
    ]);
  });

  it('trip ending at 24:00: last day fully enabled, no extra column (§9.4)', () => {
    const window: TripWindow = {
      startDate: '2026-11-12',
      startMinute: 0,
      endDate: '2026-11-13',
      endMinute: 1440,
    };
    const late = activity(120, at('2026-11-13', 1320)); // 22:00–24:00
    const layout = buildExportLayout({ name: 'x', window }, [late], { hourRange: 'fitted' });
    expect(layout.days.map((d) => d.date)).toEqual(['2026-11-12', '2026-11-13']);
    expect(layout.range).toEqual({ startMinute: 480, endMinute: 1440 });
    expect(layout.days[1]?.bounds).toEqual({ startMinute: 0, endMinute: 1440 });
    expect(layout.days[1]?.disabled).toEqual([]);
    expect(layout.days[1]?.blocks[0]).toMatchObject({
      timeLabel: '22:00–24:00',
      endMinute: 1440,
      top: 28,
      height: 4,
      clippedStart: false,
      clippedEnd: false,
    });
    expect(layout.rows.at(-1)?.startMinute).toBe(1410);
  });

  it('positions blocks with labels and colours, sorted by start, per day', () => {
    const b = activity(150, at('2026-11-13', 720), { name: 'Vatican', color: '#cde5ff' });
    const a = activity(60, at('2026-11-13', 540), { name: 'קפה ☕' });
    const c = activity(30, at('2026-11-12', 600));
    const bank = activity(60);
    const layout = buildExportLayout({ name: 'x', window: W }, [b, bank, a, c], {
      hourRange: 'fitted',
    });
    expect(layout.days[0]?.blocks.map((x) => x.activityId)).toEqual([c.id]);
    expect(layout.days[1]?.blocks).toEqual([
      {
        activityId: a.id,
        name: 'קפה ☕',
        color: a.color,
        startMinute: 540,
        endMinute: 600,
        durationMinutes: 60,
        timeLabel: '09:00–10:00',
        durationLabel: 'שעה',
        clippedStart: false,
        clippedEnd: false,
        top: 2,
        height: 2,
      },
      {
        activityId: b.id,
        name: 'Vatican',
        color: '#cde5ff', // passed through unchanged
        startMinute: 720,
        endMinute: 870,
        durationMinutes: 150,
        timeLabel: '12:00–14:30',
        durationLabel: 'שעתיים וחצי',
        clippedStart: false,
        clippedEnd: false,
        top: 8,
        height: 5,
      },
    ]);
    expect(layout.days[2]?.blocks).toEqual([]);
  });

  it('ignores activities placed on dates outside the trip', () => {
    const stray = activity(60, at('2026-11-20', 600));
    const layout = buildExportLayout({ name: 'x', window: W }, [stray], { hourRange: 'full' });
    expect(layout.days.flatMap((d) => d.blocks)).toEqual([]);
  });

  it('touching activities (half-open) keep separate, adjacent blocks', () => {
    const a = activity(60, at('2026-11-13', 600));
    const b = activity(60, at('2026-11-13', 660));
    const layout = buildExportLayout({ name: 'x', window: W }, [a, b], { hourRange: 'fitted' });
    const blocks = layout.days[1]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    const [ba, bb] = blocks;
    expect(ba && ba.top + ba.height).toBe(bb?.top);
  });

  it('orders blocks with the same start deterministically by id', () => {
    const a = activity(60, at('2026-11-13', 600), { id: 'b' });
    const b = activity(60, at('2026-11-13', 600), { id: 'a' });
    const c = activity(60, at('2026-11-13', 600), { id: 'B' });
    const layout = buildExportLayout({ name: 'x', window: W }, [a, b, c], {
      hourRange: 'full',
    });
    // Code-unit order: upper case before lower case, regardless of locale.
    expect(layout.days[1]?.blocks.map((x) => x.activityId)).toEqual(['B', 'a', 'b']);
  });

  it('a 24 h activity spans the whole full-day grid', () => {
    const window: TripWindow = { ...W, startMinute: 0 };
    const all = activity(1440, at('2026-11-13', 0));
    const fitted = buildExportLayout({ name: 'x', window }, [all], { hourRange: 'fitted' });
    expect(fitted.range).toEqual({ startMinute: 0, endMinute: 1440 });
    expect(fitted.days[1]?.blocks[0]).toMatchObject({
      top: 0,
      height: 48,
      timeLabel: '00:00–24:00',
      durationLabel: '24 שעות',
    });
  });

  describe('90-day trip (FR-2.5 maximum)', () => {
    const window: TripWindow = {
      startDate: '2026-12-25',
      startMinute: 840,
      endDate: addDays('2026-12-25', MAX_TRIP_DAYS - 1),
      endMinute: 360,
    };
    const acts = [
      activity(60, at('2026-12-25', 900)),
      activity(90, at(addDays('2026-12-25', 50), 1350)), // 22:30–24:00 widens the range
      activity(60, at(window.endDate, 300)), // 05:00–06:00 on the last day
    ];
    const layout = buildExportLayout({ name: 'x', window }, acts, {
      hourRange: 'fitted',
      daysPerPage: PDF_DAYS_PER_PAGE,
    });

    it('has 90 columns across the year boundary', () => {
      expect(layout.dayCount).toBe(90);
      expect(layout.days[6]?.date).toBe('2026-12-31');
      expect(layout.days[7]?.date).toBe('2027-01-01');
      expect(layout.days.at(-1)?.date).toBe('2027-03-24');
    });

    it('splits into 13 pages of up to 7 days with continuous day numbers', () => {
      expect(layout.pages).toHaveLength(13);
      expect(layout.pages.map((p) => p.days.length)).toEqual([
        7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 6,
      ]);
      expect(layout.pages.every((p) => p.pageCount === 13)).toBe(true);
      expect(layout.pages[12]).toMatchObject({ index: 12, pageNumber: 13 });
      expect(layout.pages[1]?.days[0]?.dayNumber).toBe(8);
      expect(layout.pages[12]?.days.at(-1)?.dayNumber).toBe(90);
      expect(layout.pages.flatMap((p) => p.days)).toEqual(layout.days);
    });

    it('uses one shared range for every page', () => {
      expect(layout.range).toEqual({ startMinute: 300, endMinute: 1440 });
      expect(layout.rows).toHaveLength(38);
    });

    it('keeps the partial bounds of the first and last day', () => {
      expect(layout.days[0]?.disabled).toEqual([
        { startMinute: 300, endMinute: 840, top: 0, height: 18 },
      ]);
      expect(layout.days.at(-1)?.disabled).toEqual([
        { startMinute: 360, endMinute: 1440, top: 2, height: 36 },
      ]);
      expect(layout.days.at(-1)?.blocks[0]).toMatchObject({ top: 0, height: 2 });
    });
  });

  it('PNG (no daysPerPage) puts every day on one page', () => {
    const window: TripWindow = { ...W, endDate: addDays(W.startDate, 20) };
    const layout = buildExportLayout({ name: 'x', window }, [], { hourRange: 'fitted' });
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]?.days).toHaveLength(21);
  });

  it('invalid window (end before start) → no days, no pages', () => {
    const window: TripWindow = { ...W, endDate: '2026-11-01' };
    const layout = buildExportLayout({ name: 'x', window }, [], {
      hourRange: 'fitted',
      daysPerPage: 7,
    });
    expect(layout.dayCount).toBe(0);
    expect(layout.days).toEqual([]);
    expect(layout.pages).toEqual([]);
  });

  it('fitted range never cuts a block; data crossing midnight (DB-forbidden) is clipped and flagged', () => {
    const early = activity(120, at('2026-11-13', 360)); // 06:00–08:00 widens the range to 06:00
    const fitted = buildExportLayout({ name: 'x', window: W }, [early], { hourRange: 'fitted' });
    expect(fitted.days[1]?.blocks[0]).toMatchObject({ top: 0, height: 4, clippedStart: false });

    const crossing = activity(120, at('2026-11-13', 1380)); // 23:00–01:00, invalid
    const full = buildExportLayout({ name: 'x', window: W }, [crossing], { hourRange: 'full' });
    expect(full.range.endMinute).toBe(1440);
    expect(full.days[1]?.blocks[0]).toMatchObject({
      top: 46,
      height: 2,
      endMinute: 1500,
      clippedStart: false,
      clippedEnd: true,
    });
  });
});

describe('pageOrientation / fitOnA4 (FR-7.2)', () => {
  it.each([
    [1000, 500, 'landscape'],
    [500, 500, 'landscape'],
    [500, 1000, 'portrait'],
  ] as const)('%s×%s → %s', (w, h, o) => {
    expect(pageOrientation(w, h)).toBe(o);
  });

  it('fits wide content on a landscape page, centred, top margin', () => {
    const p = fitOnA4(2810, 1000);
    expect(p).toMatchObject({
      orientation: 'landscape',
      pageWidth: A4_HEIGHT_MM,
      pageHeight: A4_WIDTH_MM,
    });
    expect(p.scale).toBeCloseTo(0.1);
    expect(p.width).toBeCloseTo(281);
    expect(p.height).toBeCloseTo(100);
    expect(p.x).toBeCloseTo(8);
    expect(p.y).toBe(8);
  });

  it('fits tall content on a portrait page, limited by height', () => {
    const p = fitOnA4(500, 2810, 8);
    expect(p).toMatchObject({
      orientation: 'portrait',
      pageWidth: A4_WIDTH_MM,
      pageHeight: A4_HEIGHT_MM,
    });
    expect(p.height).toBeCloseTo(281);
    expect(p.width).toBeCloseTo(50);
    expect(p.x).toBeCloseTo((210 - 50) / 2);
  });

  it('honours a custom margin', () => {
    const p = fitOnA4(1000, 1000, 20);
    expect(p.width).toBeCloseTo(210 - 40);
    expect(p.y).toBe(20);
  });

  it('zero-size content → scale 0', () => {
    expect(fitOnA4(0, 0)).toMatchObject({ scale: 0, width: 0, height: 0 });
  });
});

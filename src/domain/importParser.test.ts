import { MAX_IMPORT_ROWS, TAG_MAX } from './constants';
import { parseImport, parseImportRow } from './importParser';
import type { ImportPlacementRequest, ImportRow } from './types';

const ok = (
  name: string,
  durationMinutes: number,
  rounded = false,
  tag: string | null = null,
): ImportRow => ({
  ok: true,
  name,
  durationMinutes,
  rounded,
  tag,
  placement: null,
  placementIssue: null,
});
const bad = (raw: string, reason: Extract<ImportRow, { ok: false }>['reason']): ImportRow => ({
  ok: false,
  raw,
  reason,
});

describe('parseImport — FR-6.2 formats', () => {
  it('parses one `name; duration` per line', () => {
    const result = parseImport('מוזיאון הלובר; 3\nשייט על הסן; 1.5\nארוחת ערב; 1:30');
    expect(result.rows).toEqual([
      ok('מוזיאון הלובר', 180),
      ok('שייט על הסן', 90),
      ok('ארוחת ערב', 90),
    ]);
    expect(result).toMatchObject({ validCount: 3, invalidCount: 0, exceedsLimit: false });
  });

  it('parses `{name;duration},{name;duration}`', () => {
    expect(parseImport('{Louvre;3},{Seine cruise;1,5}, {ארוחה; שעתיים}').rows).toEqual([
      ok('Louvre', 180),
      ok('Seine cruise', 90),
      ok('ארוחה', 120),
    ]);
  });

  it('parses brace groups spread over several lines', () => {
    expect(parseImport('{a;1},\n{b;2}\n').rows).toEqual([ok('a', 60), ok('b', 120)]);
  });

  it('parses two tab-separated columns pasted from Excel (CRLF)', () => {
    expect(parseImport('Louvre\t3\r\nOrsay\t2:30\r\n').rows).toEqual([
      ok('Louvre', 180),
      ok('Orsay', 150),
    ]);
  });
});

describe('parseImport — rows and reasons (FR-6.4)', () => {
  it('ignores empty and whitespace-only lines', () => {
    const result = parseImport('\n\nLouvre; 3\n   \n\t\nOrsay; 2\n\n');
    expect(result.rows).toEqual([ok('Louvre', 180), ok('Orsay', 120)]);
  });

  it('flags a header row as invalid', () => {
    const result = parseImport('שם; זמן\nLouvre; 3');
    expect(result.rows[0]).toEqual(bad('שם; זמן', 'invalid_duration'));
    expect(result).toMatchObject({ validCount: 1, invalidCount: 1 });
    expect(parseImport('name\tduration\nLouvre\t3').rows[0]).toEqual(
      bad('name\tduration', 'invalid_duration'),
    );
  });

  it('marks rounded durations', () => {
    expect(parseImport('Coffee; 40 דקות\nWalk; 1.25').rows).toEqual([
      ok('Coffee', 30, true),
      ok('Walk', 90, true),
    ]);
  });

  it.each([
    ['Louvre 3', 'missing_separator'],
    ['; 3', 'missing_name'],
    ['  ;3', 'missing_name'],
    ['Louvre;', 'missing_duration'],
    ['Louvre;   ', 'missing_duration'],
    ['Louvre; soon', 'invalid_duration'],
    ['Louvre; 2:75', 'invalid_duration'],
    ['Louvre; 10 דקות', 'duration_out_of_range'],
    ['Louvre; 0', 'duration_out_of_range'],
    ['Louvre; 25', 'duration_out_of_range'],
    ['Louvre; 24:30', 'duration_out_of_range'],
  ] as const)('%s → %s', (line, reason) => {
    expect(parseImportRow(line)).toEqual(bad(line.trim(), reason));
  });

  it('accepts the duration bounds 30 min and 24 h, rounding into range', () => {
    expect(parseImportRow('a; 15 דקות')).toEqual(ok('a', 30, true));
    expect(parseImportRow('a; 24')).toEqual(ok('a', 1440));
    expect(parseImportRow('a; 24:14')).toEqual(ok('a', 1440, true));
  });

  it('keeps raw text trimmed in invalid rows', () => {
    expect(parseImport('   just a name   ').rows).toEqual([
      bad('just a name', 'missing_separator'),
    ]);
  });
});

describe('parseImport — names', () => {
  it('accepts 60 characters, emoji and mixed Hebrew/English', () => {
    const sixty = 'א'.repeat(60);
    expect(parseImportRow(`${sixty}; 1`)).toEqual(ok(sixty, 60));
    expect(parseImportRow('Musée d’Orsay מוזיאון 🎨; 2')).toEqual(
      ok('Musée d’Orsay מוזיאון 🎨', 120),
    );
    const emoji = '😀'.repeat(60); // 60 code points, 120 UTF-16 units
    expect(parseImportRow(`${emoji}; 1`)).toEqual(ok(emoji, 60));
  });

  it('rejects names longer than 60 characters instead of truncating', () => {
    const line = `${'a'.repeat(61)}; 1`;
    expect(parseImportRow(line)).toEqual(bad(line, 'name_too_long'));
  });

  it('keeps `;` inside a name (last separator wins)', () => {
    expect(parseImportRow('Rock; Roll; 2')).toEqual(ok('Rock; Roll', 120));
  });

  it('prefers the tab separator for Excel rows whose name contains `;`', () => {
    expect(parseImportRow('Rock; Roll\t2')).toEqual(ok('Rock; Roll', 120));
  });

  it('accepts an empty middle Excel column', () => {
    expect(parseImportRow('Louvre\t\t3')).toEqual(ok('Louvre', 180));
  });

  it('removes Excel cell quoting and tidies whitespace', () => {
    expect(parseImportRow('"Café ""Flore"""\t1')).toEqual(ok('Café "Flore"', 60));
    expect(parseImportRow('Big   Ben ; 1')).toEqual(ok('Big Ben', 60));
  });

  it('accepts the Arabic semicolon', () => {
    expect(parseImportRow(`Louvre${String.fromCodePoint(0x61b)} 3`)).toEqual(ok('Louvre', 180));
  });
});

describe('parseImport — tags (FEAT-2)', () => {
  it('reads an optional third field in the line format', () => {
    expect(parseImport("מוזיאון הוותיקן;3;יום ב'\nקפה; 1").rows).toEqual([
      ok('מוזיאון הוותיקן', 180, false, "יום ב'"),
      ok('קפה', 60),
    ]);
  });

  it('reads `{name;duration;tag}` groups', () => {
    expect(parseImport('{Louvre;3;מרכז},{Seine;1,5},{Orsay; 2 ; מרכז }').rows).toEqual([
      ok('Louvre', 180, false, 'מרכז'),
      ok('Seine', 90),
      ok('Orsay', 120, false, 'מרכז'),
    ]);
  });

  it('reads a third tab-separated Excel column, with Excel quoting', () => {
    expect(parseImport('Louvre\t3\tCentre\r\nOrsay\t2:30\t"Left ""bank"""\r\n').rows).toEqual([
      ok('Louvre', 180, false, 'Centre'),
      ok('Orsay', 150, false, 'Left "bank"'),
    ]);
  });

  it('keeps the `;` of a name when the tab separates the columns', () => {
    expect(parseImportRow('Rock; Roll\t2\tמוזיקה')).toEqual(ok('Rock; Roll', 120, false, 'מוזיקה'));
  });

  it('normalizes the tag: trims, collapses spaces, removes bidi marks', () => {
    expect(parseImportRow('a; 1;   יום    3  ')).toEqual(ok('a', 60, false, 'יום 3'));
    expect(parseImportRow('a; 1; \u200Fמרכז\u200E')).toEqual(ok('a', 60, false, 'מרכז'));
  });

  it('treats an empty or blank third field as no tag', () => {
    expect(parseImportRow('a; 1;')).toEqual(ok('a', 60));
    expect(parseImportRow('a; 1;   ')).toEqual(ok('a', 60));
    expect(parseImport('{a;1;}').rows).toEqual([ok('a', 60)]);
  });

  it('marks rounding also for three-field rows', () => {
    expect(parseImportRow('a; 40 דקות; x')).toEqual(ok('a', 30, true, 'x'));
  });

  it('accepts a tag of exactly TAG_MAX characters (code points)', () => {
    const tag = '🎨'.repeat(TAG_MAX);
    expect(parseImportRow(`a; 1; ${tag}`)).toEqual(ok('a', 60, false, tag));
  });

  it('rejects a tag longer than TAG_MAX characters', () => {
    const line = `a; 1; ${'א'.repeat(TAG_MAX + 1)}`;
    expect(parseImportRow(line)).toEqual(bad(line, 'tag_too_long'));
  });

  it('rejects a tag with control characters', () => {
    const line = 'a; 1; מרכז\u0007';
    expect(parseImportRow(line)).toEqual(bad(line, 'tag_invalid'));
  });

  it('checks the name and the duration before the tag', () => {
    expect(parseImportRow(`; 1; ${'א'.repeat(40)}`)).toMatchObject({ reason: 'missing_name' });
    expect(parseImportRow('a; 25; x')).toMatchObject({ reason: 'duration_out_of_range' });
  });

  it('falls back to `name;duration` when the middle field is not a duration', () => {
    // A name with `;` keeps working; the last field is the duration.
    expect(parseImportRow('Rock; Roll; 2')).toEqual(ok('Rock; Roll', 120));
    expect(parseImportRow('a;;tag')).toMatchObject({ ok: false, reason: 'invalid_duration' });
    expect(parseImportRow('a; b; c')).toMatchObject({ ok: false, reason: 'invalid_duration' });
  });

  it('with more fields, splits on the last two separators', () => {
    expect(parseImportRow('Rock; Roll; 2; מוזיקה')).toEqual(ok('Rock; Roll', 120, false, 'מוזיקה'));
  });

  it('counts a row with a bad tag as invalid', () => {
    const result = parseImport(`a; 1; ok\nb; 1; ${'x'.repeat(TAG_MAX + 1)}`);
    expect(result).toMatchObject({ validCount: 1, invalidCount: 1 });
  });
});

describe('parseImport — day and start fields (FEAT-3)', () => {
  const placed = (
    name: string,
    durationMinutes: number,
    tag: string | null,
    placement: ImportPlacementRequest,
  ): ImportRow => ({
    ok: true,
    name,
    durationMinutes,
    rounded: false,
    tag,
    placement,
    placementIssue: null,
  });
  const at = (day: number, startMinute: number, startRounded = false) => ({
    day,
    startMinute,
    startRounded,
  });

  it('reads `name;duration;tag;day;start` in the line format', () => {
    expect(parseImport('קולוסיאום;3;רומא העתיקה;2;09:30').rows).toEqual([
      placed('קולוסיאום', 180, 'רומא העתיקה', at(2, 570)),
    ]);
  });

  it('reads the fields in the brace format', () => {
    expect(
      parseImport('{Louvre;3;מרכז;1;10:00},{Seine;1,5},{Orsay; 2 ; ; 3 ; 1400 }').rows,
    ).toEqual([
      placed('Louvre', 180, 'מרכז', at(1, 600)),
      ok('Seine', 90),
      placed('Orsay', 120, null, at(3, 840)),
    ]);
  });

  it('reads the fields as 4th and 5th Excel columns, including Excel seconds', () => {
    expect(parseImport('Louvre\t3\tCentre\t1\t09:30:00\r\nOrsay\t2\t\t2\t1330\r\n').rows).toEqual([
      placed('Louvre', 180, 'Centre', at(1, 570)),
      placed('Orsay', 120, null, at(2, 810)),
    ]);
  });

  it('accepts an empty tag before the placement', () => {
    expect(parseImportRow('a;2;;2;09:30')).toEqual(placed('a', 120, null, at(2, 570)));
  });

  it('treats both fields empty as no placement', () => {
    expect(parseImportRow('a;2;tag;;')).toEqual(ok('a', 120, false, 'tag'));
    expect(parseImportRow('a;2;tag;  ;  ')).toEqual(ok('a', 120, false, 'tag'));
    expect(parseImportRow('a;2;tag;')).toEqual(ok('a', 120, false, 'tag'));
    expect(parseImport('{a;2;;;}').rows).toEqual([ok('a', 120)]);
    expect(parseImportRow('a\t2\t\t\t')).toEqual(ok('a', 120));
  });

  it.each([
    ['H:MM', '9:30', 570],
    ['HH:MM', '09:30', 570],
    ['HHMM', '0930', 570],
    ['HMM', '930', 570],
    ['whole hours', '9', 540],
    ['midnight', '00:00', 0],
    ['the last start slot', '23:30', 1410],
  ])('accepts a start in %s form (%s)', (_form, start, minute) => {
    expect(parseImportRow(`a;1;;1;${start}`)).toMatchObject({
      ok: true,
      placement: at(1, minute),
      placementIssue: null,
    });
  });

  it.each([
    ['09:10', 540],
    ['09:15', 570],
    ['0944', 570],
    ['09:45', 600],
    ['23:14', 1380],
    ['09:29:59', 570],
  ])('rounds the start %s to the half-hour grid (DEC-035)', (start, minute) => {
    expect(parseImportRow(`a;1;;1;${start}`)).toMatchObject({
      placement: at(1, minute, true),
    });
  });

  it('accepts a day written as `יום 2` and large day numbers (checked later against the trip)', () => {
    expect(parseImportRow('a;1;;יום 2;10:00')).toMatchObject({ placement: at(2, 600) });
    expect(parseImportRow('a;1;;999;10:00')).toMatchObject({ placement: at(999, 600) });
  });

  it.each([
    ['day only', 'a;1;t;2;'],
    ['start only', 'a;1;t;;09:30'],
    ['day only, 4 fields', 'a;1;t;2'],
    ['day only, tab', 'a\t1\tt\t2'],
    ['start only, brace', '{a;1;t;;0930}'],
  ])('flags one field only as placement_incomplete (%s)', (_case, line) => {
    expect(parseImport(line).rows).toEqual([
      {
        ok: true,
        name: 'a',
        durationMinutes: 60,
        rounded: false,
        tag: 't',
        placement: null,
        placementIssue: 'placement_incomplete',
      },
    ]);
  });

  it.each([
    ['day 0', '0', '09:00'],
    ['negative day', '-1', '09:00'],
    ['fractional day', '1.5', '09:00'],
    ['day as a word', 'שני', '09:00'],
    ['day too long', '1000', '09:00'],
    ['minutes ≥ 60', '1', '09:60'],
    ['seconds ≥ 60', '1', '09:00:60'],
    ['24:00', '1', '24:00'],
    ['rounds past 23:30', '1', '23:50'],
    ['hours past 24', '1', '2500'],
    ['not a time', '1', 'בבוקר'],
    ['am/pm', '1', '9am'],
    ['dot separator', '1', '9.30'],
    ['five digits', '1', '09300'],
  ])('flags %s as placement_invalid, keeping the row valid', (_case, day, start) => {
    const line = `a;1;t;${day};${start}`;
    expect(parseImportRow(line)).toMatchObject({
      ok: true,
      name: 'a',
      tag: 't',
      placement: null,
      placementIssue: 'placement_invalid',
    });
  });

  it('reports incomplete before invalid', () => {
    expect(parseImportRow('a;1;t;x;')).toMatchObject({ placementIssue: 'placement_incomplete' });
  });

  it('still rejects the row for name, duration and tag errors', () => {
    expect(parseImportRow('a;25;t;1;09:00')).toMatchObject({ reason: 'duration_out_of_range' });
    expect(parseImportRow(`a;1;${'x'.repeat(TAG_MAX + 1)};1;09:00`)).toMatchObject({
      reason: 'tag_too_long',
    });
    expect(parseImportRow(';1;t;1;09:00')).toMatchObject({ reason: 'missing_name' });
  });

  it('keeps `;` in names: the widest shape whose duration parses wins', () => {
    expect(parseImportRow('Rock; Roll;2;t;1;09:00')).toEqual(
      placed('Rock; Roll', 120, 't', at(1, 540)),
    );
    // 3-field rows with `;` in the name split as before (FEAT-2).
    expect(parseImportRow('Rock; Roll; 2; מוזיקה')).toEqual(ok('Rock; Roll', 120, false, 'מוזיקה'));
    expect(parseImportRow('Rock; Roll; 2')).toEqual(ok('Rock; Roll', 120));
  });

  it('counts rows with a placement issue as valid, within the unchanged row limit', () => {
    const lines = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => `r${i};1;;${(i % 3) + 1};x`);
    const result = parseImport(lines.join('\n'));
    expect(result).toMatchObject({
      validCount: MAX_IMPORT_ROWS,
      invalidCount: 0,
      exceedsLimit: false,
    });
    expect(parseImport(`${lines.join('\n')}\nlast;1;;1;09:00`).exceedsLimit).toBe(true);
  });
});

describe('parseImport — brace-format hardening', () => {
  it('keeps an unclosed trailing group instead of dropping it', () => {
    expect(parseImport('{Louvre;3},{Seine;1,5').rows).toEqual([ok('Louvre', 180), ok('Seine', 90)]);
  });

  it('reports stray text between groups as its own row', () => {
    expect(parseImport('{a;1}, oops, {b;2}').rows).toEqual([
      ok('a', 60),
      bad('oops', 'missing_separator'),
      ok('b', 120),
    ]);
  });

  it('ignores empty groups', () => {
    expect(parseImport('{},{a;1},{ }').rows).toEqual([ok('a', 60)]);
  });

  it('collapses a line break inside a group in the name', () => {
    expect(parseImport('{Notre\nDame;1}').rows).toEqual([ok('Notre Dame', 60)]);
  });
});

describe('parseImport — line format with braces in names', () => {
  it('stays in line mode unless the text starts with `{`', () => {
    expect(parseImport(['Show {VIP}; 2', 'Louvre; 3'].join('\n')).rows).toEqual([
      ok('Show {VIP}', 120),
      ok('Louvre', 180),
    ]);
    expect(parseImport('  {a;1},{b;2}').rows).toEqual([ok('a', 60), ok('b', 120)]);
  });
});

describe('parseImport — performance', () => {
  it('handles a ~100k run of spaces/tabs between groups in linear time', () => {
    const gap = ` ${'\t'}`.repeat(50_000);
    const started = performance.now();
    const result = parseImport(`{a;1}x${gap}y{b;2}`);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(100);
    // The stray text becomes its own row (the tabs make "x" a name and "y" a duration).
    expect(result.rows).toHaveLength(3);
    expect(result.rows[1]).toMatchObject({ ok: false, reason: 'invalid_duration' });
  });

  it('handles a ~100k run of commas and spaces in a gap in linear time', () => {
    const started = performance.now();
    parseImport(`{a;1}a${', '.repeat(50_000)}b`);
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe('parseImport — input hygiene and limits (FR-6.5)', () => {
  it('handles empty input', () => {
    expect(parseImport('')).toEqual({
      rows: [],
      validCount: 0,
      invalidCount: 0,
      exceedsLimit: false,
    });
    expect(parseImport('\n \n')).toMatchObject({ rows: [], exceedsLimit: false });
  });

  it('strips a byte-order mark', () => {
    expect(parseImport(`${String.fromCodePoint(0xfeff)}Louvre; 3`).rows).toEqual([
      ok('Louvre', 180),
    ]);
  });

  it('splits on Unicode line separators', () => {
    expect(parseImport(`a; 1${String.fromCodePoint(0x2028)}b; 2`).rows).toEqual([
      ok('a', 60),
      ok('b', 120),
    ]);
  });

  const lines = (n: number) => Array.from({ length: n }, (_, i) => `Item ${i + 1}; 1`).join('\n');

  it(`accepts exactly ${MAX_IMPORT_ROWS} rows`, () => {
    const result = parseImport(lines(MAX_IMPORT_ROWS));
    expect(result.validCount).toBe(MAX_IMPORT_ROWS);
    expect(result.exceedsLimit).toBe(false);
  });

  it(`flags ${MAX_IMPORT_ROWS + 1} rows as over the limit without dropping any`, () => {
    const result = parseImport(lines(MAX_IMPORT_ROWS + 1));
    expect(result.rows).toHaveLength(MAX_IMPORT_ROWS + 1);
    expect(result.exceedsLimit).toBe(true);
  });

  it('counts only valid rows toward the limit (a header row does not tip it over)', () => {
    const result = parseImport(`שם; זמן\n${lines(MAX_IMPORT_ROWS)}`);
    expect(result.rows).toHaveLength(MAX_IMPORT_ROWS + 1);
    expect(result).toMatchObject({
      validCount: MAX_IMPORT_ROWS,
      invalidCount: 1,
      exceedsLimit: false,
    });
  });
});

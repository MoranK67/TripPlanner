import { MAX_IMPORT_ROWS, TAG_MAX } from './constants';
import { parseImport, parseImportRow } from './importParser';
import type { ImportRow } from './types';

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

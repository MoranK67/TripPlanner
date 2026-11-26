import {
  AI_PROMPT_EXAMPLE_LINES,
  AI_PROMPT_EXAMPLES,
  buildAiPrompt,
  IMPORT_TYPES,
  type AiPromptTrip,
} from './aiPrompt';
import { ACTIVITY_NAME_MAX, MAX_IMPORT_ROWS, TAG_MAX } from './constants';
import { parseImport } from './importParser';
import { planImportPlacements } from './importPlacement';

const rome: AiPromptTrip = {
  name: 'רומא',
  window: { startDate: '2027-03-01', startMinute: 600, endDate: '2027-03-05', endMinute: 1200 },
};

describe('buildAiPrompt', () => {
  const prompt = buildAiPrompt(rome);

  it('names the destination (the trip name) and the dates', () => {
    expect(prompt).toContain('טיול לרומא');
    expect(prompt).toContain('1.3.2027–5.3.2027');
    expect(prompt).toContain('(5 ימים)');
  });

  it('describes a one-day trip with a single date', () => {
    const day = buildAiPrompt({
      name: '  חיפה ',
      window: { startDate: '2027-12-31', startMinute: 480, endDate: '2027-12-31', endMinute: 1320 },
    });
    expect(day).toContain('טיול לחיפה, בתאריך 31.12.2027 (יום אחד).');
  });

  it('asks for exactly name;duration;tag per line', () => {
    expect(prompt).toContain('בדיוק בפורמט: שם;משך;תגית');
    expect(prompt).toContain('כל אטרקציה בשורה נפרדת');
  });

  it('asks for the duration in hours, in half-hour steps', () => {
    expect(prompt).toMatch(/משך: .*שעות.*בקפיצות של חצי שעה/);
  });

  it('asks for a tag grouping the same day or the same area, within the tag limit', () => {
    expect(prompt).toMatch(/תגית: .*באותו יום או .*באותו אזור/);
    expect(prompt).toContain(`עד ${TAG_MAX} תווים`);
  });

  it('states the name limit, the row limit and asks for no other text', () => {
    expect(prompt).toContain(`עד ${ACTIVITY_NAME_MAX} תווים`);
    expect(prompt).toContain(`לכל היותר ${MAX_IMPORT_ROWS} שורות`);
    expect(prompt).toContain('בלי כותרות');
    expect(prompt).toContain('רק השורות');
  });

  it('ends with the example lines', () => {
    expect(prompt.split('\n').slice(-AI_PROMPT_EXAMPLE_LINES.length)).toEqual(
      AI_PROMPT_EXAMPLE_LINES,
    );
  });

  it('is deterministic', () => {
    expect(buildAiPrompt(rome)).toBe(prompt);
  });
});

describe('buildAiPrompt — round trip through the import parser', () => {
  it('its example lines parse as valid rows with tags', () => {
    const result = parseImport(AI_PROMPT_EXAMPLE_LINES.join('\n'));
    expect(result.invalidCount).toBe(0);
    const row = (name: string, durationMinutes: number, tag: string) => ({
      ok: true,
      name,
      durationMinutes,
      rounded: false,
      tag,
      placement: null,
      placementIssue: null,
    });
    expect(result.rows).toEqual([
      row('שם האטרקציה', 150, 'מרכז העיר'),
      row('אטרקציה קרובה', 60, 'מרכז העיר'),
      row('טיול יום מחוץ לעיר', 360, 'יום בטבע'),
      row('אטרקציה קצרה', 30, 'השוק והנמל'),
    ]);
  });

  it('an answer that follows every rule parses completely, without rounding', () => {
    // Every half-hour step 0.5..24 h, longest name and tag, the full row limit.
    const name = 'א'.repeat(ACTIVITY_NAME_MAX - 4);
    const tag = 'ת'.repeat(TAG_MAX - 4);
    const lines = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => {
      const hours = ((i % 48) + 1) / 2;
      return `${name}${String(i).padStart(3, '0')};${hours};${tag} ${i % 7}`;
    });
    const result = parseImport(lines.join('\n'));
    expect(result).toMatchObject({
      validCount: MAX_IMPORT_ROWS,
      invalidCount: 0,
      exceedsLimit: false,
    });
    result.rows.forEach((row, i) => {
      expect(row).toMatchObject({
        ok: true,
        durationMinutes: ((i % 48) + 1) * 30,
        rounded: false,
        tag: `${tag} ${i % 7}`,
      });
    });
  });

  it('a typical chat answer (with CRLF and a trailing newline) parses', () => {
    const answer =
      'הקולוסיאום;3;רומא העתיקה\r\nהפורום הרומי;2;רומא העתיקה\r\nמזרקת טרווי;0.5;מרכז\r\n';
    expect(parseImport(answer)).toMatchObject({ validCount: 3, invalidCount: 0 });
  });
});

describe('buildAiPrompt — import types (FEAT-3)', () => {
  it('lists the three types in dialog order', () => {
    expect(IMPORT_TYPES).toEqual(['basic', 'tags', 'placement']);
  });

  it('defaults to the tags variant (the FEAT-2 prompt)', () => {
    expect(buildAiPrompt(rome, 'tags')).toBe(buildAiPrompt(rome));
    expect(AI_PROMPT_EXAMPLE_LINES).toBe(AI_PROMPT_EXAMPLES.tags);
  });

  it.each(IMPORT_TYPES)('the %s variant ends with its own example lines', (type) => {
    const lines = buildAiPrompt(rome, type).split('\n');
    expect(lines.slice(-AI_PROMPT_EXAMPLES[type].length)).toEqual(AI_PROMPT_EXAMPLES[type]);
  });

  it.each(IMPORT_TYPES)('the %s variant keeps the shared rules', (type) => {
    const prompt = buildAiPrompt(rome, type);
    expect(prompt).toContain('טיול לרומא');
    expect(prompt).toContain(`עד ${ACTIVITY_NAME_MAX} תווים`);
    expect(prompt).toMatch(/משך: .*בקפיצות של חצי שעה/);
    expect(prompt).toContain(`לכל היותר ${MAX_IMPORT_ROWS} שורות`);
    expect(prompt).toContain('רק השורות');
  });

  it('basic asks for name;duration only, without tag or placement rules', () => {
    const prompt = buildAiPrompt(rome, 'basic');
    expect(prompt).toContain('בדיוק בפורמט: שם;משך\n');
    expect(prompt).not.toContain('תגית');
    expect(prompt).not.toContain('שעת התחלה');
  });

  it('tags asks for name;duration;tag without placement rules', () => {
    const prompt = buildAiPrompt(rome, 'tags');
    expect(prompt).toContain('בדיוק בפורמט: שם;משך;תגית\n');
    expect(prompt).not.toContain('שעת התחלה');
  });

  describe('placement', () => {
    const prompt = buildAiPrompt(rome, 'placement');

    it('asks for name;duration;tag;day;start', () => {
      expect(prompt).toContain('בדיוק בפורמט: שם;משך;תגית;יום;שעת התחלה');
      expect(prompt).toContain(`עד ${TAG_MAX} תווים`);
      expect(prompt).toContain('(1 עד 5)');
    });

    it('lists every trip day with its date and available hours', () => {
      expect(prompt).toContain('- יום 1: יום שני 1.3.2027, 10:00–24:00');
      expect(prompt).toContain('- יום 2: יום שלישי 2.3.2027, 00:00–24:00');
      expect(prompt).toContain('- יום 4: יום חמישי 4.3.2027, 00:00–24:00');
      expect(prompt).toContain('- יום 5: יום שישי 5.3.2027, 00:00–20:00');
      expect(prompt).not.toContain('- יום 6');
    });

    it('limits a one-day trip by both the start and the end', () => {
      const day = buildAiPrompt(
        {
          name: 'חיפה',
          window: {
            startDate: '2027-12-31',
            startMinute: 480,
            endDate: '2027-12-31',
            endMinute: 1320,
          },
        },
        'placement',
      );
      expect(day).toContain('- יום 1: יום שישי 31.12.2027, 08:00–22:00');
      expect(day).toContain('(1 עד 1)');
    });

    it('asks for no overlaps, half-hour steps, empty day/start when unsure and a sensible rhythm', () => {
      expect(prompt).toContain('בלי חפיפות');
      expect(prompt).toMatch(/שעת התחלה: בפורמט HH:MM, בקפיצות של חצי שעה/);
      expect(prompt).toMatch(/השאירו את היום ואת שעת ההתחלה ריקים/);
      expect(prompt).toMatch(/קצב יום הגיוני: .*ארוחות.*נסיעה/);
      expect(prompt).toContain('בתוך השעות הפנויות');
    });
  });
});

describe('buildAiPrompt — round trip per import type (FEAT-3)', () => {
  it('basic examples parse as rows without tag or placement', () => {
    const result = parseImport(AI_PROMPT_EXAMPLES.basic.join('\n'));
    expect(result.invalidCount).toBe(0);
    result.rows.forEach((row) => {
      expect(row).toMatchObject({ ok: true, tag: null, placement: null, placementIssue: null });
    });
  });

  it('placement examples parse with placements, and the last one goes to the bank', () => {
    const result = parseImport(AI_PROMPT_EXAMPLES.placement.join('\n'));
    expect(result.invalidCount).toBe(0);
    expect(
      result.rows.map((row) => row.ok && [row.tag, row.placement, row.placementIssue]),
    ).toEqual([
      ['מרכז העיר', { day: 1, startMinute: 600, startRounded: false }, null],
      ['מרכז העיר', { day: 1, startMinute: 810, startRounded: false }, null],
      ['יום בטבע', { day: 2, startMinute: 540, startRounded: false }, null],
      ['השוק והנמל', null, null],
    ]);
    // On the example trip they are placed without conflicts.
    expect(planImportPlacements({ id: 't', window: rome.window }, [], result.rows)).toEqual([
      { placement: { date: '2027-03-01', startMinute: 600 } },
      { placement: { date: '2027-03-01', startMinute: 810 } },
      { placement: { date: '2027-03-02', startMinute: 540 } },
      { bank: null },
    ]);
  });

  it('a placement answer that follows every rule parses completely, without rounding', () => {
    // Every half-hour start of a full day, back to back, for the full row limit.
    const lines = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => {
      const start = (i % 48) * 30;
      const hh = String(Math.floor(start / 60)).padStart(2, '0');
      const mm = String(start % 60).padStart(2, '0');
      return `אטרקציה ${i};0.5;תגית;${Math.floor(i / 48) + 2};${hh}:${mm}`;
    });
    const result = parseImport(lines.join('\n'));
    expect(result).toMatchObject({
      validCount: MAX_IMPORT_ROWS,
      invalidCount: 0,
      exceedsLimit: false,
    });
    const longTrip = { ...rome.window, endDate: '2027-03-10' };
    const plans = planImportPlacements({ id: 't', window: longTrip }, [], result.rows);
    expect(plans.every((p) => p !== null && 'placement' in p)).toBe(true);
  });
});

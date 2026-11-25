import { AI_PROMPT_EXAMPLE_LINES, buildAiPrompt, type AiPromptTrip } from './aiPrompt';
import { ACTIVITY_NAME_MAX, MAX_IMPORT_ROWS, TAG_MAX } from './constants';
import { parseImport } from './importParser';

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
    expect(result.rows).toEqual([
      { ok: true, name: 'שם האטרקציה', durationMinutes: 150, rounded: false, tag: 'מרכז העיר' },
      { ok: true, name: 'אטרקציה קרובה', durationMinutes: 60, rounded: false, tag: 'מרכז העיר' },
      {
        ok: true,
        name: 'טיול יום מחוץ לעיר',
        durationMinutes: 360,
        rounded: false,
        tag: 'יום בטבע',
      },
      { ok: true, name: 'אטרקציה קצרה', durationMinutes: 30, rounded: false, tag: 'השוק והנמל' },
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

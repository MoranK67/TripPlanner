// Ready-made message for an AI chat (FEAT-2): the user copies it from the import dialog, pastes
// it into ChatGPT or Claude, and pastes the answer back into the import box. The format it asks
// for is exactly what `parseImport` reads (round-trip tested), so every limit below comes from
// the constants the parser and the DB use. FEAT-3 adds one variant per import type.

import { ACTIVITY_NAME_MAX, MAX_IMPORT_ROWS, TAG_MAX } from './constants';
import { dayBounds, formatWeekday, minuteLabel, tripDayCount, tripDays } from './time';
import type { IsoDate, TripWindow } from './types';

/**
 * What the user chose to import (FEAT-3). It only drives the AI prompt and the format hints; the
 * parser accepts every shape whatever the type.
 * - `basic`: `name;duration`, everything goes to the bank;
 * - `tags`: `name;duration;tag` (FEAT-2);
 * - `placement`: `name;duration;tag;day;start`, placed in the timetable when possible.
 */
export type ImportType = 'basic' | 'tags' | 'placement';

/** Every import type, in the order the dialog offers them. */
export const IMPORT_TYPES: readonly ImportType[] = ['basic', 'tags', 'placement'];

/** What the prompt needs to know about the trip (a `Trip` or a `TripSummary` fits). */
export interface AiPromptTrip {
  /** The trip name, used as the destination. */
  name: string;
  window: TripWindow;
}

/**
 * Example lines shown in the prompt per import type. They must stay valid for `parseImport`
 * (tested), because the AI copies their shape. The placement examples only show the format; the
 * prompt says the days and hours must come from the trip.
 */
export const AI_PROMPT_EXAMPLES: Readonly<Record<ImportType, readonly string[]>> = {
  basic: ['שם האטרקציה;2.5', 'אטרקציה קרובה;1', 'טיול יום מחוץ לעיר;6', 'אטרקציה קצרה;0.5'],
  tags: [
    'שם האטרקציה;2.5;מרכז העיר',
    'אטרקציה קרובה;1;מרכז העיר',
    'טיול יום מחוץ לעיר;6;יום בטבע',
    'אטרקציה קצרה;0.5;השוק והנמל',
  ],
  placement: [
    'שם האטרקציה;2.5;מרכז העיר;1;10:00',
    'אטרקציה קרובה;1;מרכז העיר;1;13:30',
    'טיול יום מחוץ לעיר;6;יום בטבע;2;09:00',
    'אטרקציה בלי שעה ברורה;0.5;השוק והנמל;;',
  ],
};

/** The `tags` examples (FEAT-2 name, kept for existing callers). */
export const AI_PROMPT_EXAMPLE_LINES: readonly string[] = AI_PROMPT_EXAMPLES.tags;

/** `2027-03-01` → `1.3.2027` (day.month.year, as Israelis write dates). */
function formatDate(date: IsoDate): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d}.${m}.${y}`;
}

function describeDates(window: TripWindow): string {
  const days = tripDayCount(window);
  if (days <= 1) return `בתאריך ${formatDate(window.startDate)} (יום אחד)`;
  return `בתאריכים ${formatDate(window.startDate)}–${formatDate(window.endDate)} (${days} ימים)`;
}

/**
 * One line per trip day for the placement prompt: number, weekday, date and the enabled hours
 * (the first and last day are limited by the trip start and end), e.g.
 * `- יום 1: יום שני 1.3.2027, 10:00–24:00`.
 */
function describeDays(window: TripWindow): string[] {
  return tripDays(window).map((date, i) => {
    const bounds = dayBounds(window, date);
    const hours = bounds
      ? `${minuteLabel(bounds.startMinute)}–${minuteLabel(bounds.endMinute)}`
      : '';
    return `- יום ${i + 1}: ${formatWeekday(date)} ${formatDate(date)}, ${hours}`;
  });
}

const FORMAT_LINE: Record<ImportType, string> = {
  basic: 'שם;משך',
  tags: 'שם;משך;תגית',
  placement: 'שם;משך;תגית;יום;שעת התחלה',
};

/**
 * Hebrew message asking an AI chat for attractions of the trip's destination (the trip name) and
 * dates, in the import format of `type` (FEAT-2/3), at most MAX_IMPORT_ROWS lines and no other
 * text. Plain text, ready for the clipboard.
 * - `basic`: `name;duration`;
 * - `tags` (default, the FEAT-2 prompt): adds a short tag grouping attractions of the same day or
 *   area;
 * - `placement`: adds the trip day number and start time, lists every trip day with its date and
 *   available hours, and asks for no overlaps, half-hour steps, empty day / start when unsure and
 *   a sensible daily rhythm.
 */
export function buildAiPrompt(trip: AiPromptTrip, type: ImportType = 'tags'): string {
  const destination = trip.name.trim();
  const withTag = type !== 'basic';
  const placement = type === 'placement';
  const days = tripDayCount(trip.window);
  return [
    `אנחנו מתכננים טיול ל${destination}, ${describeDates(trip.window)}.`,
    placement
      ? 'בבקשה הכינו רשימה של אטרקציות ומקומות מומלצים ליעד הזה ושבצו אותן בלוח הזמנים של הטיול, בפורמט שאפשר להדביק כמו שהוא באפליקציה לתכנון הטיול.'
      : 'בבקשה הכינו רשימה של אטרקציות ומקומות מומלצים ליעד הזה, בפורמט שאפשר להדביק כמו שהוא באפליקציה לתכנון הטיול.',
    ...(placement ? ['', 'ימי הטיול והשעות הפנויות בכל יום:', ...describeDays(trip.window)] : []),
    '',
    'כללים:',
    `- כל אטרקציה בשורה נפרדת, בדיוק בפורמט: ${FORMAT_LINE[type]}`,
    `- שם: שם קצר וברור של האטרקציה, עד ${ACTIVITY_NAME_MAX} תווים, בלי התו ";".`,
    '- משך: כמה שעות כדאי להקדיש לה, כמספר בלבד, בקפיצות של חצי שעה (למשל 0.5, 1, 1.5, 2, 3), לכל היותר 24.',
    ...(withTag
      ? [
          `- תגית: מילה או שתיים, עד ${TAG_MAX} תווים, בלי התו ";". אטרקציות שכדאי לעשות באותו יום או שנמצאות באותו אזור מקבלות אותה תגית בדיוק (למשל "מרכז העיר" או "יום 2").`,
        ]
      : []),
    ...(placement
      ? [
          `- יום: מספר היום בטיול מהרשימה למעלה (1 עד ${days}), כמספר בלבד.`,
          '- שעת התחלה: בפורמט HH:MM, בקפיצות של חצי שעה בלבד (למשל 09:00 או 14:30).',
          '- כל אטרקציה צריכה להתחיל ולהסתיים בתוך השעות הפנויות של היום שלה, ולא לעבור את חצות.',
          '- בלי חפיפות: באותו יום, אטרקציה מתחילה רק אחרי שהקודמת הסתיימה.',
          '- שמרו על קצב יום הגיוני: זמן לארוחות ולמנוחה, וזמן נסיעה בין מקומות רחוקים.',
          '- אם אין לאטרקציה יום או שעה ברורים, השאירו את היום ואת שעת ההתחלה ריקים (השורה מסתיימת ב-";;") והיא תיכנס למאגר.',
        ]
      : []),
    `- לכל היותר ${MAX_IMPORT_ROWS} שורות.`,
    '- בלי כותרות, מספור, תבליטים, הסברים או כל טקסט אחר לפני הרשימה או אחריה — רק השורות.',
    '',
    placement ? 'דוגמה לפורמט (הימים והשעות בדוגמה רק להמחשה):' : 'דוגמה לפורמט:',
    ...AI_PROMPT_EXAMPLES[type],
  ].join('\n');
}

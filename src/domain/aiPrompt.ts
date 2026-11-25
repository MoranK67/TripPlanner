// Ready-made message for an AI chat (FEAT-2): the user copies it from the import dialog, pastes
// it into ChatGPT or Claude, and pastes the answer back into the import box. The format it asks
// for is exactly what `parseImport` reads (`name;duration;tag`, round-trip tested), so every
// limit below comes from the constants the parser and the DB use.

import { ACTIVITY_NAME_MAX, MAX_IMPORT_ROWS, TAG_MAX } from './constants';
import { tripDayCount } from './time';
import type { IsoDate, TripWindow } from './types';

/** What the prompt needs to know about the trip (a `Trip` or a `TripSummary` fits). */
export interface AiPromptTrip {
  /** The trip name, used as the destination. */
  name: string;
  window: TripWindow;
}

/**
 * Example lines shown in the prompt. They must stay valid for `parseImport` (tested), because the
 * AI copies their shape.
 */
export const AI_PROMPT_EXAMPLE_LINES: readonly string[] = [
  'שם האטרקציה;2.5;מרכז העיר',
  'אטרקציה קרובה;1;מרכז העיר',
  'טיול יום מחוץ לעיר;6;יום בטבע',
  'אטרקציה קצרה;0.5;השוק והנמל',
];

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
 * Hebrew message asking an AI chat for attractions of the trip's destination (the trip name) and
 * dates, one `name;duration;tag` per line: duration in hours in half-hour steps, a short tag that
 * groups attractions best done on the same day or in the same area, at most MAX_IMPORT_ROWS lines
 * and no other text. Plain text, ready for the clipboard.
 */
export function buildAiPrompt(trip: AiPromptTrip): string {
  const destination = trip.name.trim();
  return [
    `אנחנו מתכננים טיול ל${destination}, ${describeDates(trip.window)}.`,
    'בבקשה הכינו רשימה של אטרקציות ומקומות מומלצים ליעד הזה, בפורמט שאפשר להדביק כמו שהוא באפליקציה לתכנון הטיול.',
    '',
    'כללים:',
    '- כל אטרקציה בשורה נפרדת, בדיוק בפורמט: שם;משך;תגית',
    `- שם: שם קצר וברור של האטרקציה, עד ${ACTIVITY_NAME_MAX} תווים, בלי התו ";".`,
    '- משך: כמה שעות כדאי להקדיש לה, כמספר בלבד, בקפיצות של חצי שעה (למשל 0.5, 1, 1.5, 2, 3), לכל היותר 24.',
    `- תגית: מילה או שתיים, עד ${TAG_MAX} תווים, בלי התו ";". אטרקציות שכדאי לעשות באותו יום או שנמצאות באותו אזור מקבלות אותה תגית בדיוק (למשל "מרכז העיר" או "יום 2").`,
    `- לכל היותר ${MAX_IMPORT_ROWS} שורות.`,
    '- בלי כותרות, מספור, תבליטים, הסברים או כל טקסט אחר לפני הרשימה או אחריה — רק השורות.',
    '',
    'דוגמה לפורמט:',
    ...AI_PROMPT_EXAMPLE_LINES,
  ].join('\n');
}

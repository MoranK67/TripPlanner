// Duration text parser for the import dialog (FR-6.3). Ported from the prototype's
// `parseDuration` and hardened: more unit spellings, Hebrew geresh/maqaf variants, invisible
// bidi marks, `h:mm:ss` from Excel, and strict minute fields.

import { SLOT_MINUTES } from './constants';

// Bidi controls, zero-width characters and BOM that sneak in when copying from RTL documents.
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
const SPACES = /[\u00A0\u2007\u202F]/g;
// Hebrew geresh, typographic apostrophes and backtick → ASCII apostrophe.
const GERESH = /[\u05F3\u2018\u2019`\u00B4]/g;
// Hebrew maqaf and typographic dashes → ASCII hyphen.
const DASHES = /[\u05BE\u2010-\u2015]/g;

const NUM = String.raw`(\d+(?:\.\d+)?|\.\d+)`;
const HOUR_UNIT = String.raw`(?:שעות|שעה|ש'|ש|hours|hour|hrs|hr|h)`;
const MIN_UNIT = String.raw`(?:דקות|דקה|דק'|דק|ד'|minutes|minute|mins|min|m)`;

const CLOCK = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const MINUTES_ONLY = new RegExp(`^${NUM} ?${MIN_UNIT}$`);
const FRACTION_OF_HOUR = /^(חצי|רבע) שעה$/;
// Hours, optionally followed by "and a half / a quarter / N minutes", optionally a trailing hour
// unit ("2 וחצי שעות"). Groups: 1 number, 2 leading unit, 3 hour word, 4 fraction, 5 extra
// minutes, 6 trailing unit.
const HOURS = new RegExp(
  `^(?:${NUM} ?(${HOUR_UNIT})?|(שעה|שעתיים))` +
    `(?: ?ו(?:(חצי|רבע)|(\\d+) ?${MIN_UNIT}?))?` +
    `(?: ?(${HOUR_UNIT}))?$`,
);
// English compact forms: "1h30", "1h 30m", "1 hour 30 minutes".
const HOURS_MINUTES_EN = /^(\d+) ?(?:hours|hour|hrs|hr|h) ?(\d+) ?(?:minutes|minute|mins|min|m)?$/;

const FRACTION_MINUTES: Record<string, number> = { חצי: 30, רבע: 15 };

function normalize(raw: string): string {
  return (
    raw
      .replace(INVISIBLE, '')
      .replace(SPACES, ' ')
      .replace(GERESH, "'")
      .replace(DASHES, '-')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
      // Decimal comma: "1,5" → "1.5".
      .replace(/(\d),(\d)/g, '$1.$2')
      // The conjunction "ו" may be written "ו-", "ו -" or "ו " — glue it to the next word.
      .replace(/ ?ו ?- ?/g, ' ו')
      .replace(/ ו /g, ' ו')
  );
}

function parseHours(s: string): number | null {
  const m = HOURS.exec(s);
  if (!m) return null;
  const [, num, leadingUnit, hourWord, fraction, extraMinutes, trailingUnit] = m;
  const hours = hourWord !== undefined ? (hourWord === 'שעה' ? 1 : 2) : Number(num);
  const hasExtra = fraction !== undefined || extraMinutes !== undefined;
  // A trailing unit is only natural after a fraction ("2 וחצי שעות"), and never twice.
  if (trailingUnit !== undefined && (fraction === undefined || leadingUnit !== undefined)) {
    return null;
  }
  // "1.5 וחצי" is meaningless.
  if (hasExtra && num !== undefined && !Number.isInteger(hours)) return null;
  // A bare number with "and N minutes" needs no unit ("2 ו30"), but the minutes must be < 60.
  if (extraMinutes !== undefined && Number(extraMinutes) >= 60) return null;
  const extra =
    fraction !== undefined
      ? (FRACTION_MINUTES[fraction] ?? 0)
      : extraMinutes !== undefined
        ? Number(extraMinutes)
        : 0;
  return hours * 60 + extra;
}

/**
 * Parses a duration typed by the user into minutes, **not** rounded (see `roundToSlot`).
 * Returns `null` when the text is not a recognizable duration.
 *
 * Accepted (FR-6.3 plus hardening):
 * - hours as a number: `3`, `1.5`, `1,5`, `.5`, `2 שעות`, `2ש'`, `2h`, `1.5 hours`
 * - clock: `2:30`, `02:30`, `2:30:00` (Excel); minutes/seconds must be < 60
 * - minutes: `40 דקות`, `40 דק'`, `40 דקה`, `40min`, `40m`
 * - words: `חצי שעה`, `רבע שעה`, `שעה`, `שעתיים`, `שעה וחצי`, `שעתיים ורבע`
 * - compound: `2 שעות וחצי`, `2 וחצי`, `2 וחצי שעות`, `2 שעות ו-30 דקות`, `שעה ו-20 דקות`, `1h30`
 */
export function parseDuration(raw: string): number | null {
  const s = normalize(raw);
  if (s === '') return null;

  let m = CLOCK.exec(s);
  if (m) {
    const [, h, min, sec] = m;
    if (Number(min) >= 60 || (sec !== undefined && Number(sec) >= 60)) return null;
    return Math.round(Number(h) * 60 + Number(min) + Number(sec ?? 0) / 60);
  }

  m = MINUTES_ONLY.exec(s);
  if (m) return Math.round(Number(m[1]));

  m = FRACTION_OF_HOUR.exec(s);
  if (m) return FRACTION_MINUTES[m[1] ?? ''] ?? null;

  m = HOURS_MINUTES_EN.exec(s);
  if (m) return Number(m[2]) >= 60 ? null : Number(m[1]) * 60 + Number(m[2]);

  const hours = parseHours(s);
  return hours === null ? null : Math.round(hours);
}

/** Rounds minutes to the nearest slot (FR-6.3); halves round up (15 → 30, 45 → 60). */
export function roundToSlot(minutes: number): number {
  return Math.round(minutes / SLOT_MINUTES) * SLOT_MINUTES;
}

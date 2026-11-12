// Pasted-text import parser (FR-6.1–FR-6.5). Ported from the prototype's `parseImport` and
// hardened: Excel quoting, tab preferred over `;` for Excel rows, stray/unclosed braces,
// names validated (not silently truncated) and the 200-row limit.

import {
  ACTIVITY_NAME_MAX,
  MAX_ACTIVITY_MINUTES,
  MAX_IMPORT_ROWS,
  MIN_ACTIVITY_MINUTES,
} from './constants';
import { parseDuration, roundToSlot } from './duration';
import { nameLength } from './guards';
import type { ImportRow } from './types';

export interface ImportParseResult {
  /** One entry per non-empty line / `{…}` group, in input order. Empty lines are skipped. */
  rows: ImportRow[];
  validCount: number;
  invalidCount: number;
  /**
   * More than `MAX_IMPORT_ROWS` valid rows (FR-6.5). The whole import must then be rejected —
   * the UI shows a message and disables the import button; nothing is cut off silently.
   */
  exceedsLimit: boolean;
}

const BRACE_GROUP = /\{([^{}]*)\}/g;
const LINE_BREAK = /\r\n|[\r\n\u2028\u2029]/;
// `;` plus the Arabic semicolon some RTL keyboards produce.
const SEMICOLONS = /[;\u061B]/g;

// Characters trimmed from text between brace groups (separators and stray braces).
const LEADING_STRIP = /^[\s,{}]+/;
const STRIP_CHAR = /^[\s,{}]$/;

/**
 * Trims separators and stray braces from both ends. The end is trimmed with a backward loop
 * because an end-anchored regex like `/[\s,{}]+$/` is quadratic on long runs of these
 * characters, and the live preview re-parses on every keystroke.
 */
function stripGap(line: string): string {
  const start = line.replace(LEADING_STRIP, '');
  let end = start.length;
  while (end > 0 && STRIP_CHAR.test(start.charAt(end - 1))) end -= 1;
  return start.slice(0, end);
}

/** Splits the pasted text into raw entries (FR-6.2). */
function splitEntries(text: string): string[] {
  const clean = text.replace(/^\uFEFF/, '');
  // Brace mode only when the text starts with `{`, so line-format names such as
  // `Show {VIP}; 2` keep working.
  if (!clean.trimStart().startsWith('{')) return clean.split(LINE_BREAK);

  // `{name;duration},{name;duration}` — groups in order; any text between groups (e.g. an
  // unclosed `{name;2`) becomes its own entry instead of being dropped silently.
  const entries: string[] = [];
  let last = 0;
  const pushGap = (gap: string) => {
    for (const line of gap.split(LINE_BREAK)) entries.push(stripGap(line));
  };
  for (const match of clean.matchAll(BRACE_GROUP)) {
    pushGap(clean.slice(last, match.index));
    entries.push(match[1] ?? '');
    last = match.index + match[0].length;
  }
  pushGap(clean.slice(last));
  return entries;
}

/** Index of the name/duration separator: the last tab (Excel), else the last `;`. */
function separatorIndex(entry: string): number {
  const tab = entry.lastIndexOf('\t');
  if (tab >= 0) return tab;
  let index = -1;
  for (const m of entry.matchAll(SEMICOLONS)) index = m.index;
  return index;
}

/**
 * Removes Excel's cell quoting (`"a ""b"""` → `a "b"`). This also strips the quotes from a
 * hand-typed `"Name"`, which is intended. Inner whitespace runs (including line breaks inside a
 * `{…}` group) collapse to one space.
 */
function cleanName(name: string): string {
  let s = name.trim();
  const quoted = /^"([\s\S]*)"$/.exec(s);
  if (quoted) s = (quoted[1] ?? '').replace(/""/g, '"');
  return s.replace(/\s+/g, ' ').trim();
}

/** Parses one non-empty entry into a valid or invalid import row (FR-6.4). */
export function parseImportRow(entry: string): ImportRow {
  const raw = entry.trim();
  const sep = separatorIndex(raw);
  if (sep < 0) return { ok: false, raw, reason: 'missing_separator' };

  const name = cleanName(raw.slice(0, sep));
  const durationText = raw.slice(sep + 1).trim();
  if (name === '') return { ok: false, raw, reason: 'missing_name' };
  if (durationText === '') return { ok: false, raw, reason: 'missing_duration' };
  // Rejected rather than truncated (the prototype cut at 60) so no name changes silently.
  if (nameLength(name) > ACTIVITY_NAME_MAX) {
    return { ok: false, raw, reason: 'name_too_long' };
  }

  const minutes = parseDuration(durationText);
  if (minutes === null) return { ok: false, raw, reason: 'invalid_duration' };
  const durationMinutes = roundToSlot(minutes);
  if (durationMinutes < MIN_ACTIVITY_MINUTES || durationMinutes > MAX_ACTIVITY_MINUTES) {
    return { ok: false, raw, reason: 'duration_out_of_range' };
  }
  return { ok: true, name, durationMinutes, rounded: durationMinutes !== minutes };
}

/**
 * Parses pasted text (FR-6.2): one `name; duration` per line, `{name;duration},{name;duration}`,
 * or two tab-separated columns pasted from Excel. Empty lines are ignored; a header row such as
 * `שם; זמן` comes out as an invalid row (its duration does not parse).
 */
export function parseImport(text: string): ImportParseResult {
  const rows = splitEntries(text)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map(parseImportRow);
  const validCount = rows.filter((row) => row.ok).length;
  return {
    rows,
    validCount,
    invalidCount: rows.length - validCount,
    exceedsLimit: validCount > MAX_IMPORT_ROWS,
  };
}

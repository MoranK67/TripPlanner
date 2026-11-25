// Pasted-text import parser (FR-6.1–FR-6.5). Ported from the prototype's `parseImport` and
// hardened: Excel quoting, tab preferred over `;` for Excel rows, stray/unclosed braces,
// names validated (not silently truncated) and the 200-row limit. FEAT-2 adds an optional third
// field, the tag.

import {
  ACTIVITY_NAME_MAX,
  MAX_ACTIVITY_MINUTES,
  MAX_IMPORT_ROWS,
  MIN_ACTIVITY_MINUTES,
} from './constants';
import { parseDuration, roundToSlot } from './duration';
import { nameLength } from './guards';
import { normalizeTag, validateTag, type TagError } from './tags';
import type { ImportRow, ImportRowError } from './types';

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

/** Field separator positions: every tab (Excel) if the entry has one, else every `;`. */
function separatorPositions(entry: string): number[] {
  if (entry.includes('\t')) return [...entry.matchAll(/\t/g)].map((m) => m.index);
  return [...entry.matchAll(SEMICOLONS)].map((m) => m.index);
}

interface RowFields {
  name: string;
  durationText: string;
  /** Raw third field; `null` for a two-field row. */
  tagText: string | null;
}

/**
 * Splits an entry into name, duration and optional tag (FEAT-2). With two or more separators the
 * row is `name;duration;tag` when the field before the last separator is a duration; otherwise
 * (including two-field rows) the last separator splits name and duration, so names may contain
 * `;` as before (`Show; VIP; 2`). `null` when there is no separator at all.
 */
function splitFields(raw: string): RowFields | null {
  const seps = separatorPositions(raw);
  const last = seps.at(-1);
  if (last === undefined) return null;
  const before = seps.at(-2);
  if (before !== undefined) {
    const middle = raw.slice(before + 1, last).trim();
    if (middle !== '' && parseDuration(middle) !== null) {
      return { name: raw.slice(0, before), durationText: middle, tagText: raw.slice(last + 1) };
    }
  }
  return { name: raw.slice(0, last), durationText: raw.slice(last + 1).trim(), tagText: null };
}

const TAG_ERROR = {
  empty: null,
  not_trimmed: null,
  too_long: 'tag_too_long',
  control_char: 'tag_invalid',
} as const satisfies Record<TagError, ImportRowError | null>;

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
  const fields = splitFields(raw);
  if (fields === null) return { ok: false, raw, reason: 'missing_separator' };

  const name = cleanName(fields.name);
  const { durationText } = fields;
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

  // An empty third field (`name;2;`) means no tag. The tag is cleaned like a name (Excel quoting)
  // and then normalized; an invalid one rejects the row rather than being dropped silently.
  const tag = fields.tagText === null ? null : normalizeTag(cleanName(fields.tagText));
  const tagError = tag === null ? null : validateTag(tag);
  const tagReason = tagError === null ? null : TAG_ERROR[tagError];
  if (tagReason !== null) return { ok: false, raw, reason: tagReason };
  return { ok: true, name, durationMinutes, rounded: durationMinutes !== minutes, tag };
}

/**
 * Parses pasted text (FR-6.2): one `name; duration` per line, `{name;duration},{name;duration}`,
 * or two tab-separated columns pasted from Excel. Each format takes an optional third field, the
 * tag (FEAT-2): `name;duration;tag`, `{name;duration;tag}`, or a third Excel column. Empty lines are ignored; a header row such as
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

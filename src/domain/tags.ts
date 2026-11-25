// Activity tags (FEAT-2): one optional short label per activity, e.g. `מרכז העיר` or `יום 3`.
// Activities of the same trip with the same tag share a colour (enforced by the DB on insert and
// on a tag change; the helpers here only preview it) and the bank can be filtered by tag.
//
// Mirrors the DB rule on `activities.tag`: null, or trimmed, 1–30 characters (`char_length`, code
// points) and no control characters. Tags are compared like `lower(btrim(tag))`.

import { TAG_MAX } from './constants';
import { nameLength } from './guards';
import type { Activity, HexColor } from './types';

// Bidi controls, zero-width characters and BOM that sneak in when copying from RTL documents.
// They are not control characters to the DB, but they would make equal-looking tags differ.
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
// C0, DEL and C1 control characters (what Postgres `[[:cntrl:]]` covers in a UTF-8 database).
// eslint-disable-next-line no-control-regex -- matching control characters is the point.
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

/** Why a tag cannot be stored. The UI maps every code to a Hebrew message. */
export type TagError =
  /** Empty or only spaces (store `null` instead — `normalizeTag` does that). */
  | 'empty'
  /** Leading or trailing whitespace (`normalizeTag` removes it). */
  | 'not_trimmed'
  /** Longer than TAG_MAX characters. */
  | 'too_long'
  /** Contains a control character. */
  | 'control_char';

/**
 * Canonical form of a typed or imported tag: invisible bidi marks removed, whitespace runs
 * (including tabs and line breaks) collapsed to one space, trimmed. Empty → `null` (no tag).
 * Other control characters are kept, so `validateTag` can report them.
 */
export function normalizeTag(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const tag = raw.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  return tag === '' ? null : tag;
}

/**
 * First reason `tag` cannot be stored as is, or `null` if the DB accepts it. Expects the value
 * that will be sent (normally the output of `normalizeTag`; `null` itself needs no check).
 */
export function validateTag(tag: string): TagError | null {
  if (tag.trim() === '') return 'empty';
  if (tag !== tag.trim()) return 'not_trimmed';
  if (CONTROL.test(tag)) return 'control_char';
  if (nameLength(tag) > TAG_MAX) return 'too_long';
  return null;
}

/** True if `tag` is `null` (no tag) or a storable tag. */
export function isValidTag(tag: string | null): boolean {
  return tag === null || validateTag(tag) === null;
}

/** Comparison key: same key = same tag (case-insensitive, normalized). `null` = no tag. */
export function tagKey(tag: string | null | undefined): string | null {
  return normalizeTag(tag)?.toLowerCase() ?? null;
}

/** True if both are the same tag (case-insensitive, normalized). Two missing tags are not "same". */
export function sameTag(a: string | null | undefined, b: string | null | undefined): boolean {
  const key = tagKey(a);
  return key !== null && key === tagKey(b);
}

/**
 * Order of a tag group's members on the server: oldest first by `(created_at, bank_position, id)`.
 * Activities without `createdAt` (optimistic, not yet saved) count as newest. Timestamps are
 * compared as text: the DB returns them all in one UTC format, which sorts chronologically.
 */
function compareAge(a: Activity, b: Activity): number {
  if (a.createdAt !== b.createdAt) {
    if (a.createdAt === undefined) return 1;
    if (b.createdAt === undefined) return -1;
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  if (a.bankPosition !== b.bankPosition) return a.bankPosition - b.bankPosition;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The colour an activity gets for `tag` (FEAT-2 "same tag ⇒ same colour"), for the dialog
 * preview: the colour of the group's oldest member in `activities` (pass the trip's activities),
 * ignoring `excludeId` (the activity being edited) — the same rule as the DB trigger. `null` if no
 * other activity has the tag; the activity then keeps its own colour (or the next palette colour
 * when new). The server decides: always show the colour the save returns.
 */
export function tagColor(
  activities: readonly Activity[],
  tag: string | null | undefined,
  excludeId: string | null = null,
): HexColor | null {
  const key = tagKey(tag);
  if (key === null) return null;
  let oldest: Activity | null = null;
  for (const activity of activities) {
    if (activity.id === excludeId || tagKey(activity.tag) !== key) continue;
    if (oldest === null || compareAge(activity, oldest) < 0) oldest = activity;
  }
  return oldest?.color ?? null;
}

/** One distinct tag of a trip, for the bank filter chips and the dialog suggestions. */
export interface TripTag {
  /** Spelling of its first occurrence. */
  tag: string;
  /** Comparison key (`tagKey`); use it as the React key and the filter value. */
  key: string;
  /** Group colour (its oldest member, as `tagColor`). */
  color: HexColor;
  /** Number of activities with this tag. */
  count: number;
}

/**
 * Distinct tags of `activities` (case-insensitive), sorted by Hebrew collation of the tag.
 * Activities without a tag are not counted.
 */
export function tripTags(activities: readonly Activity[]): TripTag[] {
  const byKey = new Map<string, TripTag & { oldest: Activity }>();
  for (const activity of activities) {
    const tag = normalizeTag(activity.tag);
    if (tag === null) continue;
    const key = tag.toLowerCase();
    const entry = byKey.get(key);
    if (!entry) {
      byKey.set(key, { tag, key, color: activity.color, count: 1, oldest: activity });
    } else {
      entry.count += 1;
      if (compareAge(activity, entry.oldest) < 0) {
        entry.oldest = activity;
        entry.color = activity.color;
      }
    }
  }
  return [...byKey.values()]
    .map(({ tag, key, color, count }) => ({ tag, key, color, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag, 'he'));
}

/**
 * Bank filter: true if `activity` has the tag with comparison key `key` (from `TripTag.key` or
 * `tagKey`). `key === null` means "all" and matches every activity.
 */
export function matchesTag(activity: Activity, key: string | null): boolean {
  return key === null || tagKey(activity.tag) === key;
}

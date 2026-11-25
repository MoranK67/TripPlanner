import {
  paletteColorAt,
  tagColor,
  tagKey,
  type Activity,
  type HexColor,
  type ImportRow,
} from '@/domain';

/**
 * The colour each valid import row will get, as `import_activities` assigns it (FR-6.4, DEC-042),
 * `null` for invalid rows. Rows are inserted in order:
 * - a tag the trip already uses takes that group's colour (its oldest member);
 * - a tag an earlier row of this import introduced takes that row's colour;
 * - otherwise the next colour of the trip's cursor. Joining a group does not move the cursor.
 */
export function previewColors(
  rows: readonly ImportRow[],
  colorCursor: number,
  activities: readonly Activity[],
): (HexColor | null)[] {
  let next = 0;
  const imported = new Map<string, HexColor>();
  return rows.map((row) => {
    if (!row.ok) return null;
    const key = tagKey(row.tag);
    if (key !== null) {
      const group = tagColor(activities, row.tag) ?? imported.get(key);
      if (group) return group;
    }
    const color = paletteColorAt(colorCursor + next++);
    if (key !== null) imported.set(key, color);
    return color;
  });
}

# DES-1..3 and FEAT-3 — Design fixes and AI import with placement

Status: **approved by the owner on 2026-11-26. Waiting for her "go".**

Branches:
- DES-1..3 go on `design-fixes` (preview `design-fixes.tripplanner-ag4.pages.dev`).
- FEAT-3 goes on `ai-import-placement`.
- Each branch is merged to `main` only after the owner checks its preview.

## DES-1 — Compact tag filter (frontend-engineer)

Replace the always-visible tag chips (`src/features/bank/TagFilter.tsx`) with a single compact
control in the bank header, next to "ייבוא" / "+ הוספה".

- **The control:** a button that reads `סינון: הכול ▾`. It opens an accessible menu or listbox
  (reuse the PHONE-1 `MenuButton` pattern, or a listbox popover) with these options:
  - "הכול";
  - each trip tag with its colour dot and count (from `tripTags`).
- **Choosing an option** selects it and closes the popover.
- **While a filter is active,** the trigger shows the tag (dot, name, count), followed by a separate
  "✕" button named "ביטול הסינון".
- **Hidden** when the trip has no tags.
- **Unchanged:** the per-trip selection in `tagFilterStore` (cleared with the query cache); the
  "no activities with this tag" line.
- Works in the side panel (desktop) and in the bank sheet (phone). Keyboard and screen reader as in
  `MenuButton`. RTL.

## DES-2 — Short blocks: the name wins (frontend-engineer; ActivityBlock is shared with scheduler)

In one-row ("short") blocks the time label currently takes space from the name. This is
`ActivityBlock` / `activityBlockLayout`: the 30-minute blocks, and the 1-hour blocks at the 22 px
phone scale.

- **The name gets priority.** It may truncate only after the time label has given way.
- **The time label degrades by available width:** first the full range `14:30–15:00`, then only
  the start `14:30`, then hidden.
- **Implementation:** prefer CSS container queries on the block (`@container`), or a measured
  width, rather than JS on every render.
- **The full name and range stay available** in `title` and in the accessible name.
- **No change:** block heights, and the stacked layout of taller blocks (UX-8 clamping stays).
- Update the ActivityBlock layout and contrast tests, and the E2E locators if they read the
  visible text.

## DES-3 — Shorter bank hint (frontend-engineer)

The hint text under the bank list becomes one short line in a smaller, muted font.

| Device | Hint |
|---|---|
| Desktop | `לחיצה: עריכה · גרירה ללוח: שיבוץ` |
| Phone (sheet) | `נגיעה: שיבוץ · לחיצה ארוכה: גרירה` (matches tap-to-place and the long-press drag) |

## FEAT-3 — AI import with a type choice and automatic placement

### Import types (frontend + core)

At the top of the import dialog, an accessible radio group asks what to import. The choice is
remembered per device as a convenience.

| Type | Line format | Result |
|---|---|---|
| אטרקציות ומשך | `name;duration` | everything goes to the bank |
| + תגיות | `name;duration;tag` | bank, with tag colours (DEC-042) |
| + שיבוץ בלוח | `name;duration;tag;day;start`, e.g. `קולוסיאום;3;רומא העתיקה;2;09:30` | placed when possible, otherwise bank with a reason |

- "העתקת הודעה ל-AI" copies the prompt that matches the chosen type.
- The format hint and the placeholder follow the type.
- The parser still accepts any of the shapes whatever the type: the type only drives the prompt
  and the hints. Placement fields are ignored unless the type is "+ שיבוץ".

### Parser (core-engineer, `src/domain/importParser.ts`)

- **Optional 4th and 5th fields:**
  - `day` is the 1-based trip day number;
  - `start` is `HH:MM` or `HHMM`, rounded to the half-hour grid like DEC-035.
- **Both fields must be empty, or both valid.** If only one is given, or a value is invalid, the
  row is still valid but goes to the bank, with the reason `placement_incomplete` or
  `placement_invalid`.
- Brace, line and tab formats all accept the new fields. Rows with 2 or 3 fields are unchanged.
- The 200-row limit is unchanged.

### Placement planning (core-engineer, pure)

`planImportPlacements(trip, existingActivities, rows)` returns, for each row, either
`{ placement }` or `{ bank: reason }`.

- **Reasons:**
  - `day_out_of_trip`
  - `outside_trip_hours`
  - `overlaps_existing`, with the name of the activity it overlaps
  - `overlaps_import_row`, with the row number
  - `placement_incomplete`
  - `placement_invalid`
- **Rows are processed in input order.** An earlier imported row wins over a later one.
- Reuses `placement.ts` rules.

### Server (db-engineer)

- **No schema change.**
- Extend `import_activities(trip_id, items)` so that each item accepts optional `scheduled_date`
  and `start_minute`.
- **On the server:**
  - process items in order;
  - validate each placement with the same rules as `place_activity`;
  - an item whose placement fails is inserted **in the bank**, not raised as an error;
  - report the per-item outcome in the result, e.g. `placed: bool` and `bank_reason`.
- **The whole import stays atomic.** Grants, RLS and the tag colour rule are unchanged.
- **Backward compatible:** callers without placement fields behave exactly as before. That
  matters because the live site uses the same project.
- pgTAP tests.

### Preview and result (frontend)

- Each preview row shows where it will go: `יום 2 · 09:30–12:30`, or `למאגר` with a short Hebrew
  reason.
- After the import, a toast summarises the outcome, e.g. `נוספו 12: 9 שובצו, 3 במאגר`.
- The server's outcome is authoritative. If the timetable changed meanwhile, the server may bank
  more rows than the preview showed, and the toast reflects that.

### AI prompts (core-engineer, `src/domain/aiPrompt.ts`)

`buildAiPrompt(trip, type)` has three variants.

- **The "+ שיבוץ" variant also gives:**
  - the trip's day numbers with their dates;
  - the available hours on each day: the first and last day are limited by the trip start and
    end times.
- **It asks the AI to:**
  - avoid overlaps;
  - use half-hour steps;
  - leave day and start empty for attractions without a clear time;
  - keep a sensible daily rhythm (meals, travel time).
- Round-trip tests through the parser, as in FEAT-2.

### Done when

- All checks pass: lint, typecheck, test, format:check, build, typecheck:e2e, test:e2e, and the
  DB tests.
- Full review: the DB change and the placement path.
- E2E covers:
  - each import type;
  - mixed placed and banked rows with their reasons;
  - a conflict with an existing activity;
  - copying the prompt for each type.
- The owner checks the preview before `main` is updated.

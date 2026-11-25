# FEAT-1 / FEAT-2 — Placement from the dialog, and tags

Status: **planned, waiting for the owner's go.** Do not start until she says so.
Requested by the owner on 2026-11-25 after the phone-redesign preview. Hebrew summary: [feat-1-2-placement-and-tags.he.md](feat-1-2-placement-and-tags.he.md).

Owner answers that shape this spec:

- Placement in the dialog means **day + from/to time**; the duration follows the range.
- Tags should: give the **same colour** to activities with the same tag, be **visible and editable**
  in the activity dialog, and allow **filtering the bank** by tag.
- A ready-made **prompt for an AI chat** must be available **inside the app** (import dialog).

---

## FEAT-1 — Place an activity from its edit dialog

**Goal:** besides drag and tap-to-place, the activity dialog lets the user set where the activity sits.

### Behaviour

1. The activity dialog gets a section **"שיבוץ בלוח"** with:
   - **Day:** a select of the trip's days, e.g. "יום 2 · רביעי 11.3", plus a first option **"לא משובץ (בבנק)"**.
   - **From / To:** two `TimeInput` fields, using the same HHMM typing and half-hour rounding as UX-5 (DEC-035).
   - The fields are disabled while Day is "לא משובץ".
2. **Duration follows the range.** Changing From or To updates the duration field (To − From).
   Changing the duration while placed moves To (From stays).
   The existing duration limits apply: minimum 30 minutes, maximum as in `constants.ts`.
3. **Validation before save** uses the same rules as drag (`src/domain/placement.ts`):
   - inside trip hours;
   - no overlap with another activity;
   - To > From;
   - a half-hour grid.
   Each error is shown inline in Hebrew under the field, and Save is disabled while invalid.
4. **Saving.**
   - Name, colour, duration and placement are saved in **one atomic request**. If `update_activity`
     (`supabase/migrations/20261112140500_m1_update_activity.sql`) cannot set the placement
     together with the duration, add it there. That needs a db-engineer migration and a pgTAP test.
   - The server stays the authority: a rejection maps to the existing AppError → Hebrew messages.
   - Optimistic update, serialised per trip (DEC-031).
5. **Day "לא משובץ"** returns the activity to the bank (same path as dropping on the bank).
6. **Opening the dialog** on a placed activity pre-fills Day / From / To. On a bank item they are empty, with Day = "לא משובץ".
7. **Adding a new activity** may set a placement directly (same section).

### Ownership and order

- core-engineer: pure helpers in `src/domain`:
  - range ↔ duration;
  - validation reasons for the dialog, reusing `placement.ts`.
- db-engineer: only if the RPC needs extending (check first; report before writing).
- frontend-engineer: `src/features/bank/ActivityDialog.tsx`, i18n, tests.
- qa-engineer: E2E on desktop and phone:
  - place from the dialog;
  - move it to another day;
  - return it to the bank;
  - an overlap error.

### Done when

- Unit tests and E2E pass.
- Phone: the full-screen dialog with the sticky Save button (PHONE-1) works with the new fields.
- Code review: full review, because it touches placement.

---

## FEAT-2 — Tags (same day / same group), same colour, bank filter, AI prompt

**Goal:** an AI chat can return attractions with a tag, for example "מרכז העיר" or "יום 3". Activities with the same tag share a colour, and the bank can be filtered by tag.

### Data model (db-engineer) — data-model change, owner requested

- New column `activities.tag text null`.
  - Check constraint: it is trimmed, 1–30 characters, and has no control characters.
  - An empty string is stored as `null`.
- RLS is unchanged (the row policies already cover it). Update the explicit column grants if any.
- RPCs accept and return `tag`:
  - `import_activities` (items[].tag);
  - `import_trips` (backup, DEC-033);
  - `update_activity`;
  - the insert path.
- **Same tag ⇒ same colour**, enforced on the server so every client agrees. In `assign_activity_defaults` (or a new trigger), on insert or when the tag changes:
  - if another activity **in the same trip** has the same tag (case-insensitive, trimmed), copy its colour;
  - otherwise keep the given colour, or assign the next palette colour as today.
  - Editing the colour of one tagged activity does **not** recolour the others (keep it simple; documented).
- pgTAP tests for all of the above, including cross-trip isolation: the same tag in another trip does not affect the colour.
- Regenerate `database.types.ts`.

### Import format (core-engineer)

- The line format gets an optional third field: `name;duration;tag`.
  - Example: `מוזיאון הוותיקן;3;יום ב'`.
  - The brace format is `{name;duration;tag}`.
  - Tab-separated Excel rows likewise get a third column.
  - Rows with only two fields keep working.
- The tag is validated like the DB rule. An invalid tag marks the row invalid with a reason.
- The backup format includes `tag`. The version is bumped, and old backups without tags still import.
- Repositories and types carry `tag`.

### AI prompt (core-engineer + frontend-engineer)

- A pure builder in `src/domain` (for example `buildAiPrompt(trip)`) returns Hebrew text that asks the AI for:
  - a list of attractions for the trip's destination (the trip name) and dates;
  - exactly one item per line in the `name;duration;tag` format;
  - a duration in hours, in half-hour steps;
  - a short tag grouping attractions that are best done **on the same day** or in the same area;
  - no other text.
  - It mentions the 200-row import limit.
- The import dialog gets a button **"העתקת הודעה ל-AI"**:
  - it copies the text to the clipboard (with a fallback: select the text in a read-only box);
  - it shows a short explanation: "מדביקים ב-ChatGPT או ב-Claude, ואת התשובה מדביקים כאן".

### UI (frontend-engineer)

- **Activity dialog:** a **"תגית"** field.
  - It is free text with suggestions from the tags already in this trip (a datalist or combobox, accessible).
  - Choosing an existing tag previews its colour.
- **Bank:**
  - Tag chips above the list ("הכול", then each tag with its colour dot and count). Selecting a chip filters the list. The selection is per trip, kept in memory only.
  - On the phone sheet the chips scroll horizontally.
- **Blocks:** the tag is shown as small text under the name **only where it fits**. Bank and timetable blocks rely on colour. The tag is included in the block's accessible name / title.
- **Import preview:** a tag column.

### Order

1. db-engineer: migration, tests, types. Full review; apply to the dev project only.
2. core-engineer: parser, backup, repositories, prompt builder.
3. frontend-engineer: dialog, bank filter, import button. FEAT-1 and FEAT-2 both edit `ActivityDialog`, so the frontend parts run **one after the other**, not in parallel.
4. qa-engineer: E2E for:
   - importing with tags (colours match);
   - the filter;
   - editing a tag;
   - copying the prompt.

### Done when

- All checks pass: lint, typecheck, test, format:check, build, typecheck:e2e, test:e2e, and the DB tests.
- Full review.
- The owner checks it on the preview link before `main` is updated.

---

## Open points (decide when starting, defaults in bold)

- Several tags per activity? **No, one tag** (simple; covers "same day" grouping).
- Auto-suggest putting same-tag activities on the same day? **Not now.** The colour plus the filter make grouping visible. A warning when a group is split across days can come later (it was not selected).

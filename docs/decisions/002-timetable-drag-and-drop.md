# ADR-002: Timetable drag and drop — port the prototype pointer engine, no dnd-kit

- **Status:** Proposed (scheduler-engineer, M5.1 spike) — awaiting Orchestrator acceptance and a device check (see "Open verification")
- **Date:** 2026-11-12
- **Milestone:** M5.1 (feeds M5.2–M5.8, M7.1–M7.2)
- **Requirements:** FR-4.1–4.6, FR-5.1–5.7, NFR-1, NFR-3, NFR-7; risks R1, R6

## Context

The timetable is the product's core interaction and its highest risk (PROJECT_PLAN R1):

- One column per trip day (up to **90**), 48 half-hour rows per day — about 4,300 slots on a 90-day trip.
- **RTL**: day 1 is the right-most column; later days extend to the left.
- One scroll container holds a **sticky day header** (56 px) and a **sticky time column** (64 px, inline-start).
- Blocks move **bank → grid, grid → grid, grid → bank**. The bank is a second scroll container in another feature (`features/bank`, owned by frontend-engineer).
- Drops snap to 30-minute slots and show a green/red preview from `canPlace` (DEC-014). The view auto-scrolls near edges.
- Touch must work in the iPhone PWA and on Android. Tap-to-place (FR-5.5) and a keyboard alternative (FR-5.6) are separate, non-drag paths.
- `ActivityBlock` (DEC-018) is an outer `div` holding an inner "open" `button` and a sibling × `button`. The reviewer warned that dnd-kit's default `role="button"` + `tabIndex` on the draggable wrapper would nest interactive elements.

The prototype (`prototype/index.html`, "Drag & drop (mouse + touch)") already has a working engine. It uses delegated `pointerdown`, a 6 px start threshold, a cloned `position: fixed` ghost, `elementFromPoint` hit-testing, `Math.round` snapping of the block's top edge, a `canPlace` preview, and a fixed-speed rAF auto-scroll loop. A press without movement opens the editor. Its known weaknesses:

1. `touch-action: none` on every block. On a phone you cannot scroll the bank or the grid if your finger starts on a block.
2. `elementFromPoint` has no layout in jsdom, so the hit-testing cannot be unit-tested.
3. Auto-scroll edge zones ignore the sticky time column.
4. Every drop re-renders the whole grid through `innerHTML`.
5. No Escape to cancel, and no keyboard path.

## Options

| | Option | Packages (latest, checked 2026-11-12) |
|---|---|---|
| A | **dnd-kit classic** | `@dnd-kit/core@6.3.1`, `@dnd-kit/utilities@3.2.2`, `@dnd-kit/modifiers@9.0.0`. Last release Dec 2024. |
| B | **dnd-kit new architecture** | `@dnd-kit/react@0.5.3` → `@dnd-kit/dom`, `abstract`, `state`, `geometry`, `collision`, `@preact/signals-core`. Pre-1.0 (0.5.3 on 2026-10-31). |
| C | **Port the prototype engine** to a React hook + pure geometry module, fixing the weaknesses above | none |

Not pursued: libraries built on native HTML5 drag events (react-dnd's HTML5 backend, pragmatic-drag-and-drop). With them, touch depends on each browser's native long-press drag, and the drag image cannot be replaced by a snapped slot preview.

Option C was built as a working spike in `src/features/schedule/spike/` (dev route `/dev/dnd-spike`, see the report). Options A/B were evaluated from their published source, the issue tracker and the docs. Two findings made a hands-on install unnecessary. Both are verifiable in the source:

- **A — RTL auto-scroll is broken.** `getScrollPosition` in `@dnd-kit/core@6.3.1` (`dist/core.esm.js`) hard-codes `minScroll = { x: 0, y: 0 }`. In an RTL container `scrollLeft` runs from `−max` to `0`, so at the trip start (`scrollLeft = 0`) the container counts as "already at the left edge". Auto-scroll towards later days — the direction users need most — does not start. The same bug was only fixed in the new architecture in `@dnd-kit/dom` 0.5.3 (PR #2157, merged 2026-10-30, two weeks old). Option A would need a patch or a custom auto-scroller.
- **A/B — sticky elements inside the scroll container are a known weak spot.** Open: #1756 "autoscroll fails when items live within sticky container" and PR #1984 "treat sticky elements as scrollable ancestors". Closed: #872 and #1893 (offset bugs with sticky parents).

## Evaluation

| Criterion | A: dnd-kit core 6 | B: @dnd-kit/react 0.5 | C: ported engine (spike) |
|---|---|---|---|
| **RTL hit-testing** | Rect-based collision is direction-agnostic ✔ | ✔ | Two measured rects + arithmetic, counted from the inline-start edge; unit-tested in RTL and LTR ✔ |
| **RTL auto-scroll** | ✘ broken towards later days (see above); needs our own scroller | ✔ since 0.5.3 only (two weeks old) | `scrollBy` is physical, so the same code works in both directions; speed is proportional to edge distance; unit-tested ✔ |
| **Sticky header / time column** | Droppable rects extend under the sticky header; needs custom collision code and has open sticky issues | Same family of issues | The drop area is explicitly the client box minus the header and time column. Hovering a header never drops "under" it ✔ |
| **Snap / collision math** | Gives `delta` + activator event, not a slot. 4,300 slot droppables make collision O(n) per move and measure many rects. So in practice we would still compute the slot ourselves from the pointer, and dnd-kit would only supply sensor + overlay | Same | O(1): `hitTestSlot()` = day index from the column width, slot = `round((y − grabOffset − top) / 28)`, clamped to the day ✔ |
| **Touch (scroll vs. drag)** | Proven `delay` + `tolerance` activation (long press); iOS still needs a non-passive `touchmove` listener | Same | Same technique: 280 ms long press, 8 px tolerance, non-passive `touchmove` `preventDefault` only while dragging, context-menu and iOS callout suppressed, `touch-action: manipulation`. Blocks no longer stop scrolling. **Not yet tested on a device** |
| **Keyboard / a11y** | `KeyboardSensor` + live announcements, but arrow-key moves across 90 × 48 slots need a custom coordinate getter. `attributes` add `role="button"`/`tabIndex`; on the block wrapper they nest buttons, and on the inner button they clash with "open editor" | Similar | No keyboard drag. FR-5.6 is served by the planned **M5.6 dialog** (choose day + time, validated by `canPlace`), which is easier with a screen reader and shares the flow with tap-to-place (M7.2) |
| **ActivityBlock nesting** | Must not spread `attributes` on the outer div. Then the keyboard sensor has no activator, so A's a11y advantage is lost | Same | Event delegation on `[data-drag-id]`; no ARIA or `tabIndex` is added; the inner open button stays the only focus target ✔ |
| **Click vs. drag** | Needs the same care | Same | A press without movement → normal click → edit dialog (FR-3.5); the click after a mouse drag is swallowed; Escape cancels ✔ |
| **Rendering cost** | Context-driven: `useDraggable` users re-render on drag start/end, and the provider re-renders on each `over` change; needs memo discipline | Signals: better | **Zero React renders per pointer move**: the ghost moves via `transform` from a rAF loop; preview/bank highlight subscribe to a tiny store that changes only when the snapped slot changes; the source is dimmed by a data attribute. A component test asserts **0 grid commits during a drag** (React `Profiler`) |
| **DOM size, 90 days** | (independent of library) | | No slot cells: lines are background gradients; 90 day columns + 90 headers + 48 time labels + blocks (~180 in the stress seed) |
| **Bundle (min+gz)** | 14.2 KB (core) + utilities | 33.2 KB | ≈ 1.5 KB for the whole spike page incl. engine (measured as the production bundle delta) |
| **Maintenance** | No release in ~2 years; the author's focus is B | Pre-1.0; minor versions may break | ~375 lines (engine + geometry) we own; logic proven by the prototype the owner already uses |
| **Unit/component tests (jsdom)** | Hard (needs rect mocks plus library internals) | Same | Pure geometry is fully unit-tested; component tests fire real pointer events with mocked rects (pattern in `DndSpikePage.test.tsx`) ✔ |
| **Playwright** | `page.mouse` works with pointer sensors | Same | Same `page.mouse` path; stable hooks (`data-drag-id`, test ids); touch via a `hasTouch` project with a held touch. Equal |
| **Cross-feature contract (bank)** | `DndContext` must wrap bank + grid; `features/bank` would import dnd-kit hooks | Same | The bank only marks its blocks with `data-drag-id` and exposes its drop-zone element; the engine lives in `features/schedule` ✔ |

## Decision

**Option C — port the prototype's pointer engine into `src/features/schedule` as a typed React hook (`usePointerDrag`) plus pure geometry (`hitTestSlot`, `autoScrollStep`). Do not add dnd-kit.**

Why: the grid's hard parts are RTL auto-scroll, sticky exclusion, slot snapping and render cost. dnd-kit either gets these wrong today (A) or fixed them only weeks ago in a pre-1.0 API (B), and in both cases we would still write the slot math and the scroller ourselves. What dnd-kit adds on top (sensors, overlay, keyboard drag) is either small to write (sensors, overlay) or replaced by a better-fitting non-drag path (M5.6 dialog, M7.2 tap-to-place).

**Revisit trigger:** if device testing shows long-press drag is unreliable in the iPhone PWA or Android Chrome, and we cannot fix it within one day, re-evaluate option B (`@dnd-kit/react` ≥ 0.5.3) for the touch sensor only. Mobile still has tap-to-place (FR-5.5) as the primary path (R6).

## Consequences

- No new dependency; nothing to install. A Zustand store for drag state (DEVELOPMENT_GUIDELINES §4) is **not needed**: the engine's own store (`useSyncExternalStore`) covers it.
- We own about 375 lines of interaction code. Its pure parts are unit-tested; the DOM wiring is covered by component tests with mocked rects and by Playwright (M5.7).
- On touch screens, dragging needs a short long-press (~0.3 s); a quick swipe scrolls. This is better than the prototype, where a finger on a block could never scroll. It has to be explained in the planner hint text.
- FR-5.6 is satisfied by the M5.6 dialog, not by keyboard dragging. The draggable blocks gain no ARIA beyond `ActivityBlock`'s own buttons.
- **Small requests outside schedule ownership:**
  - `ActivityBlock` × button: add `data-no-drag` so pressing × never starts a drag (the prototype excluded `.x`). Owner: frontend-engineer.
  - A hatch token for disabled slots (`--color-slot-off` or similar) instead of the spike's `--color-line` gradient. Owner: frontend-engineer.
- Hit-testing assumes **equal-width day columns** (`minmax(150px, 1fr)` for all days). Variable-width days would need per-column offsets.

## Implementation plan

**M5.2 — grid rendering (FR-4.1–4.5).** Promote the spike layout into `features/schedule/components/`:

- `TimetableGrid` (memo) and `DayColumn` (memo).
- Slot lines as background gradients on one columns layer (no slot cells).
- Disabled-slot overlays from `dayBounds` (first/last day only).
- Sticky header with `formatWeekday`/`formatShortDate` + `schedule.dayN`, and a sticky time column.
- Scroll to the trip start on open (FR-4.4).
- Layout constants (`HEADER_PX`, `TIME_COL_PX`, `COL_MIN_PX`) in `features/schedule/layout.ts`; geometry reuses `SLOT_HEIGHT_PX`.
- No virtualisation at first; M5.8 decides if 90-day profiling requires it.

**M5.3 — drag (FR-5.1–5.4).** Move `geometry.ts` (+ tests) and `usePointerDrag.ts` to `features/schedule/drag/`. Keep from the spike:

- One rAF loop with reads then writes.
- Long-press touch; Escape cancels; click swallowing.
- Ghost portal; green/red preview (FR-5.2); bank highlight; proportional auto-scroll that excludes the sticky areas (FR-5.4).
- Invalid drop → toast by `canPlace` reason, reusing the `errors.*` kind messages (DEC-014).

Bank contract, to be frozen with frontend-engineer before M5.3 starts:

- `@/features/schedule` exports `dragSourceProps(activityId)` (`data-drag-id` + the block classes: `select-none`, `touch-manipulation`, no-callout, dimmed while dragging) and `useBankDropZone()` (a ref for the bank list).
- The planner page (schedule) renders the bank panel inside the drag root.

Delete `spike/` in the same task.

**M5.4 — persistence (FR-5.7, NFR-1).**

- `onDrop` runs `canPlace`, then a TanStack `usePlaceActivity` / `useUnplaceActivity` mutation (`activitiesRepo.place/unplace`).
- `onMutate` snapshots the cache and applies the optimistic placement; `onError` rolls back and toasts by `AppError` kind; `onSettled` invalidates.
- Tests: success, server `conflict_overlap`, network error rollback.

**Later.**

- M5.6: keyboard dialog.
- M5.7 (qa): Playwright drag, invalid drop, rollback; a mobile `hasTouch` project for long press.
- M5.8: profile 30/90 days. The spike's on-page frame stats (frames, frames > 24 ms, grid renders) are the starting point.
- M7.1/M7.2 reuse the same geometry with `dayCount = 1`.

## Open verification (before accepting)

The spike runs in jsdom tests only. Before this ADR is marked Accepted, run it on the dev route and check:

1. **Desktop Chrome/Edge/Firefox, RTL:**
   - Drop position matches the pointer in every column, including after horizontal scrolling.
   - Auto-scroll works towards both earlier and later days and up/down.
   - Hovering the sticky header or time column never previews a slot.
2. **30-day and 90-day trips:** the stats line after a drag shows few frames over 24 ms and `0` grid renders; check the DevTools Performance panel during a long auto-scroll.
3. **iPhone (Safari and installed PWA) and Android Chrome:**
   - A long press starts a drag (with a short vibration on Android).
   - A swipe that starts on a block scrolls the bank and the grid.
   - No text-selection callout or context menu appears.
   - Lifting the finger drops the block.

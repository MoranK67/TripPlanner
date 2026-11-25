# Task Board

Maintained by the Orchestrator. Task IDs and details come from PROJECT_PLAN §9.2.

**Status:** `todo` · `ready` (dependencies met) · `in progress` · `review` · `done` · `blocked`

## Milestone overview

| Milestone | Status | Notes |
|---|---|---|
| M0 Foundation | done | Commit `05e0513` |
| M1 Database & auth | done — awaiting owner demo | Owner user created on dev; profile trigger verified |
| M2 Domain core | done | Domain coverage 99% |
| M3 Design system & shell | done | Owner approved the /dev/ui demo 2026-11-12 |
| M4 Trips & bank | M4.1–M4.4 done — awaiting owner demo | M4.5 E2E (qa) next |
| M5 Timetable | in progress | M5.2 done; M5.3 in progress (DEC-029: device check moves to the real drag after M5.4) |
| M6 Import/export/backup | done | M6.1–M6.6 done; owner demo pending |
| M7 Phone & offline | done — awaiting owner demo | M7.1–M7.4, M7.3b, A11Y-1, SCHED-OFF-1 done |
| M8 web release | in progress | Web-only MVP (DEC-027): M8.3 PWA, M8.4 Cloudflare Pages, M8.5 iPhone check. Needs SEC-1 first |
| M11 Hardening & release | todo | M11.4 = web checklist (DEC-027) |
| M8.1–M8.2 Windows app, M9 Android app | deferred | DEC-027: after the web release |
| M10 iOS native | deferred | iPhone covered by PWA (M8.3–M8.5) |

## Current wave — M5.3 ‖ M6.1 ‖ M6.2 ‖ UX-1 ‖ QA-1 (parallel, disjoint paths)

| ID | Task | Owner | Depends on | Status | Notes |
|---|---|---|---|---|---|
| M5.3 | Drag bank→grid, grid→grid, grid→bank, snap, valid/invalid preview, auto-scroll; delete spike | scheduler-engineer | M5.2 | done | Reviewed APPROVE. Non-optimistic save via `usePlacementActions`; ADR-002 bank contract updated (as built) |
| M6.1 | Import dialog with live preview → `import_activities` | frontend-engineer | M2.4, M4.4 | done | Reviewed APPROVE together with M5.3 |
| M6.2 | Platform adapter: web impl + desktop/android stubs + tests | platform-engineer | M0.3 | done | share sheet on mobile, download elsewhere; `useOnlineStatus` for M7.3 |
| UX-1 | One retry layer, fail fast offline | core-engineer | — | done | DEC-030. QA: shrink `skipRetryBackoff` to ~5 × 1 s |
| M5.4 | Optimistic place/unplace + rollback, serialised per trip (DEC-031); touchmove on drag root; bank.hint explains drag | scheduler-engineer | M5.3 | done | Reviewed APPROVE |
| M5.4b | M5.4 review follow-ups (module-level queue record, refetch overlay, toast dedupe, tests) | scheduler-engineer | M5.4 | done | Reviewed APPROVE |
| DATA-1 | 15 s request timeout → AppError network/timeout; queries don't retry timeouts (DEC-032) | core-engineer | — | done | Reviewed APPROVE |
| M6.3–M6.4 | Export dialog PNG + PDF (DEC-034) | frontend-engineer | M2.5, M6.2 | done | Checked in real Chromium by the agent; owner demo pending |
| M6.5 | Prototype "גיבוי" button + domain `parseBackup`/`serializeBackup` (DEC-033) | core-engineer | — | done | Prototype change read by Orchestrator (read-only export) |
| M6.6a | RPC `import_trips(jsonb)` + DB tests (480 assertions) + types | db-engineer | M6.5 | done | Reviewed APPROVE; applied to dev, NOT prod (prod only at M11.2) |
| M6.6b | `backupRepo.importAll/exportAll` + mapping, `AppError.location` | core-engineer | M6.6a | done | |
| M6.6c | Backup UI (export all, import with preview + Hebrew warnings, duplicate warning) | frontend-engineer | M6.6b, M6.3 | done | Composed in src/app/TripsRoute (no trips↔backup cycle). E2E for backup import still to add | |
| UX-5 | HHMM typed time inputs for duration and trip times, rounded to half hours (DEC-035) | frontend-engineer | — | done | `TimeInput` primitive; displays HH:MM after blur |
| IDEA-1 | Quarter-hour steps (DB checks, grid, drag, export, import) | — | after M8 | deferred | owner: revisit after real use (DEC-035) |
| M7.1 | Phone layout: single-day timetable with day switcher/swipe, bank as bottom sheet | scheduler-engineer | M5.4 | done | Reviewed APPROVE. Limitation: on phone a placed block can't be touch-dragged to another day → M7.2 tap-to-place covers it. Follow-up: compact BankPanel inside the sheet (frontend) |
| M7.2 | Tap-to-place (tap block → valid slots highlighted → tap slot), incl. cross-day move on phone, return to bank, keyboard; placement disabled offline | scheduler-engineer | M7.1 | done | FR-5.5, DEC-036. Reviewed APPROVE; all 6 follow-ups fixed (2026-11-15). NOT committed: depends on `useCanEdit` (M7.3) and shares he.json; commit together with M7.3 + A11Y-1 once QA E2E is green |
| M7.3 | Offline read cache: persisted query cache (per user, cleared on sign-out), offline banner, editing disabled offline | frontend-engineer | M5.4 | done | DEC-037. All 7 review items fixed 2026-11-15 (generation token, onlineManager tests, bank × aria-disabled via new ActivityBlock `deleteDisabledReason`); 66 files / 1359 tests, build OK. Commit with M7.2 + A11Y-1 after QA E2E (M7.4) is green. Follow-up for scheduler: pass `deleteDisabledReason={useCanEdit().reason}` in TimetableGrid/PhonePlanner |
| M7.3b | Offline reload after token expiry: `stored_offline` read-only state, resume on reconnect | core-engineer + frontend-engineer | M7.3 | done | DEC-038. Reviewed APPROVE; should-fixes applied. Nit left: tripsRepo test for refresh refused during hasSession → auth_expired; skip anon refetches while stored_offline |
| M7.4 | E2E: tap-to-place (phone + keyboard), offline cache, bank.spec phone edit via placing bar "עריכה", a11y spec | qa-engineer | M7.2, M7.3 | done | Started 2026-11-15 |
| M8.3 | PWA: manifest, icons, iOS meta/safe areas, SW precache (no Supabase caching), update prompt | platform-engineer | M7 | done | DEC-039 |
| TEST-1 | Unit tests time out under machine load (TripHeaderControls lazy-calendar beforeAll, TripsRoute findBy, TripsPage hook) | frontend-engineer / Orchestrator (vitest config) | — | done | from M7.3 review |
| TEST-2 | TripDialog.test beforeAll (lazy calendar, 60 s) still times out under heavy load → 120 s like TripHeaderControls | frontend-engineer | — | todo | seen 2026-11-16 in a full run; passes alone |
| M8.4 | Cloudflare Pages: live at https://tripplanner-ag4.pages.dev (project `tripplanner`, Git-connected, auto-deploys `main`). Headers/CSP/cache/SPA fallback verified with curl; Supabase Site URL + redirect URLs set; owner signed in and completed a password reset on the live site | Orchestrator + owner + platform-engineer | M8.3 | done | First attempt created a Worker (new default "Create" flow); deleted and redone via the Pages link. Still points at the dev Supabase project until M11.2 |
| UX-3 | A timed-out create may have succeeded on the server: invalidate on settle for create mutations (trips, bank, import) to avoid duplicates on retry | frontend-engineer | DATA-1 | done | from DATA-1 review |
| UX-4 | `beforeunload` guard while writes are pending (`useIsMutating() > 0`), in AppLayout (desktop best effort) | frontend-engineer | M5.4 | done | from DATA-1 report |
| UX-6 | Phone trip header: selector on its own full-width row (trip name readable at 360 px) | frontend-engineer | M7.1 | done | |
| UX-7 | Bank sheet: BankPanel `variant="sheet"` (sr-only title, no inner card) | frontend-engineer | M7.1 | done | |
| UX-8 | Narrow bank sheet (360 px): a 1-hour block whose name wraps to 2 lines clips the duration text (ActivityBlock fixed height) | frontend-engineer | — | done | from UX-7 screenshots |
| UX-9 | Weak-password message always says "choose a longer password"; show the actual Supabase `weak_password` reasons (length / characters / pwned) | core-engineer + frontend-engineer | — | done | owner hit it on the live reset page (25.11) |
| PHONE-1 | Phone redesign (header): app header + trip controls collapse into one slim row with a ⋯ menu; full-screen dialogs with sticky footer on phones | frontend-engineer | — | owner preview | owner iPhone test 25.11; branch `phone-redesign`, preview before merge (DEC-041) |
| PHONE-2 | Phone redesign (planner): denser half-hour rows (~8 h visible), bank sheet auto-closes during tap-to-place with a bottom bar, preview with ▲▼ + "שבץ" before placing | scheduler-engineer | — | owner preview | same; full code review (drag geometry) |
| PUB-1 | Make the GitHub repo public (owner clicks Settings → Danger Zone → Change visibility) + enable Dependabot alerts. History audited 25.11: no secrets or personal data | Owner + Orchestrator | PHONE-1, PHONE-2 | waiting | Owner decided 25.11: after the phone fixes; **ask her again before** |
| M11.3 | Keep-alive for the free Supabase project (scheduled GitHub Action, every 3 days) + weekly backup | platform-engineer | M8.4 | waiting owner approval | dev project was paused on 2026-11-23 after a week idle |
| DOC-1 | Public-facing README (pitch, screenshots, how-it-was-built), MIT LICENSE, screenshots in docs/screenshots | Orchestrator + qa-engineer | — | done | before making the repo public |
| M6.1-nits | Import dialog nits: separators via i18n/Intl.ListFormat, drop unused `_many` plurals, focus textarea on open | frontend-engineer | M6.1 | done | batch with next UI task |
| QA-1 | E2E fake-backend fidelity + flaky tests | qa-engineer | M4.5 | done | host guard fixture, PGRST303/301, update_activity fit rule, 2 flaky network tests fixed (148/148 × 2). Note: run vitest from upper-case `C:\` cwd |

## Earlier waves — M1 ‖ M2 ‖ M3

| ID | Task | Owner | Depends on | Status | Notes |
|---|---|---|---|---|---|
| M0.6 | Install Supabase CLI, link to `trip-planner-dev` | owner + Orchestrator | — | done | CLI as devDependency (`npx.cmd supabase` in PowerShell) |
| M1.1 | Schema migration: profiles, trips, activities, checks, indexes, btree_gist, exclusion constraint, GRANTs | db-engineer | M0.6 | done | |
| M1.2 | Triggers: updated_at, handle_new_user, validate_activity_in_trip, unplace_out_of_range_activities | db-engineer | M1.1 | done | |
| M1.3 | RLS: can_access_trip + policies | db-engineer | M1.1 | done | |
| M1.4 | RPCs: place/unplace/import/update_trip_window with TP_* errors | db-engineer | M1.2 | done | Colour/bank defaults via BEFORE INSERT trigger (DEC-019) |
| M1.5 | DB tests (constraints, triggers, RPCs, RLS with 2 users) | db-engineer | M1.3, M1.4 | done | |
| M1.6 | Generate `database.types.ts`; AppError mapping skeleton | db-engineer (types) → core-engineer (errors) | M1.4 | done | Types `a1ea2f0` |
| M1.7 | Repositories: authRepo, tripsRepo, activitiesRepo + tests | core-engineer | M1.6, M2.1 | done | |
| M1.8 | Auth UI: login, sign-out, reset, route guard; disable sign-ups | frontend-engineer | M1.7, M3.2 | done | Sign-ups already disabled (DEC-007); owner creates her user |
| M2.1 | Domain types & constants | core-engineer | — | done | |
| M2.2 | Time utilities | core-engineer | M2.1 | done | |
| M2.3 | Placement rules | core-engineer | M2.1 | done | Also owns `isValidTripWindow` (FR-2.5: end after start, span ≤ 89 days) |
| M2.4 | Duration & import parser | core-engineer | M2.1 | done | Port from prototype |
| M2.5 | Export layout model | core-engineer | M2.2 | done | P1 |
| M3.1 | UI primitives (Button, Input, Select, Field, Modal, Toast) + `/dev/ui` gallery | frontend-engineer | — | done | |
| M3.2 | ConfirmDialog | frontend-engineer | M3.1 | done | |
| M3.3 | ColorSwatches, ActivityBlock | frontend-engineer | M3.1, M2.1 | done | |
| M3.4 | Layout & breakpoints | frontend-engineer | M3.1 | done | |

| M5.1 | Spike: drag engine in RTL scrollable grid (ADR-002, proposed) | scheduler-engineer | M3.3 | done | ADR stays Proposed until a real browser/phone check at /dev/dnd-spike |
| M5.2 | Timetable rendering + mount in TripPage | scheduler-engineer + frontend-engineer | M5.1, M4.2 | done | 90 days ≈ 0.1 s render (headless) |
| M4.1–M4.4 | Trips list, trip dialog, edit/delete trip, bank panel | frontend-engineer | M1.7, M3.x | done | Follow-ups: per-trip mutation keys; verify the real reset email does not flash "invalid link" |
| M4.5 | E2E: trip CRUD + bank CRUD | qa-engineer | M4.3, M4.4 | done | |

| SEC-1 | react-router-dom 7.18.5 (npm audit: 0 vulnerabilities); HydrateFallback on lazy routes | frontend-engineer | — | done | Imports stay on react-router-dom; switch to `react-router` before v8 |

| ~~QA-1~~ | (done, see current wave) E2E fake-backend fidelity + guard hardening (M4.5 review should-fixes: fail on blocked hosts as auto fixture, `update_activity` checks fit only on duration change, unknown token returns 401 PGRST303; plus nits). Also: 2 E2E tests were flaky (passed on retry) in the 14.11 run, so find and stabilise them | qa-engineer | M4.5 | todo | |
| UX-1 | Collapse stacked read retries (postgrest 3× + TanStack 2× ≈ 25 s offline before an error): keep one layer, fail fast when offline | core-engineer + frontend-engineer | — | todo | Then shrink `skipRetryBackoff` in E2E |
| A11Y-1 | Axe check in E2E (NFR-7): tests/e2e/a11y.spec.ts + support/axe.ts written, NOT committed (would turn CI red) | qa-engineer + frontend-engineer | M4.5 | done | ActivityBlock name fix reviewed APPROVE. QA: openBank on phone before the bank check | First finding: `label-content-name-mismatch` on activity-block buttons (aria-labelledby name+meta vs visible text) → fix in ActivityBlock (frontend), then run the spec, commit both. Phone trip-page step must open the bank sheet (M7.1) |
| QA-2/QA-3 | CI fixes: lazy-calendar wait; E2E for HHMM fields + phone bank sheet | frontend / qa | — | done | Lesson: run test:e2e before UI commits |
| UX-2 | Focus target after deleting a timetable block (via `onDeleteStart`); label the timetable region by the sr-only h2 (`aria-labelledby`) to avoid a double announcement | scheduler-engineer + frontend-engineer | M5.2 | done | |

## Done

| ID | Task | Commit |
|---|---|---|
| M0.1–M0.5, M0.7, M0.8 | Foundation | `05e0513` |

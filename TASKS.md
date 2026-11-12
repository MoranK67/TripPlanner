# Task Board

Maintained by the Orchestrator. Task IDs and details come from PROJECT_PLAN §9.2.

**Status:** `todo` · `ready` (dependencies met) · `in progress` · `review` · `done` · `blocked`

## Milestone overview

| Milestone | Status | Notes |
|---|---|---|
| M0 Foundation | done | Commit `05e0513` |
| M1 Database & auth | in progress | CLI linked 2026-11-12 |
| M2 Domain core | done | Domain coverage 99% |
| M3 Design system & shell | done — awaiting owner demo | /dev/ui gallery |
| M4–M11 | todo | — |
| M10 iOS native | deferred | iPhone covered by PWA (M8.3–M8.5) |

## Current wave — M1 ‖ M2 ‖ M3

| ID | Task | Owner | Depends on | Status | Notes |
|---|---|---|---|---|---|
| M0.6 | Install Supabase CLI, link to `trip-planner-dev` | owner + Orchestrator | — | done | CLI as devDependency (`npx.cmd supabase` in PowerShell) |
| M1.1 | Schema migration: profiles, trips, activities, checks, indexes, btree_gist, exclusion constraint, GRANTs | db-engineer | M0.6 | done | |
| M1.2 | Triggers: updated_at, handle_new_user, validate_activity_in_trip, unplace_out_of_range_activities | db-engineer | M1.1 | done | |
| M1.3 | RLS: can_access_trip + policies | db-engineer | M1.1 | done | |
| M1.4 | RPCs: place/unplace/import/update_trip_window with TP_* errors | db-engineer | M1.2 | done | Colour/bank defaults via BEFORE INSERT trigger (DEC-019) |
| M1.5 | DB tests (constraints, triggers, RPCs, RLS with 2 users) | db-engineer | M1.3, M1.4 | done | |
| M1.6 | Generate `database.types.ts`; AppError mapping skeleton | db-engineer (types) → core-engineer (errors) | M1.4 | ready | |
| M1.7 | Repositories: authRepo, tripsRepo, activitiesRepo + tests | core-engineer | M1.6, M2.1 | todo | |
| M1.8 | Auth UI: login, sign-out, reset, route guard; disable sign-ups | frontend-engineer | M1.7, M3.2 | todo | Owner disables sign-ups in dashboard |
| M2.1 | Domain types & constants | core-engineer | — | done | |
| M2.2 | Time utilities | core-engineer | M2.1 | done | |
| M2.3 | Placement rules | core-engineer | M2.1 | done | Also owns `isValidTripWindow` (FR-2.5: end after start, span ≤ 89 days) |
| M2.4 | Duration & import parser | core-engineer | M2.1 | done | Port from prototype |
| M2.5 | Export layout model | core-engineer | M2.2 | done | P1 |
| M3.1 | UI primitives (Button, Input, Select, Field, Modal, Toast) + `/dev/ui` gallery | frontend-engineer | — | done | |
| M3.2 | ConfirmDialog | frontend-engineer | M3.1 | done | |
| M3.3 | ColorSwatches, ActivityBlock | frontend-engineer | M3.1, M2.1 | done | |
| M3.4 | Layout & breakpoints | frontend-engineer | M3.1 | done | |

## Done

| ID | Task | Commit |
|---|---|---|
| M0.1–M0.5, M0.7, M0.8 | Foundation | `05e0513` |

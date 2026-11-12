# Task Board

Maintained by the Orchestrator. Task IDs and details come from PROJECT_PLAN §9.2.

**Status:** `todo` · `ready` (dependencies met) · `in progress` · `review` · `done` · `blocked`

## Milestone overview

| Milestone | Status | Notes |
|---|---|---|
| M0 Foundation | done (except M0.6) | Commit `05e0513` |
| M1 Database & auth | ready | Starts with the owner linking the Supabase CLI |
| M2 Domain core | ready | Parallel with M1 |
| M3 Design system & shell | ready | Parallel with M1 |
| M4–M11 | todo | — |
| M10 iOS native | deferred | iPhone covered by PWA (M8.3–M8.5) |

## Current wave — M1 ‖ M2 ‖ M3

| ID | Task | Owner | Depends on | Status | Notes |
|---|---|---|---|---|---|
| M0.6 | Install Supabase CLI, link to `trip-planner-dev` | owner + Orchestrator | — | ready | Owner types DB password locally |
| M1.1 | Schema migration: profiles, trips, activities, checks, indexes, btree_gist, exclusion constraint, GRANTs | db-engineer | M0.6 | todo | |
| M1.2 | Triggers: updated_at, handle_new_user, validate_activity_in_trip, unplace_out_of_range_activities | db-engineer | M1.1 | todo | |
| M1.3 | RLS: can_access_trip + policies | db-engineer | M1.1 | todo | |
| M1.4 | RPCs: place/unplace/import/update_trip_window with TP_* errors | db-engineer | M1.2 | todo | |
| M1.5 | DB tests (constraints, triggers, RPCs, RLS with 2 users) | db-engineer | M1.3, M1.4 | todo | |
| M1.6 | Generate `database.types.ts`; AppError mapping skeleton | db-engineer (types) → core-engineer (errors) | M1.4 | todo | |
| M1.7 | Repositories: authRepo, tripsRepo, activitiesRepo + tests | core-engineer | M1.6, M2.1 | todo | |
| M1.8 | Auth UI: login, sign-out, reset, route guard; disable sign-ups | frontend-engineer | M1.7, M3.2 | todo | Owner disables sign-ups in dashboard |
| M2.1 | Domain types & constants | core-engineer | — | ready | Constants partly exist |
| M2.2 | Time utilities | core-engineer | M2.1 | todo | |
| M2.3 | Placement rules | core-engineer | M2.1 | todo | |
| M2.4 | Duration & import parser | core-engineer | M2.1 | todo | Port from prototype |
| M2.5 | Export layout model | core-engineer | M2.2 | todo | P1 |
| M3.1 | UI primitives (Button, Input, Select, Field, Modal, Toast) + `/dev/ui` gallery | frontend-engineer | — | ready | Button/Card/Toast exist |
| M3.2 | ConfirmDialog | frontend-engineer | M3.1 | todo | |
| M3.3 | ColorSwatches, ActivityBlock | frontend-engineer | M3.1, M2.1 | todo | |
| M3.4 | Layout & breakpoints | frontend-engineer | M3.1 | todo | |

## Done

| ID | Task | Commit |
|---|---|---|
| M0.1–M0.5, M0.7, M0.8 | Foundation | `05e0513` |

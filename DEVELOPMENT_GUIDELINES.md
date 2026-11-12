# Development Guidelines

Conventions every agent follows. Architecture and requirements: [PROJECT_PLAN.md](PROJECT_PLAN.md).
Team and process: [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md).

## 1. Commands

| Command | Use |
|---|---|
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm run lint` | ESLint incl. module-boundary rules |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run test` | Vitest (unit + component) |
| `npm run format` / `format:check` | Prettier |
| `npm run build` | Type-check + production build |

All four checks (lint, typecheck, test, build) must pass before a task is reported DONE.
Run commands from the repo root `C:\dev\trip-planner`.

## 2. Architecture rules (enforced by ESLint where possible)

- **Layers** (PROJECT_PLAN §4.3): `domain` (pure) ← `data` (Supabase only here) ← feature hooks ← UI.
- `src/domain` must not import React, Supabase, or any app layer.
- Only `src/data` imports `@supabase/*`. Nothing exports the raw client.
- Features import each other only through their `index.ts` (`@/features/trips`), never internals.
- Business rules live in `src/domain` and are mirrored by DB constraints — never re-implemented inside components.
- Platform differences go through `src/platform` — features never check the platform themselves.

## 3. TypeScript & code style

- TypeScript strict (`noUncheckedIndexedAccess` on). No `any`; use `unknown` + narrowing.
- **Named exports only** (no default exports), except where a tool requires one.
- Each module folder exposes its public API through `index.ts`.
- Naming: components `PascalCase.tsx`; hooks `useThing.ts`; other files `camelCase.ts`; tests `*.test.ts(x)` next to the code.
- Import alias `@/` = `src/`.
- Prettier formats everything; don't hand-format.
- Comments explain *why*, not *what*. Reference requirement IDs (`FR-2.6`) where a rule comes from the plan.

## 4. React

- Function components and hooks only (error boundaries excepted).
- Server state: **TanStack Query** (queries/mutations live in `features/*/hooks`). Mutations that move blocks are optimistic with rollback (FR-5.7).
- Local UI state: React state; a small Zustand store only for cross-component drag/selection state (to be added by the Orchestrator when needed).
- Forms validate with the **domain guards** (`src/domain`) and the `src/data/validation.ts` reason codes, shared with the data layer (DEC-023; no zod).
- No `dangerouslySetInnerHTML`.

## 5. Text, language, RTL

- **No hard-coded UI strings.** All text goes through `t('namespace.key')` with keys in `src/i18n/he.json`.
- Key namespaces match features: `app`, `auth`, `trips`, `bank`, `schedule`, `import`, `export`, `backup`, `errors`, `common`.
- Hebrew UI; code, comments, commits and docs in English.
- Layout must be direction-agnostic: Tailwind logical utilities (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`) — never `ml-`/`mr-`/`left-`/`right-` for layout.

## 6. Styling

- Tailwind CSS with the tokens in `src/styles/tokens.css` (`bg-panel`, `text-muted`, `border-line`, `bg-accent`, …). Don't introduce new raw colors; add a token instead (UI-system owner).
- Activity colors come from `PALETTE` in `src/domain/constants.ts`, mirrored by `--color-pastel-*`.
- Reuse primitives from `@/components/ui`; don't restyle buttons/inputs ad hoc.
- Minimum width 360 px; test desktop and phone widths.

## 7. Accessibility

- Every interactive element is reachable by keyboard and has an accessible name.
- Dialogs trap focus, close on Esc, and return focus; destructive confirmations focus **Cancel** by default.
- Text contrast ≥ WCAG AA on every pastel color.
- Drag & drop always has a non-drag alternative (FR-5.5, FR-5.6).

## 8. Errors

- The data layer throws `AppError { kind, message, cause }` with kinds from PROJECT_PLAN §4.6.
- UI maps kinds to Hebrew messages (`errors.*`). Never show raw server errors to the user.
- Log with context (`[feature] message`); no secrets or personal data in logs.

## 9. Database (Supabase)

- Migrations in `supabase/migrations/` named `YYYYMMDDHHMMSS_short_description.sql`. **Never edit a migration that has been applied**; add a new one.
- Table/column names `snake_case`; times as `date` + `smallint` minutes (PROJECT_PLAN §4.5).
- Every table: RLS enabled **and** forced; policies via `can_access_trip()`; explicit `GRANT … TO authenticated` (automatic exposure is off); nothing granted to `anon`.
- Business-rule errors raised with stable codes (`TP_OVERLAP`, `TP_OUT_OF_RANGE`, `TP_LIMIT`).
- `src/data/database.types.ts` is generated (`supabase gen types`), never hand-edited.
- Every constraint, trigger, RPC and policy has a DB test.

## 10. Tests

| Layer | Required |
|---|---|
| `src/domain` | Unit tests for every exported function; edge cases from PROJECT_PLAN §9.4. Target ≥ 90 % coverage. |
| `src/data` | Repository tests with a mocked Supabase client (mapping + error normalization). |
| Components | Testing Library tests for behavior (not snapshots): rendering, interaction, a11y names. |
| Database | SQL/pgTAP tests for constraints, triggers, RPCs, RLS (two users). |
| E2E | Playwright golden paths per milestone (owned by `qa-engineer`). |

Unit tests never call the real Supabase project.

## 11. Security & secrets

- Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` may appear in client config (`.env.local`, git-ignored).
- Never request, print, store or commit the DB password or the secret / service_role key. CLI steps that need them are done by the owner locally.
- Validate inputs on both sides (domain guards + DB constraints).

## 12. Git

- Branch: `main` (single owner, small reviewed commits; CI runs on every push). See DEC-003.
- One commit per reviewed task: `M1.3: enable RLS and add can_access_trip policies`.
- Never commit `.env.local`, build output, or generated native build folders.
- Only the Orchestrator commits and pushes.

## 13. Definition of Done (per task)

1. Acceptance criteria in the task brief are met.
2. Code stays within the agent's ownership and the layer rules; lint passes.
3. Tests added at the right level; `lint`, `typecheck`, `test`, `build` all pass.
4. All new UI text in `he.json`; RTL and phone width checked for UI tasks.
5. No contract or decision changed silently — anything changed is in the report and logged in DECISIONS.md.
6. `code-reviewer` approved; Orchestrator committed; TASKS.md updated.

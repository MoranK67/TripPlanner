# Decisions Log

Technical and process decisions made **after** the plan was approved. Product decisions confirmed
by the owner are listed in PROJECT_PLAN §12.1 (D1–D16) and are not repeated here. Longer write-ups
live in [docs/decisions/](docs/decisions/).

Only the Orchestrator adds entries. Agents propose decisions in their reports.

| ID | Date | Decision | Why | Affects |
|---|---|---|---|---|
| DEC-001 | 2026-11-12 | Use **npm** instead of pnpm ([ADR-001](docs/decisions/001-npm-instead-of-pnpm.md)). | Ships with Node; one tool fewer for the owner. | package manager, CI |
| DEC-002 | 2026-11-12 | The **Orchestrator is the main Claude Code session**, defined in `CLAUDE.md`, not a subagent. | Subagents cannot start other subagents, so only the main session can delegate. | PROJECT_PLAN §10 (superseded by AGENT_WORKFLOW.md) |
| DEC-003 | 2026-11-12 | **Commit-per-task on `main`** after review, instead of a branch + PR per task. | One owner, agents in one working tree; PR overhead adds no safety that review + CI don't already give. Revisit if more humans join. | Git workflow (PROJECT_PLAN §10.3) |
| DEC-004 | 2026-11-12 | Agent team of 7 subagents: `db-engineer`, `core-engineer`, `frontend-engineer`, `scheduler-engineer`, `platform-engineer`, `qa-engineer`, `code-reviewer`. Domain + data merged into `core-engineer`; UI-system + feature agents merged into `frontend-engineer`; no separate backend, architect or AI agent. | Fewer agents = less coordination overhead; no custom backend; AI is Phase 2. | AGENT_WORKFLOW.md §2 |
| DEC-005 | 2026-11-12 | Tooling versions at M0: Vite 8, React 18.3, TypeScript 6, Tailwind 4 (CSS `@theme` tokens), ESLint 10 (flat config), Vitest 5, react-router-dom 6. | Latest stable at setup time; React kept at 18 as planned. | all frontend code |
| DEC-006 | 2026-11-12 | The prototype moved to `prototype/index.html`; the root `index.html` is the Vite entry. | Vite requires `index.html` at the root. | docs links |
| DEC-007 | 2026-11-12 | Public sign-up on the `dev` Supabase project **disabled now** (owner, in dashboard) instead of waiting for M1.8. Users are created via Authentication → Users → Add user. | No reason to leave it open while the app is private. | M1.8 (dashboard step already done) |
| DEC-008 | 2026-11-12 | **Supabase CLI as an npm devDependency** (`npx supabase …`), not a global install. | Same version for everyone, no extra installer for the owner. | package.json, M0.6, db-engineer |
| DEC-009 | 2026-11-12 | Domain contract (M2.1): `TripWithActivities = { trip, activities }`; `Minute`/`IsoDate` are plain aliases (not branded); `ImportRow.reason` is a string code mapped to Hebrew in the UI (adding a code = contract change); `isPaletteColor` is case-sensitive, use `normalizeHexColor` first. | Clean DB mapping, language-free domain. | M1.7, M2.4, M3.3, M6 |
| DEC-010 | 2026-11-12 | **Custom `Modal`** instead of native `<dialog>`; it must provide document-level Esc/Tab handling, a modal stack and focus return itself. Esc is handled in the capture phase; a future in-modal widget that needs Esc first (popover, IME) must extend `modalStack`. The M3.1 UI API (Modal props, `ToastApi.dismiss`/options, `cx`, `useFieldControlProps`, Field-owns-id) is the frozen M3 contract. | Reliable tests in jsdom, nested ConfirmDialogs, animation control. | components/ui |
| DEC-011 | 2026-11-12 | Small colour deviations from the prototype to meet WCAG AA (NFR-7): darker `danger-ink`, new `ink-soft` for secondary text and placeholders, `accent-hover` for primary hover, `accent-ink` focus border. Input-border contrast (1.26:1) is accepted until M11.1. | Accessibility requirement. | tokens.css, all UI |
| DEC-012 | 2026-11-12 | `devUi.*` strings stay in `he.json` (≈1 KB in production); the `/dev/ui` route and page are dev-only. `cx` helper instead of `clsx`; `Textarea` added to the primitives (for M6). | Keeps the "all strings via i18n" rule with no extra loading code. | i18n, components/ui |

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

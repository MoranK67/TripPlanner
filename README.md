# מתכנן הטיולים · Trip Planner

A visual trip planner: define the trip window, collect activity blocks, and drag them into a half-hour timetable.

- **Plan:** [PROJECT_PLAN.md](PROJECT_PLAN.md) (authoritative) · [PROJECT_PLAN.he.md](PROJECT_PLAN.he.md) (Hebrew)
- **Prototype (UX reference):** [prototype/index.html](prototype/index.html) — open directly in a browser
- **Decisions:** [docs/decisions/](docs/decisions/)

## Getting started

Requirements: Node.js 24+.

```bash
npm install
cp .env.example .env.local   # then fill in the Supabase URL + publishable key
npm run dev                  # http://localhost:5173
```

Never put the database password or the secret / service_role key in `.env.local` or in the repo.

## Scripts

| Command                | What it does                                    |
| ---------------------- | ----------------------------------------------- |
| `npm run dev`          | Start the dev server                            |
| `npm run build`        | Type-check and build to `dist/`                 |
| `npm run lint`         | ESLint (includes module-boundary rules)         |
| `npm run typecheck`    | TypeScript strict check                         |
| `npm run test`         | Unit & component tests (Vitest)                 |
| `npm run format`       | Format with Prettier                            |
| `npm run check`        | Everything CI runs, except the build            |

## Project structure

```text
src/
  app/             routing, providers, layout, error screens
  components/ui/   shared UI primitives
  domain/          pure business logic (no React / Supabase)
  data/            the ONLY place that talks to Supabase
  features/        auth, trips, bank, schedule, import, export, backup
  platform/        web / desktop / mobile adapters
  i18n/            translations (Hebrew)
  styles/          Tailwind + design tokens
prototype/         original single-file prototype
docs/decisions/    architecture decision records (ADRs)
```

Module boundaries are enforced by ESLint — see `eslint.config.js` and PROJECT_PLAN §4.3.

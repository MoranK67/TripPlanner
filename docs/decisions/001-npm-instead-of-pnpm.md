# ADR-001: Use npm instead of pnpm

- **Status:** Accepted
- **Date:** 2026-11-12
- **Milestone:** M0.2

## Context

PROJECT_PLAN §5.1 proposed pnpm, noting npm as acceptable. The owner is not a professional developer, and npm ships with Node.js (already installed: Node 24 / npm 11), whereas pnpm requires an extra global install and PATH setup on Windows.

## Decision

Use **npm** with a committed `package-lock.json`. CI uses `npm ci`.

## Consequences

- One tool fewer to install and explain; works out of the box locally and in CI.
- Slightly slower installs and less strict dependency isolation than pnpm — irrelevant at this project's size.
- Switching to pnpm later is a small, mechanical change (generate `pnpm-lock.yaml`, update CI and README).

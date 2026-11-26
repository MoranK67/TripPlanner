# Supabase keep-alive

The free Supabase project pauses after about 7 days without database activity (it happened on
2026-11-23). `.github/workflows/keep-alive.yml` runs every 3 days (`17 6 */3 * *`, UTC) and on demand.
It only runs from the default branch, so it starts once merged to `main`.

## What it does

One request: `GET {SUPABASE_URL}/rest/v1/trips?select=id&limit=1` with the publishable key as `apikey`.
anon has no grants on app tables (M1.1), so Postgres rejects it with `42501 permission denied`, sent
back as HTTP 401. That error is raised by Postgres, which proves the request reached the database.

| Answer | Meaning | Job |
| --- | --- | --- |
| 401 + code `42501` | database answered | green |
| 401 without code | key wrong or revoked (`Invalid API key`) | red |
| 200 | anon can read `trips`: grants changed, check migrations | red |
| 5xx / timeout | project paused or down | red |

Failures are retried once after 30 s; a red run makes GitHub email the owner. The job has
`contents: read` only, a 5-minute timeout, no third-party actions, no artifacts, and it never prints
the URL, the key or the response body.

## Owner setup

1. GitHub repository → **Settings → Secrets and variables → Actions → New repository secret**:
   - `SUPABASE_URL` — same value as `VITE_SUPABASE_URL` in Cloudflare (`https://<ref>.supabase.co`).
   - `SUPABASE_PUBLISHABLE_KEY` — same value as `VITE_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`).
     The job refuses any other key type. Never store the DB password or a secret / service_role key.
2. **Actions → keep-alive → Run workflow**, then check the run is green.

## Re-enabling

GitHub disables scheduled workflows after 60 days without repository activity (it sends an email).
Re-enable with **Actions → keep-alive → Enable workflow**, then run it once by hand. If the project
already paused, click **Restore project** in the Supabase dashboard first.

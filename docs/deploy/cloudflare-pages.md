# Deploying the web app to Cloudflare Pages (M8.4)

The web build is a static Vite SPA (`dist/`). Cloudflare Pages builds it from GitHub on every
push: `main` → production, every other branch / pull request → a preview URL. No GitHub Actions
workflow and no Cloudflare token are needed (Git integration). Hebrew step-by-step for the owner:
[cloudflare-pages.he.md](cloudflare-pages.he.md).

## What the repo already provides

| File | Purpose |
| --- | --- |
| `public/_headers` | Copied to `dist/_headers`. Caching (`no-cache` for HTML, `sw.js`, manifest, icons; 1 year `immutable` for hashed `/assets/*`) and security headers incl. the Content-Security-Policy. |
| `.node-version` | Node version for the Pages build (`24.18.0`, same major as CI). The `NODE_VERSION` env var would override it; not needed. |
| no `404.html`, no `_redirects` | Pages then treats the site as an SPA: any path that is not a file (`/trips/123`, `/reset-password`) gets `index.html` with status 200. Real files (`/assets/*`, `/sw.js`, `/manifest.webmanifest`, icons) are served as they are. Do **not** add `_redirects` with `/* /index.html 200`: on Pages, redirects win over existing files, so it would also replace `sw.js` and the manifest with HTML. |

## 1. Create the Pages project (dashboard)

Cloudflare dashboard → **Workers & Pages** → **Create application** → **Pages** →
**Connect to Git** → **GitHub** (in the GitHub window choose "Only select repositories" → this
repo → **Install & Authorize**) → select the repo → **Begin setup**.

| Setting | Value |
| --- | --- |
| Project name | e.g. `trip-planner`. It sets the URL `https://<project>.pages.dev` (if the name is taken, Pages adds a suffix; use the URL it shows everywhere below) and cannot be changed later. |
| Production branch | `main` |
| Framework preset | `None` (the `Vite`/`React (Vite)` preset fills in the same two values; either is fine) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory (advanced) | empty (repo root) |
| Environment variables | see below |

Then **Save and Deploy**. The first build takes 1–3 minutes.

### Environment variables

Add both for **Production** and for **Preview** (Settings → Variables and Secrets; during the
first setup they are under "Environment variables (advanced)"). Type: plain text — these are
public values that end up in the JavaScript bundle anyway.

| Name | Where to find the value |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase dashboard → Project Settings → Data API → Project URL, `https://<ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase dashboard → Project Settings → API Keys → **Publishable** key (`sb_publishable_…`) |

Never add the database password or the `secret` / `service_role` key. Vite reads the variables at
build time, so after changing one: Deployments → latest → **Retry deployment** (or push a commit).

Until the `prod` Supabase project exists (M11.2), Production and Preview point at the same `dev`
project. When `prod` is created, change only the **Production** values and redeploy.

### Branch and preview deployments

Settings → Build → **Branch control**:

- Production branch: `main`; automatic production deployments: **on**.
- Preview branches: **All non-production branches** (gives every pull request a preview URL
  `https://<branch>.<project>.pages.dev` plus a unique `https://<hash>.<project>.pages.dev`;
  Cloudflare comments it on the PR). Choose **None** to turn previews off.
- Preview URLs get `X-Robots-Tag: noindex` from Pages automatically.

## 2. Supabase Auth URL configuration

Supabase dashboard → **Authentication** → **URL Configuration**:

| Field | Value |
| --- | --- |
| Site URL | `https://<project>.pages.dev` (the production URL; later the custom domain, if any) |
| Redirect URLs (add) | `https://<project>.pages.dev/**` |
| | `https://*.<project>.pages.dev/**` (all preview deployments) |
| | keep `http://localhost:5173/**` for local development |

Why: the only flow that uses a redirect is **password reset** (FR-1.5). The forgot-password page
sends `redirectTo = window.location.origin + '/reset-password'`, so the email link returns to the
same site the request came from (production or a preview). If that origin is not in the list,
Supabase silently falls back to the Site URL. Sign-in is email + password (no OAuth, no sign-up,
no magic link), so no other route needs an entry.

## 3. After the first deployment — quick check

1. Open `https://<project>.pages.dev` → login page appears; sign in; open a trip.
2. Reload on `/trips/<id>` → the trip opens again (SPA fallback works).
3. Forgot password → the email link opens `/reset-password` on the same site.
4. Browser dev tools → Console: no "Content Security Policy" errors.
5. Phone: Safari → Share → Add to Home Screen (M8.5 covers the full iPhone test).

## Rollback

Workers & Pages → the project → **Deployments** → pick the last good production deployment →
**⋯** → **Rollback to this deployment**. It is instant (no rebuild). The next push to `main`
deploys again, so also revert the bad commit in git. Users of the installed PWA get the
rolled-back version through the normal "new version available — refresh" prompt.

To stop automatic deployments temporarily: Settings → Build → Branch control → turn off
automatic deployments.

## CSP notes (for developers)

The policy is in `public/_headers` (one line). `connect-src` allows `https://*.supabase.co`
because the value cannot come from the build env; it covers `dev` and `prod`. If the app starts
using Supabase Realtime, add `wss://*.supabase.co`; if Supabase Storage images are shown, add
the Supabase origin to `img-src`. A violation shows up as a console error and the blocked request
fails; check the console on a preview deployment before merging such a change.

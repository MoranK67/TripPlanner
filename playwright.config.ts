import { defineConfig, devices } from '@playwright/test';
import { FAKE_PUBLISHABLE_KEY, FAKE_SUPABASE_URL } from './tests/e2e/fake-backend/server';

// E2E suite (M4.5). The app is built and served by `vite preview` with a FAKE Supabase URL; every
// request to it is answered in-process by tests/e2e/fake-backend, so no real project or account
// is used. Values set here override .env.local (Vite never overwrites variables already in the
// environment), and an automatic fixture aborts any request to another host and fails the test.
//
// A production build (not the dev server) on purpose: the dev server re-optimizes dependencies
// the first time a lazy chunk (e.g. the calendar) loads and then reloads the page mid-test.

// `E2E_PORT` lets a second checkout (git worktree) run the suite at the same time.
const PORT = Number(process.env.E2E_PORT) || 5199;
const BASE_URL = `http://localhost:${PORT}`;
/** Build output for the E2E server; inside node_modules so it is git-ignored and never `dist`. */
const OUT_DIR = 'node_modules/.e2e-dist';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['github']]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'phone',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: `npx vite build --outDir ${OUT_DIR} --emptyOutDir --logLevel warn && npx vite preview --outDir ${OUT_DIR} --port ${PORT} --strictPort`,
    url: BASE_URL,
    // Never attach to a server started by hand: it could be using the real .env.local values.
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      VITE_SUPABASE_URL: FAKE_SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: FAKE_PUBLISHABLE_KEY,
    },
  },
});

// Shared Playwright fixtures for the E2E suite.
//
// Every test gets its own fake Supabase backend (`backend`) with one test user (`user`), a fixed
// clock (so the trip calendar always opens on the same month) and a guard that aborts any request
// leaving the machine — the suite can never reach a real Supabase project by accident.
//
// Extension point for a later "real backend smoke" project: add a project in
// playwright.config.ts that sets E2E_BACKEND=real plus E2E_EMAIL / E2E_PASSWORD for a dedicated
// dev test user, and branch in the `backend` / `signedIn` fixtures below (real: sign in through
// the UI, no seeding, no fault injection). The specs only use the helpers here.

import { test as base, expect, type Page } from '@playwright/test';
import type { FakeUser } from '../fake-backend/db';
import { AUTH_STORAGE_KEY, FAKE_SUPABASE_URL, FakeSupabase } from '../fake-backend/server';
import { TEST_PASSWORD, TEST_USER_EMAIL, TODAY } from '../../fixtures/testData';

export interface E2EFixtures {
  backend: FakeSupabase;
  user: FakeUser;
  /** Stores a valid session before the app loads, like a returning signed-in user (FR-1.2). */
  signIn: () => Promise<void>;
}

const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', new URL(FAKE_SUPABASE_URL).hostname]);

export const test = base.extend<E2EFixtures>({
  backend: async ({ context, page }, provide) => {
    // Safety net: only the dev server and the fake backend may be contacted.
    await context.route(
      (url) => !ALLOWED_HOSTS.has(url.hostname),
      (route) => route.abort('blockedbyclient'),
    );
    const backend = new FakeSupabase();
    await backend.install(context);
    // A fixed "today" (time keeps running) so default ranges and the calendar are stable.
    await page.clock.install({ time: TODAY });
    await provide(backend);
  },

  user: async ({ backend }, provide) => {
    await provide(backend.db.addUser(TEST_USER_EMAIL, TEST_PASSWORD));
  },

  signIn: async ({ page, backend, user }, provide) => {
    await provide(async () => {
      const session = backend.issueSession(user);
      // Seed only once per tab, so a later sign-out is not undone by the next navigation.
      await page.addInitScript(
        ({ key, value }) => {
          if (sessionStorage.getItem('e2e-session-seeded')) return;
          sessionStorage.setItem('e2e-session-seeded', '1');
          localStorage.setItem(key, value);
        },
        { key: AUTH_STORAGE_KEY, value: JSON.stringify(session) },
      );
    });
  },
});

export { expect };

/** The app header's controls; on phones they wrap onto their own row but stay in the header. */
export function header(page: Page) {
  return page.getByRole('banner');
}

/** Toasts live in a polite live region; the server-status chip is also `role=status`. */
export function toast(page: Page, text: string | RegExp) {
  return page.getByRole('status').filter({ hasText: text });
}

// Offline read cache (M7.3, FR-8.3): trips loaded once stay readable without a connection, the
// app says it is offline, every edit control is disabled, and going back online restores editing.
// Signing out deletes the saved cache.
//
// "Offline" here = the fake API is unreachable (requests aborted) and the browser reports
// `navigator.onLine === false`. The app shell itself still loads from the preview server, as it
// will from the PWA precache (M8.3). Playwright's `context.setOffline` would also cut the preview
// server off, so the reload could not even load the page.

import type { BrowserContext, Page, Route } from '@playwright/test';
import { FAKE_SUPABASE_URL } from './fake-backend/server';
import { expect, test } from './support/fixtures';
import { t } from './support/i18n';
import {
  activityDialog,
  bank,
  bankBlock,
  clickHeaderAction,
  closeHeaderMenu,
  headerAction,
  openBank,
} from './support/pages';
import { TRIPS } from '../fixtures/testData';

/** localStorage key of the persisted query cache (src/app/queryPersistence.ts). */
const CACHE_KEY = 'trip-planner.query-cache';
const API = `${FAKE_SUPABASE_URL}/**`;

declare global {
  interface Window {
    __e2eOnline?: boolean;
  }
}

const abortApi = (route: Route) => route.abort('internetdisconnected');

/** Cuts the API off and makes every page load with `navigator.onLine === false`. */
async function goOffline(context: BrowserContext): Promise<void> {
  await context.route(API, abortApi);
  await context.addInitScript(() => {
    window.__e2eOnline = false;
    Object.defineProperty(Navigator.prototype, 'onLine', {
      configurable: true,
      get: () => window.__e2eOnline !== false,
    });
  });
}

/** Restores the API and tells the open page the connection is back (the `online` event). */
async function goOnline(context: BrowserContext, page: Page): Promise<void> {
  await context.unroute(API, abortApi);
  await page.evaluate(() => {
    window.__e2eOnline = true;
    window.dispatchEvent(new Event('online'));
  });
}

function cached(page: Page) {
  return page.evaluate((key) => localStorage.getItem(key), CACHE_KEY);
}

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test('offline reload: the trips list and a trip render from the cache, read-only', async ({
  page,
  context,
  backend,
  user,
}) => {
  const trip = backend.db.seedTrip(user, TRIPS.rome, [
    { name: 'פנתאון', duration_minutes: 60 },
    { name: 'קולוסיאום', duration_minutes: 120, scheduled_date: '2027-03-10', start_minute: 660 },
  ]);
  backend.db.seedTrip(user, TRIPS.lisbon);

  // Online once: list and trip are loaded and saved.
  await page.goto('/trips');
  await expect(page.getByRole('link', { name: new RegExp(TRIPS.lisbon.name) })).toBeVisible();
  await page.goto(`/trips/${trip.id}`);
  await expect(page.getByRole('button', { name: 'קולוסיאום 11:00–13:00' })).toBeVisible();
  await expect.poll(() => cached(page)).toContain('פנתאון');
  await expect(page.getByText(t('app.offline'))).toHaveCount(0);

  await goOffline(context);
  const requestsBefore = backend.requests.length;
  await page.reload();

  // The trip, from the cache.
  const banner = page.getByRole('status').filter({ hasText: t('app.offline') });
  await expect(banner).toBeVisible();
  await expect(page.getByRole('button', { name: 'קולוסיאום 11:00–13:00' })).toBeVisible();
  await openBank(page);
  await expect(bankBlock(page, 'פנתאון')).toBeVisible();
  await expect(await headerAction(page, t('trips.edit'))).toBeDisabled();
  await expect(await headerAction(page, t('common.delete'))).toBeDisabled();
  await closeHeaderMenu(page);
  await expect(bank(page).getByRole('button', { name: t('bank.add') })).toBeDisabled();
  await expect(bank(page).getByRole('button', { name: t('import.openLabel') })).toBeDisabled();
  // The bank's × stays in place but is disabled: it says why and opens no confirmation.
  const remove = bank(page).getByRole('button', {
    name: t('common.activityBlock.delete', { name: 'פנתאון' }),
  });
  await expect(remove).toHaveAttribute('aria-disabled', 'true');
  await expect(remove).toHaveAttribute('title', t('common.offline.editDisabled'));
  await remove.click({ force: true }); // aria-disabled: Playwright would wait for it to be enabled
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // A tap/click on an activity still opens it (no placing offline), but it cannot be saved.
  await bankBlock(page, 'פנתאון').getByRole('button').first().click();
  const dialog = activityDialog(page, 'edit');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(t('common.offline.editDisabled'))).toBeVisible();
  await expect(dialog.getByRole('button', { name: t('common.save') })).toBeDisabled();
  await dialog.getByRole('button', { name: t('common.cancel') }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('placing-bar')).toHaveCount(0);

  // The list, from the cache.
  await page.goto('/trips');
  await expect(banner).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(TRIPS.rome.name) })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(TRIPS.lisbon.name) })).toBeVisible();
  await expect(await headerAction(page, t('trips.new'))).toBeDisabled();
  await closeHeaderMenu(page);

  // Later (the cached data is now stale, so opening the trip tries the API and fails): the
  // cached trip is still shown, not an error.
  await page.clock.fastForward(60_000);
  await page.getByRole('link', { name: new RegExp(TRIPS.rome.name) }).click();
  await expect(page.getByRole('button', { name: 'קולוסיאום 11:00–13:00' })).toBeVisible();
  await expect(banner).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('link', { name: new RegExp(TRIPS.lisbon.name) })).toBeVisible();
  // Nothing reached the API while offline.
  expect(backend.requests.slice(requestsBefore)).toEqual([]);

  // Back online: the banner goes, editing comes back and the stale list is refetched.
  backend.db.seedTrip(user, TRIPS.athens);
  await goOnline(context, page);
  await expect(page.getByText(t('app.offline'))).toHaveCount(0);
  await expect(await headerAction(page, t('trips.new'))).toBeEnabled();
  await expect(page.getByRole('link', { name: new RegExp(TRIPS.athens.name) })).toBeVisible();
});

test('offline, a trip that was never loaded shows no stale data, only the offline state', async ({
  page,
  context,
  backend,
  user,
}) => {
  const seen = backend.db.seedTrip(user, TRIPS.rome, [
    { name: 'פנתאון', duration_minutes: 60, scheduled_date: '2027-03-10', start_minute: 720 },
  ]);
  const unseen = backend.db.seedTrip(user, TRIPS.lisbon, [
    { name: 'טראם 28', duration_minutes: 60, scheduled_date: '2027-04-02', start_minute: 720 },
  ]);
  await page.goto(`/trips/${seen.id}`);
  await expect(page.getByRole('button', { name: 'פנתאון 12:00–13:00' })).toBeVisible();
  await expect.poll(() => cached(page)).toContain('פנתאון');

  await goOffline(context);
  await page.goto(`/trips/${unseen.id}`);
  await expect(page.getByRole('status').filter({ hasText: t('app.offline') })).toBeVisible();
  await expect(page.getByText('טראם 28')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'פנתאון 12:00–13:00' })).toHaveCount(0);
});

test('losing the connection while a trip is open: banner and read-only at once, back after', async ({
  page,
  context,
  backend,
  user,
}) => {
  const trip = backend.db.seedTrip(user, TRIPS.rome, [{ name: 'פנתאון', duration_minutes: 60 }]);
  await page.goto(`/trips/${trip.id}`);
  await openBank(page);
  await expect(bankBlock(page, 'פנתאון')).toBeVisible();
  await expect(bank(page).getByRole('button', { name: t('bank.add') })).toBeEnabled();

  // The browser fires `offline` (no reload).
  await context.route(API, abortApi);
  await page.evaluate(() => {
    window.__e2eOnline = false;
    Object.defineProperty(Navigator.prototype, 'onLine', {
      configurable: true,
      get: () => window.__e2eOnline !== false,
    });
    window.dispatchEvent(new Event('offline'));
  });
  await expect(page.getByRole('status').filter({ hasText: t('app.offline') })).toBeVisible();
  await expect(bank(page).getByRole('button', { name: t('bank.add') })).toBeDisabled();
  await expect(await headerAction(page, t('trips.edit'))).toBeDisabled();
  await closeHeaderMenu(page);
  await expect(bankBlock(page, 'פנתאון')).toBeVisible();

  await goOnline(context, page);
  await expect(page.getByText(t('app.offline'))).toHaveCount(0);
  await expect(bank(page).getByRole('button', { name: t('bank.add') })).toBeEnabled();
  await expect(await headerAction(page, t('trips.edit'))).toBeEnabled();
});

test('sign-out deletes the saved cache', async ({ page, backend, user }) => {
  backend.db.seedTrip(user, TRIPS.rome);
  await page.goto('/trips');
  await expect(page.getByRole('link', { name: new RegExp(TRIPS.rome.name) })).toBeVisible();
  await expect.poll(() => cached(page)).toContain(TRIPS.rome.name);

  await clickHeaderAction(page, t('auth.signOut.button'));
  await page
    .getByRole('alertdialog', { name: t('auth.signOut.title') })
    .getByRole('button', { name: t('auth.signOut.confirm') })
    .click();
  await expect(page.getByRole('heading', { name: t('auth.login.title') })).toBeVisible();
  await expect.poll(() => cached(page)).toBeNull();
});

// Network failures (PROJECT_PLAN §4.6, §9.4 "network drops"): every failure shows a Hebrew
// message, nothing is half-saved, and trying again works once the connection is back.

import type { Locator, Page } from '@playwright/test';
import { rest } from './fake-backend/server';
import { expect, test, toast } from './support/fixtures';
import { t } from './support/i18n';
import {
  activityDialog,
  bank,
  bankBlock,
  clickHeaderAction,
  openBank,
  tripDialog,
} from './support/pages';
import { TRIPS } from '../fixtures/testData';

const NETWORK = t('errors.kinds.network');

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

/**
 * Reads are retried once more than they fail (DEC-030: TanStack Query retries twice with 1 s and
 * 2 s backoff; postgrest-js retries are off; nothing is retried when the browser is offline), so
 * a dead connection takes ~3 s of wall time to surface. The fake clock skips those waits.
 *
 * Each retry needs a real round trip to the (aborting) route before its next backoff timer
 * exists, so fast-forwarding the clock in a tight loop could burn through the fake time before
 * the retries happened (the old fixed loop was flaky under load). `toPass` waits real time
 * between steps (about 5 × 1 s of fake time is enough) and stops as soon as the UI shows the
 * error.
 */
async function skipRetryBackoff(page: Page, shown: Locator) {
  await expect(async () => {
    await page.clock.runFor(1_000);
    await expect(shown).toBeVisible({ timeout: 250 });
  }).toPass({ timeout: 10_000 });
}

test('trips list: load failure shows a Hebrew error; retry works when back online', async ({
  page,
  backend,
  user,
}) => {
  backend.db.seedTrip(user, TRIPS.rome);
  backend.fail(rest('GET', 'trips'), { kind: 'network' });
  await page.goto('/trips');

  const alert = page.getByRole('alert');
  await skipRetryBackoff(page, alert);
  await expect(alert).toHaveText(t('trips.loadError', { reason: NETWORK }));

  backend.clearFaults();
  await page.getByRole('button', { name: t('common.retry') }).click();
  await expect(page.getByRole('link', { name: new RegExp(TRIPS.rome.name) })).toBeVisible();
});

test('trip page: load failure offers retry (not "not found")', async ({ page, backend, user }) => {
  const trip = backend.db.seedTrip(user, TRIPS.rome, [{ name: 'פורום רומאנום' }]);
  backend.fail(rest('GET', 'trips'), { kind: 'network' });
  await page.goto(`/trips/${trip.id}`);

  const alert = page.getByRole('alert');
  await skipRetryBackoff(page, alert);
  await expect(alert).toHaveText(NETWORK);
  await expect(page.getByRole('heading', { name: t('errors.title') })).toBeVisible();

  backend.clearFaults();
  await page.getByRole('button', { name: t('common.retry') }).click();
  await openBank(page);
  await expect(bankBlock(page, 'פורום רומאנום')).toBeVisible();
});

test('create trip offline: error in the dialog, nothing saved, retry succeeds', async ({
  page,
  backend,
}) => {
  await page.goto('/trips');
  await clickHeaderAction(page, t('trips.new'));
  const dialog = tripDialog(page);
  await dialog.getByLabel(t('trips.dialog.name')).fill('נאפולי');

  backend.fail(rest('POST', 'trips'), { kind: 'network' }, 1);
  await dialog.getByRole('button', { name: t('trips.dialog.create') }).click();
  await expect(dialog.getByRole('alert')).toHaveText(NETWORK);
  expect(backend.db.trips).toHaveLength(0);

  await dialog.getByRole('button', { name: t('trips.dialog.create') }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/trips/${backend.db.trips[0]!.id}$`));
});

test('edit trip window offline keeps the dialog open with the error', async ({
  page,
  backend,
  user,
}) => {
  const trip = backend.db.seedTrip(user, TRIPS.rome);
  await page.goto(`/trips/${trip.id}`);
  await clickHeaderAction(page, t('trips.edit'));
  const dialog = tripDialog(page, 'edit');
  await dialog.getByLabel(t('trips.dialog.name')).fill('רומא מקוצרת');

  backend.fail(rest('POST', 'rpc/update_trip_window'), { kind: 'network' }, 1);
  await dialog.getByRole('button', { name: t('common.save') }).click();
  await expect(dialog.getByRole('alert')).toHaveText(NETWORK);
  expect(backend.db.trips[0]!.name).toBe(TRIPS.rome.name);

  await dialog.getByRole('button', { name: t('common.save') }).click();
  await expect(dialog).toBeHidden();
  expect(backend.db.trips[0]!.name).toBe('רומא מקוצרת');
});

test('delete trip offline: error toast, the trip stays', async ({ page, backend, user }) => {
  const trip = backend.db.seedTrip(user, TRIPS.rome);
  await page.goto(`/trips/${trip.id}`);
  backend.fail(rest('DELETE', 'trips'), { kind: 'network' }, 1);
  await clickHeaderAction(page, t('common.delete'));
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: t('common.confirmDelete') })
    .click();
  await expect(toast(page, NETWORK)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}$`));
  expect(backend.db.trips).toHaveLength(1);
});

test('add activity offline: error in the dialog, retry succeeds', async ({
  page,
  backend,
  user,
}) => {
  const trip = backend.db.seedTrip(user, TRIPS.rome);
  await page.goto(`/trips/${trip.id}`);
  await openBank(page);
  await bank(page)
    .getByRole('button', { name: t('bank.add') })
    .click();
  const dialog = activityDialog(page);
  await dialog.getByLabel(t('bank.dialog.name')).fill('מזרקת טרווי');

  backend.fail(rest('POST', 'activities'), { kind: 'network' }, 1);
  await dialog.getByRole('button', { name: t('bank.dialog.add') }).click();
  await expect(dialog.getByRole('alert')).toHaveText(NETWORK);
  expect(backend.db.activities).toHaveLength(0);

  await dialog.getByRole('button', { name: t('bank.dialog.add') }).click();
  await expect(dialog).toBeHidden();
  await expect(bankBlock(page, 'מזרקת טרווי')).toBeVisible();
  expect(backend.db.activities).toHaveLength(1);
});

test('delete activity offline: the block comes back and an error toast is shown', async ({
  page,
  backend,
  user,
}) => {
  const trip = backend.db.seedTrip(user, TRIPS.rome, [{ name: 'ספרדי' }, { name: 'בורגזה' }]);
  await page.goto(`/trips/${trip.id}`);
  await openBank(page);
  backend.fail(rest('DELETE', 'activities'), { kind: 'network' }, 1);
  await bank(page)
    .getByRole('button', { name: t('common.activityBlock.delete', { name: 'ספרדי' }) })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: t('common.confirmDelete') })
    .click();
  await expect(toast(page, t('bank.deleteFailed', { reason: NETWORK }))).toBeVisible();
  await expect(bankBlock(page, 'ספרדי')).toBeVisible();
  await expect(bank(page).getByRole('listitem').first()).toContainText('ספרדי');
  expect(backend.db.activities).toHaveLength(2);
});

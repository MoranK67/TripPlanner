// Network failures (PROJECT_PLAN §4.6, §9.4 "network drops"): every failure shows a Hebrew
// message, nothing is half-saved, and trying again works once the connection is back.

import type { Page } from '@playwright/test';
import { rest } from './fake-backend/server';
import { expect, header, test, toast } from './support/fixtures';
import { t } from './support/i18n';
import { activityDialog, bank, bankBlock, tripDialog } from './support/pages';
import { TRIPS } from '../fixtures/testData';

const NETWORK = t('errors.kinds.network');

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

/**
 * Reads are retried (postgrest-js: 3× with 1/2/4 s backoff; TanStack Query: 2× more), so a dead
 * connection takes ~25 s of wall time to surface. The fake clock skips those waits.
 */
async function skipRetryBackoff(page: Page, until: () => Promise<boolean>) {
  for (let i = 0; i < 40 && !(await until()); i += 1) {
    await page.clock.runFor(2_000);
  }
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
  await skipRetryBackoff(page, () => alert.isVisible());
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
  await skipRetryBackoff(page, () => alert.isVisible());
  await expect(alert).toHaveText(NETWORK);
  await expect(page.getByRole('heading', { name: t('errors.title') })).toBeVisible();

  backend.clearFaults();
  await page.getByRole('button', { name: t('common.retry') }).click();
  await expect(bankBlock(page, 'פורום רומאנום')).toBeVisible();
});

test('create trip offline: error in the dialog, nothing saved, retry succeeds', async ({
  page,
  backend,
}) => {
  await page.goto('/trips');
  await header(page)
    .getByRole('button', { name: t('trips.new') })
    .click();
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
  await header(page)
    .getByRole('button', { name: t('trips.edit') })
    .click();
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
  await header(page)
    .getByRole('button', { name: t('common.delete') })
    .click();
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

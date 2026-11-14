// Small page helpers shared by the specs (dialogs, calendar, bank).

import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { t } from './i18n';

export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel(t('auth.login.email')).fill(email);
  await page.getByLabel(t('auth.login.password')).fill(password);
  await page.getByRole('button', { name: t('auth.login.submit'), exact: true }).click();
}

/** The open trip dialog ("טיול חדש" / "עריכת טיול"). */
export function tripDialog(page: Page, mode: 'new' | 'edit' = 'new'): Locator {
  return page.getByRole('dialog', {
    name: t(mode === 'new' ? 'trips.dialog.newTitle' : 'trips.dialog.editTitle'),
  });
}

/** Clicks a day of the visible month in the range calendar (outside days are skipped). */
export async function pickDay(dialog: Locator, isoDate: string): Promise<void> {
  await dialog.locator(`td[data-day="${isoDate}"]:not([data-outside]) button`).click();
}

export async function nextMonth(dialog: Locator, times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await dialog.getByRole('button', { name: 'עבור לחודש הבא' }).click();
  }
}

/** Times are option labels, e.g. '09:00', '24:00'. */
export async function setTripTimes(dialog: Locator, start?: string, end?: string): Promise<void> {
  if (start) await dialog.getByLabel(t('trips.dialog.startTime')).selectOption({ label: start });
  if (end) await dialog.getByLabel(t('trips.dialog.endTime')).selectOption({ label: end });
}

/** The bank side panel (an `aside` landmark named "מאגר אטרקציות"). */
export function bank(page: Page): Locator {
  return page.getByRole('complementary', { name: t('bank.title') });
}

/** The open button of a bank block (its accessible name is "<name> <duration>"). */
export function bankBlock(page: Page, name: string): Locator {
  return bank(page)
    .getByRole('listitem')
    .filter({ has: page.getByTitle(name, { exact: true }) });
}

export function activityDialog(page: Page, mode: 'new' | 'edit' = 'new'): Locator {
  return page.getByRole('dialog', {
    name: t(mode === 'new' ? 'bank.dialog.newTitle' : 'bank.dialog.editTitle'),
  });
}

/** Adds an activity through the bank's dialog and waits until its block is shown. */
export async function addActivity(
  page: Page,
  name: string,
  options: { duration?: string; color?: string } = {},
): Promise<void> {
  await bank(page)
    .getByRole('button', { name: t('bank.add') })
    .click();
  const dialog = activityDialog(page);
  await dialog.getByLabel(t('bank.dialog.name')).fill(name);
  if (options.duration) {
    await dialog.getByLabel(t('bank.dialog.duration')).selectOption({ label: options.duration });
  }
  if (options.color) await pickColor(dialog, options.color);
  await dialog.getByRole('button', { name: t('bank.dialog.add') }).click();
  await expect(dialog).toBeHidden();
  await expect(bankBlock(page, name)).toBeVisible();
}

/**
 * Chooses a swatch. The radio itself is visually hidden (sr-only) under its painted circle, so
 * click its <label>, as a user would.
 */
export async function pickColor(dialog: Locator, colorName: string): Promise<void> {
  const radio = dialog.getByRole('radio', { name: colorName });
  await radio.locator('xpath=..').click();
  await expect(radio).toBeChecked();
}

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

/**
 * Types into a typed time field (UX-5, `TimeInput`) the way a user does: the digits (e.g.
 * '0130'), then leaves the field. On blur the field rewrites itself as 'HH:MM' (rounded to the
 * half hour), which is asserted as `shown`.
 */
export async function typeTime(field: Locator, typed: string, shown: string): Promise<void> {
  await field.fill(typed);
  await field.blur();
  await expect(field).toHaveValue(shown);
}

/** Times as shown, e.g. '09:00', '24:00'; they are typed as HHMM ('0900', '2400'). */
export async function setTripTimes(dialog: Locator, start?: string, end?: string): Promise<void> {
  if (start) {
    await typeTime(dialog.getByLabel(t('trips.dialog.startTime')), start.replace(':', ''), start);
  }
  if (end) await typeTime(dialog.getByLabel(t('trips.dialog.endTime')), end.replace(':', ''), end);
}

/**
 * The bank (an `aside` landmark named "מאגר אטרקציות"): the side panel on desktop, the bottom
 * sheet on phones (see `openBank`).
 */
export function bank(page: Page): Locator {
  return page.getByRole('complementary', { name: t('bank.title') });
}

/** Same breakpoint as the app's phone layout (< 601 px, DEC-018 / M7.1). */
export function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? Infinity) < 601;
}

/**
 * Makes the bank's activities reachable. Desktop: the side panel is always shown (no-op).
 * Phone (M7.1): the bank is a bottom sheet that starts collapsed; tap its handle
 * ("מאגר אטרקציות (N)", aria-expanded) to open it. Safe to call when it is already open.
 */
export async function openBank(page: Page): Promise<void> {
  const sheet = bank(page);
  await expect(sheet).toBeVisible();
  if (!isPhone(page)) return;
  const handle = sheet.locator(':scope > button[aria-expanded]');
  if ((await handle.getAttribute('aria-expanded')) !== 'true') await handle.click();
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
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

/**
 * Adds an activity through the bank's dialog and waits until its block is shown.
 * `duration` is typed as HHMM, e.g. '0130' (shown as '01:30' after leaving the field).
 */
export async function addActivity(
  page: Page,
  name: string,
  options: { duration?: string; color?: string } = {},
): Promise<void> {
  await openBank(page);
  await bank(page)
    .getByRole('button', { name: t('bank.add') })
    .click();
  const dialog = activityDialog(page);
  await dialog.getByLabel(t('bank.dialog.name')).fill(name);
  if (options.duration) {
    const d = options.duration;
    await typeTime(
      dialog.getByLabel(t('bank.dialog.duration')),
      d,
      `${d.slice(0, 2)}:${d.slice(2)}`,
    );
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

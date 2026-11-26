// Design fixes (docs/specs/design-fixes-and-ai-placement.md): DES-2 short blocks keep the name,
// DES-3 the one-line bank hint, DES-4 the app name. The tag filter (DES-1) is covered in
// placementAndTags.spec.ts. Desktop and phone.

import type { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { t } from './support/i18n';
import { bank, isPhone, openBank } from './support/pages';
import { TRIPS } from '../fixtures/testData';

const DAY1 = '2027-03-10';

const LONG_NAME = 'סיור מודרך ארוך במיוחד ברחובות העיר העתיקה של רומא';

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

/** How a one-row block lays out: which items sit on the visible line, and whether the name fits. */
interface RowLayout {
  nameTruncated: boolean;
  startShown: boolean;
  endShown: boolean;
}

/** Reads the one-row layout of a placed block (by its accessible name prefix). */
async function rowLayout(block: Locator): Promise<RowLayout> {
  return block.evaluate((button) => {
    const row = button.querySelector('[data-block-row]');
    if (!(row instanceof HTMLElement)) throw new Error('not a one-row block');
    const nameEl = row.firstElementChild as HTMLElement;
    const rowBox = row.getBoundingClientRect();
    // An item is shown when it sits on the row's single visible line (wrapped items are clipped).
    const shown = (selector: string) => {
      const el = row.querySelector(selector);
      if (!el) return false;
      const box = el.getBoundingClientRect();
      return box.top < rowBox.bottom - 1 && box.bottom > rowBox.top + 1;
    };
    return {
      nameTruncated: nameEl.scrollWidth > nameEl.clientWidth + 1,
      startShown: shown('[data-time="start"]'),
      endShown: shown('[data-time="end"]'),
    };
  });
}

function placedBlock(page: Page, name: string): Locator {
  return page
    .getByRole('main')
    .getByRole('button', { name: new RegExp(`^${name} \\d`) })
    .first();
}

test.describe('DES-2: in short blocks the name wins', () => {
  test('30-minute blocks: the time gives way (range, then start, then hidden) before the name', async ({
    page,
    backend,
    user,
  }) => {
    const trip = backend.db.seedTrip(user, TRIPS.rome, [
      { name: 'קפה', duration_minutes: 30, scheduled_date: DAY1, start_minute: 600 },
      { name: LONG_NAME, duration_minutes: 30, scheduled_date: DAY1, start_minute: 660 },
      // At the phone's 22 px scale a one-hour block is a one-row block too.
      { name: 'פנתאון', duration_minutes: 60, scheduled_date: DAY1, start_minute: 720 },
    ]);
    await page.goto(`/trips/${trip.id}`);

    const short = placedBlock(page, 'קפה');
    await expect(short).toHaveAccessibleName('קפה 10:00–10:30');
    // A short name leaves room for the whole range.
    expect(await rowLayout(short)).toEqual({
      nameTruncated: false,
      startShown: true,
      endShown: true,
    });

    // A name wider than the block: the time has given way completely, then the name truncates.
    const long = placedBlock(page, LONG_NAME);
    await expect(long).toHaveAccessibleName(`${LONG_NAME} 11:00–11:30`);
    expect(await rowLayout(long)).toEqual({
      nameTruncated: true,
      startShown: false,
      endShown: false,
    });
    // The full name and range stay in the tooltip.
    await expect(page.getByTitle(`${LONG_NAME} · 11:00–11:30`)).toHaveCount(1);

    const hour = placedBlock(page, 'פנתאון');
    if (isPhone(page)) {
      expect(await rowLayout(hour)).toEqual({
        nameTruncated: false,
        startShown: true,
        endShown: true,
      });
    } else {
      // Desktop (28 px): a one-hour block keeps the stacked layout.
      await expect(hour.locator('[data-block-row]')).toHaveCount(0);
    }
  });

  test('a medium name keeps the start time, drops the end, and is never truncated', async ({
    page,
    backend,
    user,
  }) => {
    const trip = backend.db.seedTrip(user, TRIPS.rome, [
      { name: 'שוק', duration_minutes: 30, scheduled_date: DAY1, start_minute: 600 },
    ]);
    await page.goto(`/trips/${trip.id}`);
    const block = placedBlock(page, 'שוק');
    await expect(block).toBeVisible();
    // Narrow the block until only the start time still fits after the name.
    const layout = await block.evaluate((button) => {
      const row = button.querySelector('[data-block-row]') as HTMLElement;
      const nameEl = row.firstElementChild as HTMLElement | null;
      const start = row.querySelector<HTMLElement>('[data-time="start"]');
      const end = row.querySelector<HTMLElement>('[data-time="end"]');
      if (!nameEl || !start || !end) throw new Error('missing items');
      const host = button.parentElement as HTMLElement;
      const chrome = host.getBoundingClientRect().width - row.getBoundingClientRect().width;
      const startMargin = parseFloat(getComputedStyle(start).marginInlineStart);
      host.style.width = `${chrome + nameEl.scrollWidth + startMargin + start.scrollWidth + 2}px`;
      const rowBox = row.getBoundingClientRect();
      const onLine = (el: Element) => el.getBoundingClientRect().top < rowBox.bottom - 1;
      return {
        nameTruncated: nameEl.scrollWidth > nameEl.clientWidth + 1,
        start: onLine(start),
        end: onLine(end),
      };
    });
    expect(layout).toEqual({ nameTruncated: false, start: true, end: false });
  });
});

test('DES-3: the bank hint is one short line for the device', async ({ page, backend, user }) => {
  const trip = backend.db.seedTrip(user, TRIPS.rome, [{ name: 'קפה' }]);
  await page.goto(`/trips/${trip.id}`);
  await openBank(page);
  // Phone: the bank sheet's own hint names the touch gestures (tap to place, long press to drag).
  const hint = bank(page).getByText(
    isPhone(page) ? t('schedule.sheet.hintPlace') : t('bank.hint'),
    { exact: true },
  );
  await expect(hint).toHaveText(
    isPhone(page) ? 'נגיעה: שיבוץ · לחיצה ארוכה: גרירה' : 'לחיצה: עריכה · גרירה ללוח: שיבוץ',
  );
  await expect(hint).toBeVisible();
  // One line (content height = one line box) in a smaller font than the 13 px body text.
  const metrics = await hint.evaluate((el) => {
    const style = getComputedStyle(el);
    const content =
      el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    return { lines: content / parseFloat(style.lineHeight), fontSize: parseFloat(style.fontSize) };
  });
  expect(metrics.lines).toBeLessThan(1.5);
  expect(metrics.fontSize).toBeLessThan(13);
});

test('DES-4: the app is called TripPlanner (header, tab, installed app)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('banner').getByRole('heading', { level: 1 })).toHaveText(
    'TripPlanner',
  );
  await expect(page).toHaveTitle('TripPlanner');
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    'content',
    'TripPlanner',
  );
  // Still a Hebrew, right-to-left app.
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = (await (await page.request.get(href ?? '')).json()) as {
    name: string;
    short_name: string;
  };
  expect(manifest).toMatchObject({ name: 'TripPlanner', short_name: 'TripPlanner' });
});

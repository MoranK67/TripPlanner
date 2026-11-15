// Tap-to-place and keyboard placement (M7.2 / M7.4): FR-5.5, FR-5.6, NFR-7 ("every action without
// drag"). Phone: tap an activity to pick it up, tap a highlighted start slot to place it, switch
// day in between, return it to the bank or cancel from the placing bar. Desktop: M on a focused
// block, arrow keys, Enter.

import type { Locator, Page } from '@playwright/test';
import { rest } from './fake-backend/server';
import { expect, test } from './support/fixtures';
import { t } from './support/i18n';
import { bank, bankBlock, openBank } from './support/pages';
import { TRIPS } from '../fixtures/testData';

/** "יום רביעי 10.3 · יום 1": the day label used by the day switcher and the slot buttons. */
function dayLabel(isoDate: string, n: number): string {
  const weekday = new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('he-IL', {
    weekday: 'long',
    timeZone: 'UTC',
  });
  const [, m, d] = isoDate.split('-').map(Number);
  return t('schedule.day.option', { weekday, date: `${d}.${m}`, n });
}

const DAY1 = { date: '2027-03-10', label: dayLabel('2027-03-10', 1) };
const DAY2 = { date: '2027-03-11', label: dayLabel('2027-03-11', 2) };

/** The bar under the timetable while an activity waits for a slot. */
function placingBar(page: Page): Locator {
  return page.getByTestId('placing-bar');
}

/** A slot button of the placing layer, e.g. "12:00–13:00, יום רביעי 10.3 · יום 1". */
function slot(page: Page, range: string, day: { label: string }): Locator {
  return page.getByRole('button', {
    name: t('schedule.place.slot', { time: range, day: day.label }),
    exact: true,
  });
}

/** A block in a timetable day column (the column is a group named by its day label). */
function gridBlock(page: Page, day: { label: string }, name: string): Locator {
  return page
    .getByRole('group', { name: day.label, exact: true })
    .getByRole('button', { name, exact: true });
}

function row(backend: { db: { activities: { name: string }[] } }, name: string) {
  return backend.db.activities.find((a) => a.name === name) as
    { scheduled_date: string | null; start_minute: number | null } | undefined;
}

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test.describe('phone: tap to place', () => {
  test.beforeEach(({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== 'phone', 'touch layout only');
  });

  test('tap a bank item, then a highlighted slot: placed and saved', async ({
    page,
    backend,
    user,
  }) => {
    const trip = backend.db.seedTrip(user, TRIPS.rome, [{ name: 'פנתאון', duration_minutes: 60 }]);
    await page.goto(`/trips/${trip.id}`);
    await openBank(page);
    await bankBlock(page, 'פנתאון').getByRole('button').first().tap();

    // Placing mode: the bar names the activity, the bank panel makes room, valid runs are tinted.
    await expect(placingBar(page)).toContainText(t('schedule.place.bar', { name: 'פנתאון' }));
    await expect(bankBlock(page, 'פנתאון')).toBeHidden();
    await expect(page.locator('[data-valid-run]').first()).toBeAttached();
    // Before the trip starts (10:00 on day 1) a slot is offered but marked unavailable.
    await expect(
      page.getByRole('button', {
        name: t('schedule.place.slotUnavailable', { time: '09:00–10:00', day: DAY1.label }),
        exact: true,
      }),
    ).toHaveAttribute('aria-disabled', 'true');

    await slot(page, '12:00–13:00', DAY1).tap();

    await expect(placingBar(page)).toBeHidden();
    await expect(gridBlock(page, DAY1, 'פנתאון 12:00–13:00')).toBeVisible();
    await expect
      .poll(() => row(backend, 'פנתאון'))
      .toMatchObject({
        scheduled_date: DAY1.date,
        start_minute: 720,
      });
    expect(backend.requestsTo(rest('POST', 'rpc/place_activity'))).toHaveLength(1);
    await expect(page.getByTestId('placing-status')).toHaveText(
      t('schedule.place.placed', { name: 'פנתאון', day: DAY1.label, time: '12:00–13:00' }),
    );
  });

  test('tap a placed block, switch to the next day, tap a slot: moved to that day', async ({
    page,
    backend,
    user,
  }) => {
    const trip = backend.db.seedTrip(user, TRIPS.rome, [
      { name: 'קולוסיאום', duration_minutes: 120, scheduled_date: DAY1.date, start_minute: 660 },
    ]);
    await page.goto(`/trips/${trip.id}`);
    await gridBlock(page, DAY1, 'קולוסיאום 11:00–13:00').tap();
    await expect(placingBar(page)).toContainText(t('schedule.place.bar', { name: 'קולוסיאום' }));

    await page.getByRole('button', { name: t('schedule.day.next'), exact: true }).tap();
    await expect(page.getByRole('combobox', { name: t('schedule.day.choose') })).toHaveValue('1');
    // Still placing on the new day.
    await expect(placingBar(page)).toBeVisible();
    await slot(page, '09:00–11:00', DAY2).tap();

    await expect(placingBar(page)).toBeHidden();
    await expect(gridBlock(page, DAY2, 'קולוסיאום 09:00–11:00')).toBeVisible();
    await expect
      .poll(() => row(backend, 'קולוסיאום'))
      .toMatchObject({
        scheduled_date: DAY2.date,
        start_minute: 540,
      });
  });

  test('tap a placed block, "back to the bank": unplaced; "cancel" leaves things as they were', async ({
    page,
    backend,
    user,
  }) => {
    const trip = backend.db.seedTrip(user, TRIPS.rome, [
      { name: 'קולוסיאום', duration_minutes: 120, scheduled_date: DAY1.date, start_minute: 660 },
      { name: 'פנתאון', duration_minutes: 60 },
    ]);
    await page.goto(`/trips/${trip.id}`);

    // Cancel: nothing is saved, the block stays where it was.
    await gridBlock(page, DAY1, 'קולוסיאום 11:00–13:00').tap();
    await placingBar(page)
      .getByRole('button', { name: t('common.cancel'), exact: true })
      .tap();
    await expect(placingBar(page)).toBeHidden();
    await expect(page.locator('[data-valid-run]')).toHaveCount(0);
    await expect(gridBlock(page, DAY1, 'קולוסיאום 11:00–13:00')).toBeVisible();
    await expect(page.getByTestId('placing-status')).toHaveText(t('schedule.place.cancelled'));

    // A bank item has no "back to the bank" button; cancel works there too.
    await openBank(page);
    await bankBlock(page, 'פנתאון').getByRole('button').first().tap();
    await expect(placingBar(page)).toBeVisible();
    await expect(
      placingBar(page).getByRole('button', { name: t('schedule.place.unplace') }),
    ).toHaveCount(0);
    await placingBar(page)
      .getByRole('button', { name: t('common.cancel'), exact: true })
      .tap();
    await expect(placingBar(page)).toBeHidden();
    await openBank(page);
    await expect(bankBlock(page, 'פנתאון')).toBeVisible();
    expect(backend.requestsTo(rest('POST', 'rpc/place_activity'))).toHaveLength(0);
    expect(backend.requestsTo(rest('POST', 'rpc/unplace_activity'))).toHaveLength(0);

    // Back to the bank.
    await gridBlock(page, DAY1, 'קולוסיאום 11:00–13:00').tap();
    await placingBar(page)
      .getByRole('button', { name: t('schedule.place.unplace'), exact: true })
      .tap();
    await expect(placingBar(page)).toBeHidden();
    await expect(gridBlock(page, DAY1, 'קולוסיאום 11:00–13:00')).toHaveCount(0);
    await openBank(page);
    await expect(bankBlock(page, 'קולוסיאום')).toBeVisible();
    await expect(bank(page).getByRole('heading')).toContainText('(2)');
    await expect
      .poll(() => row(backend, 'קולוסיאום'))
      .toMatchObject({
        scheduled_date: null,
        start_minute: null,
      });
  });
});

test.describe('desktop: keyboard placement', () => {
  test.beforeEach(({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== 'desktop', 'keyboard on the desktop grid');
  });

  test('M, arrow keys, Enter: moved; focus lands on the moved block', async ({
    page,
    backend,
    user,
  }) => {
    const trip = backend.db.seedTrip(user, TRIPS.rome, [
      { name: 'קולוסיאום', duration_minutes: 120, scheduled_date: DAY1.date, start_minute: 660 },
    ]);
    await page.goto(`/trips/${trip.id}`);
    const block = gridBlock(page, DAY1, 'קולוסיאום 11:00–13:00');
    await block.focus();
    await page.keyboard.press('m');

    // The cursor starts on the block's own slot and has focus.
    await expect(slot(page, '11:00–13:00', DAY1)).toBeFocused();
    await expect(placingBar(page)).toContainText(t('schedule.place.bar', { name: 'קולוסיאום' }));

    // RTL: ArrowLeft is the next day; ArrowDown is half an hour later.
    await page.keyboard.press('ArrowLeft');
    await expect(slot(page, '11:00–13:00', DAY2)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(slot(page, '12:00–14:00', DAY2)).toBeFocused();
    await page.keyboard.press('Enter');

    const moved = gridBlock(page, DAY2, 'קולוסיאום 12:00–14:00');
    await expect(moved).toBeVisible();
    await expect(moved).toBeFocused();
    await expect(placingBar(page)).toBeHidden();
    await expect
      .poll(() => row(backend, 'קולוסיאום'))
      .toMatchObject({
        scheduled_date: DAY2.date,
        start_minute: 720,
      });

    // Escape cancels and returns focus to the block.
    await moved.press('m');
    await expect(slot(page, '12:00–14:00', DAY2)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(placingBar(page)).toBeHidden();
    await expect(moved).toBeFocused();
    expect(backend.requestsTo(rest('POST', 'rpc/place_activity'))).toHaveLength(1);
  });

  test('a mouse click on a desktop block still opens the edit dialog', async ({
    page,
    backend,
    user,
  }) => {
    const trip = backend.db.seedTrip(user, TRIPS.rome, [
      { name: 'קולוסיאום', duration_minutes: 120, scheduled_date: DAY1.date, start_minute: 660 },
    ]);
    await page.goto(`/trips/${trip.id}`);
    await gridBlock(page, DAY1, 'קולוסיאום 11:00–13:00').click();
    await expect(page.getByRole('dialog', { name: t('bank.dialog.editTitle') })).toBeVisible();
    await expect(placingBar(page)).toHaveCount(0);
  });
});

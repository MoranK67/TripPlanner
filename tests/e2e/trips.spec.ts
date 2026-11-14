// Trip CRUD (M4.1–M4.3): FR-2.1–FR-2.8 and the §9.4 cases "single-day trip", "trip ends at
// 24:00", "90-day trip", "shrinking trip window", "deleting a trip with many activities".

import { rest } from './fake-backend/server';
import { expect, header, test, toast } from './support/fixtures';
import { t } from './support/i18n';
import { bank, nextMonth, pickDay, setTripTimes, tripDialog } from './support/pages';
import { TRIPS } from '../fixtures/testData';

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test.describe('trips list', () => {
  test('empty state → create via the range calendar → trip page', async ({ page, backend }) => {
    await page.goto('/trips');
    await expect(page.getByRole('heading', { name: t('trips.empty.title') })).toBeVisible();
    await page.getByRole('button', { name: t('trips.empty.create') }).click();

    const dialog = tripDialog(page);
    await expect(dialog).toBeVisible();
    // Defaults: today (10 Mar 2027) for 4 days, 10:00–20:00.
    await expect(dialog.getByText('מ־10 במרץ 2027 עד 13 במרץ 2027 · 4 ימים')).toBeVisible();

    await dialog.getByLabel(t('trips.dialog.name')).fill('פריז');
    await pickDay(dialog, '2027-03-15');
    await expect(dialog.getByText(/יום ההתחלה: 15 במרץ 2027/)).toBeVisible();
    await pickDay(dialog, '2027-03-18');
    await setTripTimes(dialog, '09:00', '18:00');
    await expect(dialog.getByText('מ־15 במרץ 2027 עד 18 במרץ 2027 · 4 ימים')).toBeVisible();
    await dialog.getByRole('button', { name: t('trips.dialog.create') }).click();

    await expect(dialog).toBeHidden();
    const created = backend.db.trips[0]!;
    expect(created).toMatchObject({
      name: 'פריז',
      start_date: '2027-03-15',
      start_minute: 540,
      end_date: '2027-03-18',
      end_minute: 1080,
    });
    await expect(page).toHaveURL(new RegExp(`/trips/${created.id}$`));
    await expect(header(page).getByText('15.3 09:00 עד 18.3 18:00 · 4 ימים')).toBeVisible();
    await expect(bank(page).getByText(t('bank.title'))).toBeVisible();
  });

  test('an empty name becomes the default name; a click before the start swaps the days', async ({
    page,
    backend,
  }) => {
    await page.goto('/trips');
    await header(page)
      .getByRole('button', { name: t('trips.new') })
      .click();
    const dialog = tripDialog(page);
    await pickDay(dialog, '2027-03-20');
    await pickDay(dialog, '2027-03-17');
    await expect(dialog.getByText('מ־17 במרץ 2027 עד 20 במרץ 2027 · 4 ימים')).toBeVisible();
    await dialog.getByRole('button', { name: t('trips.dialog.create') }).click();
    await expect(dialog).toBeHidden();
    expect(backend.db.trips[0]).toMatchObject({
      name: t('trips.dialog.defaultName'),
      start_date: '2027-03-17',
      end_date: '2027-03-20',
    });
  });

  test('one-day trip ending at 24:00 (§9.4)', async ({ page, backend }) => {
    await page.goto('/trips');
    await header(page)
      .getByRole('button', { name: t('trips.new') })
      .click();
    const dialog = tripDialog(page);
    await dialog.getByLabel(t('trips.dialog.name')).fill('יום בים');
    await pickDay(dialog, '2027-03-20');
    await pickDay(dialog, '2027-03-20');
    await setTripTimes(dialog, '00:00', '24:00');
    await expect(dialog.getByText('מ־20 במרץ 2027 עד 20 במרץ 2027 · יום אחד')).toBeVisible();
    await dialog.getByRole('button', { name: t('trips.dialog.create') }).click();
    await expect(header(page).getByText('20.3 00:00 עד 20.3 24:00 · יום אחד')).toBeVisible();
    expect(backend.db.trips[0]).toMatchObject({ start_minute: 0, end_minute: 1440 });
  });

  test('end before start is rejected with a Hebrew error and nothing is saved', async ({
    page,
    backend,
  }) => {
    await page.goto('/trips');
    await header(page)
      .getByRole('button', { name: t('trips.new') })
      .click();
    const dialog = tripDialog(page);
    await pickDay(dialog, '2027-03-20');
    await pickDay(dialog, '2027-03-20');
    await setTripTimes(dialog, '18:00', '10:00');
    await dialog.getByRole('button', { name: t('trips.dialog.create') }).click();

    await expect(dialog.getByText(t('trips.dialog.errors.end_not_after_start'))).toBeVisible();
    await expect(dialog.getByLabel(t('trips.dialog.endTime'))).toBeFocused();
    await expect(dialog).toBeVisible();
    expect(backend.requestsTo(rest('POST', 'trips'))).toHaveLength(0);
  });

  test('only a start day picked asks for the end day', async ({ page, backend }) => {
    await page.goto('/trips');
    await header(page)
      .getByRole('button', { name: t('trips.new') })
      .click();
    const dialog = tripDialog(page);
    await pickDay(dialog, '2027-03-25'); // after a complete default range: starts a new range
    await dialog.getByRole('button', { name: t('trips.dialog.create') }).click();
    await expect(dialog.getByText(t('trips.dialog.errors.missing_end'))).toBeVisible();
    expect(backend.requestsTo(rest('POST', 'trips'))).toHaveLength(0);
  });

  test('more than 90 days is rejected; exactly 90 days is accepted (FR-2.5)', async ({
    page,
    backend,
  }) => {
    await page.goto('/trips');
    await header(page)
      .getByRole('button', { name: t('trips.new') })
      .click();
    const dialog = tripDialog(page);
    await dialog.getByLabel(t('trips.dialog.name')).fill('מסע ארוך');

    // 10 Mar → 8 Jun 2027 = 91 days.
    await pickDay(dialog, '2027-03-10');
    await nextMonth(dialog, 3);
    await pickDay(dialog, '2027-06-08');
    await dialog.getByRole('button', { name: t('trips.dialog.create') }).click();
    await expect(dialog.getByText(t('trips.dialog.errors.too_long'))).toBeVisible();
    expect(backend.requestsTo(rest('POST', 'trips'))).toHaveLength(0);

    // 8 Jun → 6 Sep 2027 = 91 days again; 7 Jun is the first day of a 90-day trip ending 4 Sep.
    await pickDay(dialog, '2027-06-07');
    await nextMonth(dialog, 3);
    await pickDay(dialog, '2027-09-04');
    await expect(dialog.getByText(/90 ימים/)).toBeVisible();
    await expect(dialog.getByText(t('trips.dialog.errors.too_long'))).toBeHidden();
    await dialog.getByRole('button', { name: t('trips.dialog.create') }).click();
    await expect(dialog).toBeHidden();
    expect(backend.db.trips[0]).toMatchObject({ start_date: '2027-06-07', end_date: '2027-09-04' });
  });

  test('cards are sorted by start and show name, range and day count (FR-2.8)', async ({
    page,
    backend,
    user,
  }) => {
    backend.db.seedTrip(user, TRIPS.lisbon);
    backend.db.seedTrip(user, TRIPS.athens);
    await page.goto('/trips');
    await header(page)
      .getByRole('button', { name: t('trips.new') })
      .click();
    const dialog = tripDialog(page);
    await dialog.getByLabel(t('trips.dialog.name')).fill('רומא');
    await dialog.getByRole('button', { name: t('trips.dialog.create') }).click(); // default range
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/);

    await header(page)
      .getByRole('link', { name: t('app.title') })
      .click();
    const cards = page.getByRole('main').getByRole('listitem');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText(TRIPS.athens.name);
    await expect(cards.nth(1)).toContainText('רומא');
    await expect(cards.nth(2)).toContainText(TRIPS.lisbon.name);
    await expect(cards.nth(0)).toContainText('15 בינואר 2027 10:00 עד 16 בינואר 2027 20:00');
    await expect(cards.nth(0)).toContainText('יומיים');
    await expect(cards.nth(1)).toContainText('4 ימים');
  });
});

test.describe('trip page', () => {
  test('switching trips from the header (FR-2.1)', async ({ page, backend, user }) => {
    const rome = backend.db.seedTrip(user, TRIPS.rome);
    const lisbon = backend.db.seedTrip(user, TRIPS.lisbon);
    await page.goto(`/trips/${rome.id}`);
    const switcher = header(page).getByLabel(t('trips.switch'));
    await expect(switcher).toHaveValue(rome.id);
    await switcher.selectOption({ label: TRIPS.lisbon.name });
    await expect(page).toHaveURL(new RegExp(`/trips/${lisbon.id}$`));
    await expect(header(page).getByText('2.4 10:00 עד 5.4 20:00 · 4 ימים')).toBeVisible();
  });

  test('shrinking the window returns placed activities to the bank with a count (FR-2.6)', async ({
    page,
    backend,
    user,
  }) => {
    const trip = backend.db.seedTrip(user, TRIPS.rome, [
      { name: 'קולוסיאום', scheduled_date: '2027-03-12', start_minute: 600 },
      { name: 'הוותיקן', scheduled_date: '2027-03-13', start_minute: 660, duration_minutes: 120 },
      { name: 'פיאצה נבונה', scheduled_date: '2027-03-10', start_minute: 720 },
      { name: 'ג׳לטו' },
    ]);
    await page.goto(`/trips/${trip.id}`);
    await expect(bank(page).getByRole('listitem')).toHaveCount(1);

    await header(page)
      .getByRole('button', { name: t('trips.edit') })
      .click();
    const dialog = tripDialog(page, 'edit');
    await expect(dialog.getByLabel(t('trips.dialog.name'))).toHaveValue(TRIPS.rome.name);
    await pickDay(dialog, '2027-03-10');
    await pickDay(dialog, '2027-03-11');
    await dialog.getByRole('button', { name: t('common.save') }).click();

    await expect(dialog).toBeHidden();
    await expect(toast(page, t('trips.movedToBank_two'))).toBeVisible();
    await expect(header(page).getByText('10.3 10:00 עד 11.3 20:00 · יומיים')).toBeVisible();
    // The two moved activities are appended to the bank in timetable order.
    const items = bank(page).getByRole('listitem');
    await expect(items).toHaveCount(3);
    await expect(items.nth(1)).toContainText('קולוסיאום');
    await expect(items.nth(2)).toContainText('הוותיקן');
    const rpc = backend.requestsTo(rest('POST', 'rpc/update_trip_window'));
    expect(rpc).toHaveLength(1);
    expect(rpc[0]!.body).toMatchObject({ trip_id: trip.id, end_date: '2027-03-11' });
  });

  test('editing without leaving the window shows no moved-count toast', async ({
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
    await dialog.getByLabel(t('trips.dialog.name')).fill('רומא והוותיקן');
    await setTripTimes(dialog, undefined, '22:00');
    await dialog.getByRole('button', { name: t('common.save') }).click();
    await expect(dialog).toBeHidden();
    await expect(header(page).getByText('10.3 10:00 עד 13.3 22:00 · 4 ימים')).toBeVisible();
    await expect(header(page).getByLabel(t('trips.switch'))).toContainText('רומא והוותיקן');
    await expect(page.getByText(/חזרו למאגר|חזרה למאגר/)).toHaveCount(0);
  });

  test('delete asks first (Cancel focused, Esc closes), then deletes with its activities', async ({
    page,
    backend,
    user,
  }) => {
    const trip = backend.db.seedTrip(
      user,
      TRIPS.rome,
      Array.from({ length: 12 }, (_, i) => ({ name: `אטרקציה ${i + 1}` })),
    );
    const other = backend.db.seedTrip(user, TRIPS.lisbon, [{ name: 'טראם 28' }]);
    await page.goto(`/trips/${trip.id}`);
    const deleteButton = header(page).getByRole('button', { name: t('common.delete') });
    const confirm = page.getByRole('alertdialog', { name: t('trips.deleteConfirm.title') });

    await deleteButton.click();
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(
      t('trips.deleteConfirm.message', { name: TRIPS.rome.name }),
    );
    await expect(confirm.getByRole('button', { name: t('common.cancel') })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    await expect(deleteButton).toBeFocused(); // focus returns to the opener

    await deleteButton.click();
    await confirm.getByRole('button', { name: t('common.cancel') }).click();
    await expect(confirm).toBeHidden();
    expect(backend.requestsTo(rest('DELETE', 'trips'))).toHaveLength(0);

    await deleteButton.click();
    await confirm.getByRole('button', { name: t('common.confirmDelete') }).click();
    await expect(page).toHaveURL(/\/trips$/);
    await expect(toast(page, t('trips.deleted', { name: TRIPS.rome.name }))).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(TRIPS.rome.name) })).toHaveCount(0);
    await expect(page.getByRole('link', { name: new RegExp(TRIPS.lisbon.name) })).toBeVisible();
    // Cascade: only the other trip's activity remains.
    expect(backend.db.activities.map((a) => a.trip_id)).toEqual([other.id]);
  });

  test('an unknown trip id shows "not found" with a way back', async ({ page }) => {
    await page.goto('/trips/00000000-0000-4000-8000-0000deadbeef');
    await expect(page.getByRole('heading', { name: t('planner.notFound') })).toBeVisible();
    await page.getByRole('link', { name: t('notFound.back') }).click();
    await expect(page).toHaveURL(/\/trips$/);
  });
});

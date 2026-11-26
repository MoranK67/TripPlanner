// FEAT-3: AI import with a type choice and automatic placement, on desktop and phone.
// Spec: docs/specs/design-fixes-and-ai-placement.md ("FEAT-3").

import type { Locator, Page } from '@playwright/test';
import type { ActivityRow } from './fake-backend/db';
import { expectNoA11yViolations } from './support/axe';
import { expect, test, toast } from './support/fixtures';
import { t } from './support/i18n';
import { bank, bankBlock, isPhone, openBank } from './support/pages';
import { TRIPS } from '../fixtures/testData';

/** "יום רביעי 10.3 · יום 1": the label of a trip day (day switcher, grid columns). */
function dayLabel(isoDate: string, n: number): string {
  const weekday = new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('he-IL', {
    weekday: 'long',
    timeZone: 'UTC',
  });
  const [, m, d] = isoDate.split('-').map(Number);
  return t('schedule.day.option', { weekday, date: `${d}.${m}`, n });
}

// Rome: 10–13 Mar 2027, 10:00–20:00.
const DAY1 = { date: '2027-03-10', n: 1, label: dayLabel('2027-03-10', 1) };
const DAY2 = { date: '2027-03-11', n: 2, label: dayLabel('2027-03-11', 2) };

const TYPE_LABELS = {
  basic: t('import.type.basic.label'),
  tags: t('import.type.tags.label'),
  placement: t('import.type.placement.label'),
} as const;

// The clipboard may turn line breaks into CRLF (Windows).
const FORMAT_LINES = {
  basic: /בדיוק בפורמט: שם;משך\r?\n/,
  tags: /בדיוק בפורמט: שם;משך;תגית\r?\n/,
  placement: /בדיוק בפורמט: שם;משך;תגית;יום;שעת התחלה\r?\n/,
} as const;

function row(backend: { db: { activities: ActivityRow[] } }, name: string) {
  return backend.db.activities.find((a) => a.name === name);
}

async function openImport(page: Page): Promise<Locator> {
  await openBank(page);
  await bank(page)
    .getByRole('button', { name: t('import.openLabel') })
    .click();
  const dialog = page.getByRole('dialog', { name: t('import.title') });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function chooseType(dialog: Locator, type: keyof typeof TYPE_LABELS): Promise<void> {
  const radio = dialog.getByRole('radio', { name: TYPE_LABELS[type], exact: true });
  await radio.check();
  await expect(radio).toBeChecked();
}

function previewItems(dialog: Locator): Locator {
  return dialog.getByRole('list', { name: t('import.previewLabel') }).getByRole('listitem');
}

const bankWith = (reason: string) => t('import.destination.bankWithReason', { reason });

/** A block in a timetable day column. Phone: switch the one-day view to that day first. */
async function expectGridBlock(
  page: Page,
  day: typeof DAY1,
  name: string,
  time: string,
): Promise<void> {
  if (isPhone(page)) {
    await page
      .getByRole('combobox', { name: t('schedule.day.choose') })
      .selectOption(String(day.n - 1));
  }
  await expect(
    page
      .getByRole('group', { name: day.label, exact: true })
      .getByRole('button', { name: `${name} ${time}` }),
  ).toHaveCount(1);
}

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test.describe('FEAT-3: import types', () => {
  test('"+ תגיות" is the default; the choice is remembered on this device', async ({
    page,
    backend,
    user,
  }) => {
    const trip = backend.db.seedTrip(user, TRIPS.rome);
    await page.goto(`/trips/${trip.id}`);
    let dialog = await openImport(page);
    const group = dialog.getByRole('radiogroup', { name: t('import.type.legend') });
    await expect(group.getByRole('radio')).toHaveCount(3);
    await expect(group.getByRole('radio', { name: TYPE_LABELS.tags })).toBeChecked();
    await chooseType(dialog, 'placement');
    await expect(dialog.getByLabel(t('import.textLabel'))).toHaveAttribute(
      'placeholder',
      t('import.placeholder.placement'),
    );

    await page.reload();
    dialog = await openImport(page);
    await expect(dialog.getByRole('radio', { name: TYPE_LABELS.placement })).toBeChecked();
  });

  test('basic: placement fields are ignored and everything goes to the bank', async ({
    page,
    backend,
    user,
  }) => {
    const trip = backend.db.seedTrip(user, TRIPS.rome);
    await page.goto(`/trips/${trip.id}`);
    const dialog = await openImport(page);
    await chooseType(dialog, 'basic');
    await dialog.getByLabel(t('import.textLabel')).fill('קולוסיאום; 3; ; 1; 10:00\nגלידה; 0.5');
    await expect(previewItems(dialog)).toHaveCount(2);
    await expect(dialog.getByText(/^יום 1 ·/)).toHaveCount(0);
    await dialog.getByRole('button', { name: t('import.submit_two') }).click();
    await expect(toast(page, t('import.success_two'))).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect.poll(() => row(backend, 'קולוסיאום')?.scheduled_date).toBeNull();
    await openBank(page);
    await expect(bankBlock(page, 'קולוסיאום')).toBeVisible();
    await expect(bankBlock(page, 'גלידה')).toBeVisible();
  });

  test('tags: the tag is saved, placement fields are ignored', async ({ page, backend, user }) => {
    const trip = backend.db.seedTrip(user, TRIPS.rome);
    await page.goto(`/trips/${trip.id}`);
    const dialog = await openImport(page);
    await dialog.getByLabel(t('import.textLabel')).fill('קולוסיאום; 3; רומא העתיקה; 1; 10:00');
    await expect(previewItems(dialog).first()).toContainText(
      `${t('import.tagPrefix')} רומא העתיקה`,
    );
    await expect(dialog.getByText(/^יום 1 ·/)).toHaveCount(0);
    await dialog.getByRole('button', { name: t('import.submit_one') }).click();
    await expect(toast(page, t('import.success_one'))).toBeVisible();
    await expect.poll(() => row(backend, 'קולוסיאום')?.tag).toBe('רומא העתיקה');
    expect(row(backend, 'קולוסיאום')?.scheduled_date).toBeNull();
  });

  for (const type of ['basic', 'tags', 'placement'] as const) {
    test(`copy the AI prompt for the "${type}" type`, async ({ page, context, backend, user }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const trip = backend.db.seedTrip(user, TRIPS.rome);
      await page.goto(`/trips/${trip.id}`);
      const dialog = await openImport(page);
      await chooseType(dialog, type);
      await dialog.getByRole('button', { name: t('import.ai.button') }).click();
      await expect(toast(page, t('import.ai.copied'))).toBeVisible();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toContain('רומא 2027');
      expect(copied).toMatch(FORMAT_LINES[type]);
      if (type === 'placement') {
        expect(copied).toContain('- יום 1: יום רביעי 10.3.2027, 10:00–24:00');
        expect(copied).toContain('- יום 4: יום שבת 13.3.2027, 00:00–20:00');
      } else {
        expect(copied).not.toContain('- יום 1:');
      }
    });
  }
});

test.describe('FEAT-3: placement', () => {
  test('mixed rows: placed ones land in the timetable, the rest in the bank with a reason', async ({
    page,
    backend,
    user,
  }) => {
    const trip = backend.db.seedTrip(user, TRIPS.rome, [
      { name: 'פנתאון', duration_minutes: 60, scheduled_date: DAY2.date, start_minute: 720 },
    ]);
    await page.goto(`/trips/${trip.id}`);
    const dialog = await openImport(page);
    await chooseType(dialog, 'placement');
    await dialog
      .getByLabel(t('import.textLabel'))
      .fill(
        [
          'קולוסיאום; 3; רומא העתיקה; 1; 10:00',
          'פורום רומאי; 2; רומא העתיקה; 1; 12:00',
          'פיאצה נבונה; 1; מרכז העיר; 2; 12:30',
          'טרסטוורה; 2; ערב; 4; 19:00',
          'וותיקן; 4; ; 2; 08:00',
          'אוסטיה; 3; ; 9; 10:00',
          'גלידה; 0.5',
        ].join('\n'),
      );
    const items = previewItems(dialog);
    await expect(items).toHaveCount(7);
    await expect(items.nth(0)).toContainText('יום 1 · 10:00–13:00');
    await expect(items.nth(1)).toContainText(
      bankWith(t('import.bankReasons.overlaps_import_row', { row: 1 })),
    );
    await expect(items.nth(2)).toContainText(
      bankWith(t('import.bankReasons.overlaps_existing', { name: 'פנתאון' })),
    );
    await expect(items.nth(3)).toContainText(bankWith(t('import.bankReasons.outside_trip_hours')));
    // Back to back with "פנתאון" (12:00) is not an overlap.
    await expect(items.nth(4)).toContainText('יום 2 · 08:00–12:00');
    await expect(items.nth(5)).toContainText(bankWith(t('import.bankReasons.day_out_of_trip')));
    await expect(items.nth(6)).toContainText(t('import.destination.bank'));
    await expect(dialog.getByText('שתיים ישובצו, 5 למאגר', { exact: true })).toBeVisible();
    await expectNoA11yViolations(page, 'import dialog with a placement preview');

    await dialog
      .getByRole('button', { name: t('import.submitPlacement_other', { count: 7 }) })
      .click();
    await expect(toast(page, 'נוספו 7: שתיים שובצו, 5 במאגר')).toBeVisible();
    await expect(dialog).toBeHidden();

    expect(row(backend, 'קולוסיאום')).toMatchObject({
      scheduled_date: DAY1.date,
      start_minute: 600,
    });
    expect(row(backend, 'וותיקן')).toMatchObject({ scheduled_date: DAY2.date, start_minute: 480 });
    for (const name of ['פורום רומאי', 'פיאצה נבונה', 'טרסטוורה', 'אוסטיה', 'גלידה']) {
      expect(row(backend, name)?.scheduled_date, name).toBeNull();
    }
    await expectGridBlock(page, DAY1, 'קולוסיאום', '10:00–13:00');
    await expectGridBlock(page, DAY2, 'וותיקן', '08:00–12:00');
    await openBank(page);
    await expect(bankBlock(page, 'פיאצה נבונה')).toBeVisible();
    await expect(bankBlock(page, 'קולוסיאום')).toHaveCount(0);
  });

  test('the server decides: a slot taken after the preview sends the row to the bank', async ({
    page,
    backend,
    user,
  }) => {
    const trip = backend.db.seedTrip(user, TRIPS.rome);
    await page.goto(`/trips/${trip.id}`);
    const dialog = await openImport(page);
    await chooseType(dialog, 'placement');
    await dialog.getByLabel(t('import.textLabel')).fill('קולוסיאום; 3; ; 1; 10:00\nגלידה; 1');
    await expect(previewItems(dialog).first()).toContainText('יום 1 · 10:00–13:00');
    // Another device places an activity in that slot meanwhile.
    const other = backend.db.insertActivity(user.id, {
      trip_id: trip.id,
      name: 'מכשול',
      duration_minutes: 60,
    });
    other.scheduled_date = DAY1.date;
    other.start_minute = 660;

    await dialog.getByRole('button', { name: t('import.submitPlacement_two') }).click();
    await expect(
      toast(
        page,
        `${t('import.success_two')}. „קולוסיאום” לא שובצה: ${t('import.bankReasons.overlaps_existing_unknown')}`,
      ),
    ).toBeVisible();
    expect(row(backend, 'קולוסיאום')?.scheduled_date).toBeNull();
  });
});

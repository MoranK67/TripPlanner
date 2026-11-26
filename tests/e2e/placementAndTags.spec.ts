// FEAT-1 (place from the activity dialog) and FEAT-2 (tags: same colour, bank filter, AI prompt),
// on desktop and phone. Spec: docs/specs/feat-1-2-placement-and-tags.md.

import type { Locator, Page } from '@playwright/test';
import type { ActivityRow } from './fake-backend/db';
import { rest } from './fake-backend/server';
import { expectNoA11yViolations } from './support/axe';
import { expect, test, toast } from './support/fixtures';
import { t } from './support/i18n';
import {
  activityDialog,
  bank,
  bankBlock,
  isPhone,
  openActivityEditor,
  openBank,
  typeTime,
} from './support/pages';
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

const DAY1 = { date: '2027-03-10', n: 1, label: dayLabel('2027-03-10', 1) };
const DAY2 = { date: '2027-03-11', n: 2, label: dayLabel('2027-03-11', 2) };

const PINK = '#FFD6E0';
const SKY = '#CDE5FF';
const LAVENDER = '#DAD4FA';

/** A block in a timetable day column (the column is a group named by its day label). */
function gridBlock(page: Page, day: { label: string }, name: string): Locator {
  return page
    .getByRole('group', { name: day.label, exact: true })
    .getByRole('button', { name, exact: true });
}

function row(backend: { db: { activities: ActivityRow[] } }, name: string) {
  return backend.db.activities.find((a) => a.name === name);
}

/** The bank's tag filter menu button (DES-1): "סינון: הכול" or "סינון: <tag> (<count>)". */
function filterTrigger(page: Page): Locator {
  return bank(page).getByRole('button', { name: new RegExp(`^${t('bank.filter.trigger')} `) });
}

/** Opens the tag filter menu and returns one of its options (Esc closes it again). */
async function filterOption(page: Page, name: string): Promise<Locator> {
  await filterTrigger(page).click();
  return page
    .getByRole('menu', { name: t('bank.filter.label') })
    .getByRole('menuitemradio', { name, exact: true });
}

/** The dialog's placement controls. */
function placement(dialog: Locator) {
  return {
    day: dialog.getByRole('combobox', { name: t('bank.dialog.placement.day'), exact: true }),
    from: dialog.getByLabel(t('bank.dialog.placement.from'), { exact: true }),
    to: dialog.getByLabel(t('bank.dialog.placement.to'), { exact: true }),
    duration: dialog.getByLabel(t('bank.dialog.duration')),
  };
}

/**
 * Opens the edit dialog of a placed block. Desktop: a click. Phone: a tap picks it up, then the
 * placing bar's "עריכה" (the phone shows one day: switch to it first).
 */
async function openPlacedEditor(page: Page, day: typeof DAY1, name: string): Promise<void> {
  if (!isPhone(page)) {
    await gridBlock(page, day, name).click();
    return;
  }
  const chooser = page.getByRole('combobox', { name: t('schedule.day.choose') });
  await chooser.selectOption(String(day.n - 1));
  await gridBlock(page, day, name).tap();
  await page
    .getByTestId('placing-bar')
    .getByRole('button', { name: t('schedule.place.edit'), exact: true })
    .tap();
}

async function save(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: t('common.save'), exact: true }).click();
  await expect(dialog).toBeHidden();
}

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test.describe('FEAT-1: placement from the dialog', () => {
  test('place from the dialog, move to another day, then back to the bank', async ({
    page,
    backend,
    user,
  }) => {
    const trip = backend.db.seedTrip(user, TRIPS.rome, [{ name: 'פנתאון', duration_minutes: 60 }]);
    await page.goto(`/trips/${trip.id}`);

    // Place: a bank activity starts "not placed", times disabled.
    await openActivityEditor(page, 'פנתאון');
    const dialog = activityDialog(page, 'edit');
    const f = placement(dialog);
    await expect(f.day).toHaveValue('');
    await expect(f.from).toBeDisabled();
    await f.day.selectOption(DAY1.date);
    // The first free slot of the first day: the trip starts at 10:00.
    await expect(f.from).toHaveValue('10:00');
    await expect(f.to).toHaveValue('11:00');
    await typeTime(f.from, '1200', '12:00');
    await typeTime(f.to, '1330', '13:30');
    await expect(f.duration).toHaveValue('01:30');
    // Phone (PHONE-1): the full-screen dialog keeps the Save button reachable.
    await expect(
      dialog.getByRole('button', { name: t('common.save'), exact: true }),
    ).toBeInViewport();
    await save(dialog);

    await expect(gridBlock(page, DAY1, 'פנתאון 12:00–13:30')).toBeVisible();
    await expect
      .poll(() => row(backend, 'פנתאון'))
      .toMatchObject({ scheduled_date: DAY1.date, start_minute: 720, duration_minutes: 90 });
    expect(backend.requestsTo(rest('POST', 'rpc/update_activity'))).toHaveLength(1);
    await expect(toast(page, t('bank.returnedToBank'))).toHaveCount(0);

    // Move to the next day: the times stay.
    await openPlacedEditor(page, DAY1, 'פנתאון 12:00–13:30');
    await expect(f.day).toHaveValue(DAY1.date);
    await expect(f.from).toHaveValue('12:00');
    await expect(f.to).toHaveValue('13:30');
    await f.day.selectOption(DAY2.date);
    await save(dialog);
    await expect
      .poll(() => row(backend, 'פנתאון'))
      .toMatchObject({ scheduled_date: DAY2.date, start_minute: 720 });

    // Back to the bank.
    await openPlacedEditor(page, DAY2, 'פנתאון 12:00–13:30');
    await f.day.selectOption('');
    await expect(f.from).toBeDisabled();
    await save(dialog);
    await expect.poll(() => row(backend, 'פנתאון')).toMatchObject({ scheduled_date: null });
    await openBank(page);
    await expect(bankBlock(page, 'פנתאון')).toBeVisible();
    await expect(toast(page, t('bank.returnedToBank'))).toHaveCount(0);
  });

  test('an overlap is shown inline and blocks Save; a server overlap is shown in the dialog', async ({
    page,
    backend,
    user,
  }) => {
    const trip = backend.db.seedTrip(user, TRIPS.rome, [
      { name: 'קולוסיאום', duration_minutes: 120, scheduled_date: DAY1.date, start_minute: 600 },
      { name: 'פנתאון', duration_minutes: 60 },
    ]);
    await page.goto(`/trips/${trip.id}`);
    await openActivityEditor(page, 'פנתאון');
    const dialog = activityDialog(page, 'edit');
    const f = placement(dialog);
    const saveButton = dialog.getByRole('button', { name: t('common.save'), exact: true });

    await f.day.selectOption(DAY1.date);
    // 10:00–12:00 is taken: the first free hour is 12:00.
    await expect(f.from).toHaveValue('12:00');
    await typeTime(f.from, '1100', '11:00');
    await typeTime(f.to, '1200', '12:00');
    await expect(
      dialog.getByText(
        t('bank.dialog.placement.errors.conflict_overlap', {
          name: 'קולוסיאום',
          time: '10:00–12:00',
        }),
      ),
    ).toBeVisible();
    await expect(f.to).toHaveAttribute('aria-invalid', 'true');
    await expect(saveButton).toBeDisabled();

    // Free again: Save works, unless someone else took the slot meanwhile (server check).
    await typeTime(f.from, '1400', '14:00');
    await typeTime(f.to, '1500', '15:00');
    await expect(saveButton).toBeEnabled();
    // Another device moves the Colosseum to 14:00 behind our back.
    const intruder = row(backend, 'קולוסיאום')!;
    intruder.start_minute = 840;
    await saveButton.click();
    await expect(dialog.getByRole('alert')).toHaveText(t('errors.kinds.conflict_overlap'));
    await expect(dialog).toBeVisible();
    expect(row(backend, 'פנתאון')).toMatchObject({ scheduled_date: null });
  });
});

test.describe('FEAT-2: tags', () => {
  test('import with tags: the preview and the saved rows share a colour per tag', async ({
    page,
    backend,
    user,
  }) => {
    const trip = backend.db.seedTrip(user, TRIPS.rome, [
      { name: 'פנתאון', color: SKY, tag: 'מרכז העיר' },
    ]);
    await page.goto(`/trips/${trip.id}`);
    await openBank(page);
    await bank(page)
      .getByRole('button', { name: t('import.openLabel') })
      .click();
    const dialog = page.getByRole('dialog', { name: t('import.title') });
    await dialog
      .getByLabel(t('import.textLabel'))
      .fill('טרסטוורה; 2; ערב\nפיאצה נבונה; 1; מרכז העיר\nארוחת ערב; 1.5; ערב\nגלידה; 0.5');
    const items = dialog
      .getByRole('list', { name: t('import.previewLabel') })
      .getByRole('listitem');
    await expect(items).toHaveCount(4);
    await expect(items.nth(1)).toContainText(`${t('import.tagPrefix')} מרכז העיר`);
    const dots = items.locator('[aria-hidden="true"]');
    const colors = await dots.evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).style.backgroundColor),
    );
    // "ערב" is new (next cursor colour), "מרכז העיר" joins the existing group (sky).
    expect(colors[0]).toBe(colors[2]);
    expect(colors[1]).toBe('rgb(205, 229, 255)');
    expect(colors[3]).not.toBe(colors[0]);

    await dialog.getByRole('button', { name: t('import.submit_other', { count: 4 }) }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => row(backend, 'פיאצה נבונה')?.color).toBe(SKY);
    expect(row(backend, 'טרסטוורה')?.color).toBe(row(backend, 'ארוחת ערב')?.color);
    expect(row(backend, 'טרסטוורה')?.tag).toBe('ערב');
    // The bank shows the server's colours.
    await expect(
      bankBlock(page, 'פיאצה נבונה').getByTitle('פיאצה נבונה · מרכז העיר'),
    ).toHaveAttribute('style', new RegExp(`--block-color: ${SKY}`, 'i'));
  });

  test('the bank tag filter (compact menu, DES-1)', async ({ page, backend, user }) => {
    const trip = backend.db.seedTrip(user, TRIPS.rome, [
      { name: 'פנתאון', tag: 'מרכז העיר' },
      { name: 'פיאצה נבונה', tag: 'מרכז העיר' },
      { name: 'טרסטוורה', tag: 'ערב' },
      { name: 'גלידה' },
    ]);
    await page.goto(`/trips/${trip.id}`);
    await openBank(page);
    const trigger = filterTrigger(page);
    await expect(trigger).toHaveAccessibleName(
      `${t('bank.filter.trigger')} ${t('bank.filter.all')}`,
    );
    const items = bank(page).getByRole('listitem');
    await expect(items).toHaveCount(4);
    await expectNoA11yViolations(page, 'bank with the tag filter');

    await trigger.click();
    const menu = page.getByRole('menu', { name: t('bank.filter.label') });
    await expect(menu.getByRole('menuitemradio')).toHaveText(['✓הכול', 'מרכז העיר (2)', 'ערב (1)']);
    await expect(menu.getByRole('menuitemradio', { name: t('bank.filter.all') })).toBeFocused();
    await expectNoA11yViolations(page, 'bank tag filter menu open');
    // Keyboard: down to the first tag, Enter chooses it and closes the menu.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    await expect(trigger).toHaveAccessibleName(`${t('bank.filter.trigger')} מרכז העיר (2)`);
    await expect(trigger).toBeFocused();
    await expect(items).toHaveCount(2);
    await expect(bankBlock(page, 'גלידה')).toHaveCount(0);
    await expectNoA11yViolations(page, 'bank tag filter active');

    // The ✕ next to it clears the filter.
    await bank(page)
      .getByRole('button', { name: t('bank.filter.clear'), exact: true })
      .click();
    await expect(items).toHaveCount(4);
    await expect(trigger).toHaveAccessibleName(
      `${t('bank.filter.trigger')} ${t('bank.filter.all')}`,
    );

    // Choosing "הכול" from the menu also shows all; Esc closes without choosing.
    await trigger.click();
    await menu.getByRole('menuitemradio', { name: 'ערב (1)' }).click();
    await expect(items).toHaveCount(1);
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(items).toHaveCount(1);
    await trigger.click();
    await menu.getByRole('menuitemradio', { name: t('bank.filter.all') }).click();
    await expect(items).toHaveCount(4);
  });

  test('editing a tag: joins the group colour, then clears it', async ({ page, backend, user }) => {
    const trip = backend.db.seedTrip(user, TRIPS.rome, [
      { name: 'פנתאון', color: LAVENDER, tag: 'מרכז העיר' },
      { name: 'גלידה', color: PINK },
    ]);
    await page.goto(`/trips/${trip.id}`);

    await openActivityEditor(page, 'גלידה');
    const dialog = activityDialog(page, 'edit');
    const tagField = dialog.getByLabel(t('bank.dialog.tag'));
    await expect(tagField).toHaveValue('');
    await dialog
      .getByRole('group', { name: t('bank.dialog.tagSuggestions') })
      .getByRole('button', { name: 'מרכז העיר' })
      .click();
    await expect(tagField).toHaveValue('מרכז העיר');
    await expect(dialog.getByRole('radio', { name: t('common.colors.lavender') })).toBeChecked();
    await expect(dialog.getByText(t('bank.dialog.colorFromTag'))).toBeVisible();
    await placement(dialog).day.selectOption(DAY1.date);
    await expectNoA11yViolations(page, 'activity dialog with tag and placement');
    await placement(dialog).day.selectOption('');
    await save(dialog);

    await expect
      .poll(() => row(backend, 'גלידה'))
      .toMatchObject({
        tag: 'מרכז העיר',
        color: LAVENDER,
      });
    await openBank(page);
    await expect(await filterOption(page, 'מרכז העיר (2)')).toBeVisible();
    await page.keyboard.press('Escape');

    // Clear the tag: the colour stays, the chip count drops.
    await openActivityEditor(page, 'גלידה');
    await expect(tagField).toHaveValue('מרכז העיר');
    await tagField.fill('');
    await save(dialog);
    await expect.poll(() => row(backend, 'גלידה')?.tag).toBeNull();
    expect(row(backend, 'גלידה')?.color).toBe(LAVENDER);
    await openBank(page);
    await expect(await filterOption(page, 'מרכז העיר (1)')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('copy the AI prompt', async ({ page, context, backend, user }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const trip = backend.db.seedTrip(user, TRIPS.rome);
    await page.goto(`/trips/${trip.id}`);
    await openBank(page);
    await bank(page)
      .getByRole('button', { name: t('import.openLabel') })
      .click();
    const dialog = page.getByRole('dialog', { name: t('import.title') });
    await expect(dialog.getByText(t('import.ai.explain'))).toBeVisible();
    await dialog.getByRole('button', { name: t('import.ai.button') }).click();
    await expect(toast(page, t('import.ai.copied'))).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('רומא 2027');
    expect(copied).toContain('10.3.2027–13.3.2027');
    expect(copied).toContain('שם;משך;תגית');
  });

  test('copy the AI prompt: manual fallback when the clipboard refuses', async ({
    page,
    backend,
    user,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('denied')) },
      });
    });
    const trip = backend.db.seedTrip(user, TRIPS.rome);
    await page.goto(`/trips/${trip.id}`);
    await openBank(page);
    await bank(page)
      .getByRole('button', { name: t('import.openLabel') })
      .click();
    const dialog = page.getByRole('dialog', { name: t('import.title') });
    await dialog.getByRole('button', { name: t('import.ai.button') }).click();
    const box = dialog.getByLabel(t('import.ai.fallbackLabel'));
    await expect(box).toBeFocused();
    await expect(box).toHaveJSProperty('readOnly', true);
    await expect(box).toHaveValue(/רומא 2027/);
    const selected = await box.evaluate(
      (el) => (el as HTMLTextAreaElement).selectionEnd - (el as HTMLTextAreaElement).selectionStart,
    );
    expect(selected).toBeGreaterThan(100);
  });
});

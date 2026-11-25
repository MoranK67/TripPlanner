// Automated accessibility checks (NFR-7, WCAG 2.1 AA) with axe-core on the main screens and
// dialogs, on both the desktop and the phone project. Fails on serious/critical violations only;
// see support/axe.ts for the rule set, the report attachments and the exclusion policy.

import { expect, test } from './support/fixtures';
import { expectNoA11yViolations } from './support/axe';
import { t } from './support/i18n';
import {
  activityDialog,
  bank,
  clickHeaderAction,
  isPhone,
  openBank,
  tripDialog,
} from './support/pages';
import { TRIPS } from '../fixtures/testData';

test.describe('signed out', () => {
  test('login page', async ({ page, user }) => {
    void user;
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: t('auth.login.title') })).toBeVisible();
    await expectNoA11yViolations(page, 'login');

    // With field errors shown.
    await page.getByRole('button', { name: t('auth.login.submit'), exact: true }).click();
    await expect(page.getByText(t('auth.login.emailRequired'))).toBeVisible();
    await expectNoA11yViolations(page, 'login with errors');
  });

  test('forgot-password page', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByRole('heading', { name: t('auth.forgot.title') })).toBeVisible();
    await expectNoA11yViolations(page, 'forgot password');
  });
});

test.describe('signed in', () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test('trips list: empty, new-trip dialog, restore dialog', async ({ page }) => {
    await page.goto('/trips');
    await expect(page.getByRole('heading', { name: t('trips.empty.title') })).toBeVisible();
    await expectNoA11yViolations(page, 'trips list (empty)');

    await page.getByRole('button', { name: t('trips.empty.create') }).click();
    const dialog = tripDialog(page);
    await expect(dialog).toBeVisible();
    await expectNoA11yViolations(page, 'trip dialog (new)');
    await dialog.getByRole('button', { name: t('common.cancel') }).click();
    await expect(dialog).toBeHidden();

    await clickHeaderAction(page, t('backup.import.open'));
    const restore = page.getByRole('dialog', { name: t('backup.import.title') });
    await expect(restore).toBeVisible();
    await expectNoA11yViolations(page, 'backup restore dialog');
  });

  test('trips list with trips', async ({ page, backend, user }) => {
    backend.db.seedTrip(user, TRIPS.rome, [{ name: 'קולוסיאום' }]);
    backend.db.seedTrip(user, TRIPS.lisbon);
    backend.db.seedTrip(user, TRIPS.athens);
    await page.goto('/trips');
    await expect(page.getByText(TRIPS.lisbon.name)).toBeVisible();
    await expectNoA11yViolations(page, 'trips list (3 trips)');
  });

  test('trip page: timetable + bank, and its dialogs', async ({ page, backend, user }) => {
    // Ten full-page axe scans (~2.5 s each on the phone project) do not fit the 30 s default.
    test.slow();
    const trip = backend.db.seedTrip(user, TRIPS.rome, [
      { name: 'שוק קמפו דה פיורי', duration_minutes: 90 },
      { name: 'פנתאון', duration_minutes: 60, color: '#D6F2C9' },
      { name: 'קולוסיאום', duration_minutes: 120, scheduled_date: '2027-03-10', start_minute: 660 },
      { name: 'ארוחת ערב', duration_minutes: 90, scheduled_date: '2027-03-11', start_minute: 1140 },
    ]);
    await page.goto(`/trips/${trip.id}`);
    // Phone: the bank is a collapsed bottom sheet until its handle is tapped (M7.1).
    await openBank(page);
    await expect(bank(page).getByText('פנתאון')).toBeVisible();
    await expect(page.getByText('קולוסיאום').first()).toBeVisible();
    await expectNoA11yViolations(page, 'trip page');

    // Activity dialog (new).
    await bank(page)
      .getByRole('button', { name: t('bank.add') })
      .click();
    const activity = activityDialog(page);
    await expect(activity).toBeVisible();
    await expectNoA11yViolations(page, 'activity dialog (new)');
    // With a validation error shown.
    await activity.getByRole('button', { name: t('bank.dialog.add') }).click();
    await expect(activity.getByText(t('bank.dialog.errors.nameRequired'))).toBeVisible();
    await expectNoA11yViolations(page, 'activity dialog (error)');
    await activity.getByRole('button', { name: t('common.cancel') }).click();
    await expect(activity).toBeHidden();

    // Import dialog: empty, then with a preview containing a valid and an invalid row.
    await bank(page)
      .getByRole('button', { name: t('import.openLabel') })
      .click();
    const importDialog = page.getByRole('dialog', { name: t('import.title') });
    await expect(importDialog).toBeVisible();
    await expectNoA11yViolations(page, 'import dialog (empty)');
    await importDialog.getByLabel(t('import.textLabel')).fill('מוזיאון; 2\nשורה בלי זמן');
    await expect(importDialog.getByText(t('import.invalidRow'))).toBeAttached();
    await expectNoA11yViolations(page, 'import dialog (preview)');
    await importDialog.getByRole('button', { name: t('common.cancel') }).click();
    await expect(importDialog).toBeHidden();

    // Export dialog.
    await clickHeaderAction(page, t('export.open'));
    const exportDialog = page.getByRole('dialog', { name: t('export.title') });
    await expect(exportDialog).toBeVisible();
    await expectNoA11yViolations(page, 'export dialog');
    await page.keyboard.press('Escape');
    await expect(exportDialog).toBeHidden();

    // Trip dialog (edit).
    await clickHeaderAction(page, t('trips.edit'));
    const edit = tripDialog(page, 'edit');
    await expect(edit).toBeVisible();
    await expectNoA11yViolations(page, 'trip dialog (edit)');
    await edit.getByRole('button', { name: t('common.cancel') }).click();
    await expect(edit).toBeHidden();

    // Confirm dialog: delete trip.
    await clickHeaderAction(page, t('common.delete'));
    const confirm = page.getByRole('alertdialog', { name: t('trips.deleteConfirm.title') });
    await expect(confirm).toBeVisible();
    await expectNoA11yViolations(page, 'confirm dialog (delete trip)');
  });

  test('trip page in placing mode (tap-to-place / keyboard, M7.2)', async ({
    page,
    backend,
    user,
  }) => {
    const trip = backend.db.seedTrip(user, TRIPS.rome, [
      { name: 'פנתאון', duration_minutes: 60 },
      { name: 'קולוסיאום', duration_minutes: 120, scheduled_date: '2027-03-10', start_minute: 660 },
    ]);
    await page.goto(`/trips/${trip.id}`);
    await openBank(page);
    const open = bank(page).getByRole('button', { name: /^פנתאון / });
    if (isPhone(page)) {
      await open.tap();
    } else {
      await open.focus();
      await page.keyboard.press('m');
    }
    await expect(page.getByTestId('placing-bar')).toBeVisible();
    // The slot buttons' group (zero-height wrapper; the buttons are positioned inside it).
    await expect(page.getByRole('group', { name: /^שעות התחלה עבור פנתאון/ })).toBeAttached();
    if (isPhone(page)) {
      // PHONE-2: a tapped slot is previewed with nudge / confirm / cancel buttons.
      await page
        .getByRole('button', { name: /^14:00–15:00, / })
        .first()
        .tap();
      await expect(page.getByRole('group', { name: /^תצוגה מקדימה/ })).toBeVisible();
    }
    await expectNoA11yViolations(page, 'trip page (placing)');
  });

  test('confirm dialog: sign out', async ({ page }) => {
    await page.goto('/trips');
    await clickHeaderAction(page, t('auth.signOut.button'));
    const confirm = page.getByRole('alertdialog', { name: t('auth.signOut.title') });
    await expect(confirm).toBeVisible();
    await expectNoA11yViolations(page, 'confirm dialog (sign out)');
  });
});

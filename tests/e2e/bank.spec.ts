// Bank CRUD (M4.4): FR-3.1–FR-3.6.

import { rest } from './fake-backend/server';
import { expect, test, toast } from './support/fixtures';
import { t } from './support/i18n';
import { activityDialog, addActivity, bank, bankBlock, pickColor } from './support/pages';
import { TRIPS } from '../fixtures/testData';

const PINK = '#FFD6E0';
const PEACH = '#FFE3C2';
const MINT = '#D6F2C9';

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test('add: validation, automatic colour progression and a custom colour (FR-3.1, FR-3.2)', async ({
  page,
  backend,
  user,
}) => {
  const trip = backend.db.seedTrip(user, TRIPS.rome);
  await page.goto(`/trips/${trip.id}`);
  await expect(bank(page).getByText(t('bank.empty').split('\n')[0]!)).toBeVisible();

  // An empty name is flagged at the field.
  await bank(page)
    .getByRole('button', { name: t('bank.add') })
    .click();
  const dialog = activityDialog(page);
  await expect(dialog.getByRole('radio', { name: t('common.colors.pink') })).toBeChecked();
  await dialog.getByRole('button', { name: t('bank.dialog.add') }).click();
  await expect(dialog.getByText(t('bank.dialog.errors.nameRequired'))).toBeVisible();
  await expect(dialog.getByLabel(t('bank.dialog.name'))).toBeFocused();
  await dialog.getByRole('button', { name: t('common.cancel') }).click();
  await expect(dialog).toBeHidden();
  expect(backend.requestsTo(rest('POST', 'activities'))).toHaveLength(0);

  await addActivity(page, 'שוק קמפו דה פיורי', { duration: 'שעה וחצי' });
  await bank(page)
    .getByRole('button', { name: t('bank.add') })
    .click();
  await expect(dialog.getByRole('radio', { name: t('common.colors.peach') })).toBeChecked();
  await dialog.getByRole('button', { name: t('common.cancel') }).click();
  await addActivity(page, 'פנתאון');
  await addActivity(page, 'Trastevere ארוחת ערב', { color: t('common.colors.mint') });

  // The cursor advanced for the custom colour too: the next default is the 4th colour.
  await bank(page)
    .getByRole('button', { name: t('bank.add') })
    .click();
  await expect(dialog.getByRole('radio', { name: t('common.colors.mint') })).toBeChecked();
  await dialog.getByRole('button', { name: t('common.cancel') }).click();

  const items = bank(page).getByRole('listitem');
  await expect(items).toHaveCount(3);
  await expect(bank(page).getByRole('heading')).toContainText('(3)');
  await expect(items.nth(0)).toContainText('שוק קמפו דה פיורי');
  await expect(items.nth(0)).toContainText('שעה וחצי');
  await expect(items.nth(1)).toContainText('שעה');
  await expect(items.nth(0).getByTitle('שוק קמפו דה פיורי')).toHaveAttribute(
    'style',
    new RegExp(`--block-color: ${PINK}`, 'i'),
  );
  await expect(items.nth(1).getByTitle('פנתאון')).toHaveAttribute(
    'style',
    new RegExp(`--block-color: ${PEACH}`, 'i'),
  );
  await expect(items.nth(2).getByTitle('Trastevere ארוחת ערב')).toHaveAttribute(
    'style',
    new RegExp(`--block-color: ${MINT}`, 'i'),
  );
  // FR-3.3: the 90-minute block is taller than the 60-minute one.
  const tall = await items.nth(0).getByTitle('שוק קמפו דה פיורי').boundingBox();
  const short = await items.nth(1).getByTitle('פנתאון').boundingBox();
  expect(tall!.height).toBeGreaterThan(short!.height);

  // Default colour → omitted (DB assigns it); custom colour → sent.
  const posts = backend.requestsTo(rest('POST', 'activities')).map((r) => r.body);
  expect(posts[0]).not.toHaveProperty('color');
  expect(posts[2]).toMatchObject({ color: MINT, duration_minutes: 60 });
});

test('edit: the dialog is prefilled and saves name, duration and colour (FR-3.5)', async ({
  page,
  backend,
  user,
}) => {
  const trip = backend.db.seedTrip(user, TRIPS.rome, [{ name: 'מוזיאון', duration_minutes: 60 }]);
  await page.goto(`/trips/${trip.id}`);
  await bankBlock(page, 'מוזיאון')
    .getByRole('button', { name: /מוזיאון/ })
    .first()
    .click();

  const dialog = activityDialog(page, 'edit');
  await expect(dialog.getByLabel(t('bank.dialog.name'))).toHaveValue('מוזיאון');
  await expect(dialog.getByRole('radio', { name: t('common.colors.pink') })).toBeChecked();
  await dialog.getByLabel(t('bank.dialog.name')).fill('מוזיאוני הוותיקן');
  await dialog.getByLabel(t('bank.dialog.duration')).selectOption({ label: 'שעתיים' });
  await pickColor(dialog, t('common.colors.sky'));
  await dialog.getByRole('button', { name: t('common.save') }).click();

  await expect(dialog).toBeHidden();
  const block = bankBlock(page, 'מוזיאוני הוותיקן');
  await expect(block).toContainText('שעתיים');
  await expect(block.getByTitle('מוזיאוני הוותיקן')).toHaveAttribute('style', /#CDE5FF/i);
  await expect(page.getByText(t('bank.returnedToBank'))).toHaveCount(0);
  const rpc = backend.requestsTo(rest('POST', 'rpc/update_activity'));
  expect(rpc[0]!.body).toMatchObject({
    name: 'מוזיאוני הוותיקן',
    duration_minutes: 120,
    color: '#CDE5FF',
  });
});

test('edit: "returned to bank" from the server is announced (FR-3.6)', async ({
  page,
  backend,
  user,
}) => {
  const trip = backend.db.seedTrip(user, TRIPS.rome, [{ name: 'שייט בטיבר' }]);
  backend.db.forceReturnedToBank = true;
  await page.goto(`/trips/${trip.id}`);
  await bankBlock(page, 'שייט בטיבר')
    .getByRole('button', { name: /שייט בטיבר/ })
    .first()
    .click();
  const dialog = activityDialog(page, 'edit');
  await dialog.getByLabel(t('bank.dialog.duration')).selectOption({ label: '3 שעות' });
  await dialog.getByRole('button', { name: t('common.save') }).click();
  await expect(dialog).toBeHidden();
  await expect(toast(page, t('bank.returnedToBank'))).toBeVisible();
  await expect(bankBlock(page, 'שייט בטיבר')).toContainText('3 שעות');
});

test('delete asks first and moves focus to the next block, else the previous (FR-3.4)', async ({
  page,
  backend,
  user,
}) => {
  const trip = backend.db.seedTrip(user, TRIPS.rome, [
    { name: 'אחת' },
    { name: 'שתיים' },
    { name: 'שלוש' },
  ]);
  await page.goto(`/trips/${trip.id}`);
  const confirm = page.getByRole('alertdialog', { name: t('bank.deleteConfirm.title') });
  const deleteOf = (name: string) =>
    bank(page).getByRole('button', { name: t('common.activityBlock.delete', { name }) });
  const openOf = (name: string) => bankBlock(page, name).getByRole('button').first();

  // Cancel and Esc keep the block.
  await deleteOf('שתיים').click();
  await expect(confirm).toContainText(t('bank.deleteConfirm.message', { name: 'שתיים' }));
  await expect(confirm.getByRole('button', { name: t('common.cancel') })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await deleteOf('שתיים').click();
  await confirm.getByRole('button', { name: t('common.cancel') }).click();
  await expect(bank(page).getByRole('listitem')).toHaveCount(3);
  expect(backend.requestsTo(rest('DELETE', 'activities'))).toHaveLength(0);

  // Middle block: focus moves to the next one.
  await deleteOf('שתיים').click();
  await confirm.getByRole('button', { name: t('common.confirmDelete') }).click();
  await expect(bankBlock(page, 'שתיים')).toHaveCount(0);
  await expect(openOf('שלוש')).toBeFocused();

  // Last block: focus moves to the previous one.
  await deleteOf('שלוש').click();
  await confirm.getByRole('button', { name: t('common.confirmDelete') }).click();
  await expect(bankBlock(page, 'שלוש')).toHaveCount(0);
  await expect(openOf('אחת')).toBeFocused();

  // Only block: focus moves to the bank heading.
  await deleteOf('אחת').click();
  await confirm.getByRole('button', { name: t('common.confirmDelete') }).click();
  await expect(bank(page).getByRole('listitem')).toHaveCount(0);
  await expect(bank(page).getByRole('heading', { name: t('bank.title') })).toBeFocused();
  expect(backend.db.activities).toHaveLength(0);
});

test('layout: bank beside the timetable on desktop, above it on phones (2 blocks per row)', async ({
  page,
  backend,
  user,
}, testInfo) => {
  const trip = backend.db.seedTrip(user, TRIPS.rome, [{ name: 'א' }, { name: 'ב' }]);
  await page.goto(`/trips/${trip.id}`);
  const bankBox = (await bank(page).boundingBox())!;
  const timetable = page.getByRole('region', { name: t('planner.timetable') });
  const timetableBox = (await timetable.boundingBox())!;
  const first = (await bankBlock(page, 'א').boundingBox())!;
  const second = (await bankBlock(page, 'ב').boundingBox())!;

  if (testInfo.project.name === 'phone') {
    expect(bankBox.y + bankBox.height).toBeLessThanOrEqual(timetableBox.y);
    expect(Math.abs(first.y - second.y)).toBeLessThan(1); // same row
    expect(second.x).toBeLessThan(first.x); // RTL: the second block is to the left
  } else {
    // RTL: the side panel is on the right of the timetable, side by side.
    expect(bankBox.x).toBeGreaterThanOrEqual(timetableBox.x + timetableBox.width);
    expect(second.y).toBeGreaterThan(first.y); // one block per row
  }
});

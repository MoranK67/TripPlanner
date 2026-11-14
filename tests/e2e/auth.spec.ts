// FR-1.1, FR-1.2, FR-1.4 and §9.4 "Session expired": sign-in, route guard, sign-out.

import { auth, rest } from './fake-backend/server';
import { expect, header, test } from './support/fixtures';
import { t } from './support/i18n';
import { login } from './support/pages';
import { TEST_PASSWORD, TEST_USER_EMAIL, TRIPS } from '../fixtures/testData';

test.describe('sign-in', () => {
  test('valid credentials open the trips list', async ({ page, user }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: t('auth.login.title') })).toBeVisible();
    await login(page, user.email, TEST_PASSWORD);
    await expect(page).toHaveURL(/\/trips$/);
    await expect(page.getByRole('heading', { name: t('trips.title') })).toBeVisible();
    await expect(
      header(page).getByRole('button', { name: t('auth.signOut.button') }),
    ).toBeVisible();
  });

  test('wrong password shows a Hebrew error and stays on the login page', async ({
    page,
    backend,
    user,
  }) => {
    await page.goto('/login');
    await login(page, user.email, 'not-the-password');
    await expect(page.getByRole('alert')).toHaveText(t('errors.kinds.invalid_credentials'));
    await expect(page).toHaveURL(/\/login$/);
    expect(backend.requestsTo(auth('token'))).toHaveLength(1);
  });

  test('empty fields are flagged without calling the server', async ({ page, backend, user }) => {
    void user;
    await page.goto('/login');
    await page.getByRole('button', { name: t('auth.login.submit'), exact: true }).click();
    await expect(page.getByText(t('auth.login.emailRequired'))).toBeVisible();
    await expect(page.getByLabel(t('auth.login.email'))).toBeFocused();
    await page.getByLabel(t('auth.login.email')).fill(TEST_USER_EMAIL);
    await page.getByRole('button', { name: t('auth.login.submit'), exact: true }).click();
    await expect(page.getByText(t('auth.login.passwordRequired'))).toBeVisible();
    await expect(page.getByLabel(t('auth.login.password'))).toBeFocused();
    expect(backend.requestsTo(auth('token'))).toHaveLength(0);
  });

  test('the session survives a reload (FR-1.2)', async ({ page, signIn }) => {
    await signIn();
    await page.goto('/trips');
    await expect(page.getByRole('heading', { name: t('trips.title') })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: t('trips.title') })).toBeVisible();
    await expect(page).toHaveURL(/\/trips$/);
  });
});

test.describe('route guard', () => {
  test('a signed-out deep link goes to login and returns there afterwards', async ({
    page,
    backend,
    user,
  }) => {
    const trip = backend.db.seedTrip(user, TRIPS.rome);
    await page.goto(`/trips/${trip.id}`);
    await expect(page).toHaveURL(/\/login$/);
    await login(page, user.email, TEST_PASSWORD);
    await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}$`));
    await expect(page.getByRole('heading', { name: TRIPS.rome.name })).toBeAttached();
  });

  test('an expired session sends the user to login with a notice, then back to the trip', async ({
    page,
    backend,
    user,
    signIn,
  }) => {
    const trip = backend.db.seedTrip(user, TRIPS.rome);
    await signIn();
    await page.goto('/trips');
    await expect(page.getByRole('link', { name: new RegExp(TRIPS.rome.name) })).toBeVisible();

    // The server stops accepting the token (PostgREST answers 401 PGRST303 "JWT expired").
    backend.revokeAllSessions();
    backend.fail(rest('GET', 'trips'), {
      kind: 'http',
      status: 401,
      body: { code: 'PGRST303', message: 'JWT expired', details: null, hint: null },
    });
    await page.getByRole('link', { name: new RegExp(TRIPS.rome.name) }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('alert')).toHaveText(t('errors.kinds.auth_expired'));
    backend.clearFaults();
    await login(page, user.email, TEST_PASSWORD);
    await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}$`));
  });
});

test.describe('sign-out (FR-1.4)', () => {
  test('asks first; Cancel keeps the session, confirming signs out', async ({
    page,
    backend,
    signIn,
  }) => {
    await signIn();
    await page.goto('/trips');
    const signOut = header(page).getByRole('button', { name: t('auth.signOut.button') });

    await signOut.click();
    const dialog = page.getByRole('alertdialog', { name: t('auth.signOut.title') });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: t('common.cancel') })).toBeFocused();
    await dialog.getByRole('button', { name: t('common.cancel') }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/trips$/);

    await signOut.click();
    await dialog.getByRole('button', { name: t('auth.signOut.confirm') }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(backend.requestsTo(auth('logout'))).toHaveLength(1);

    // Signed out for good: a reload stays on the login page.
    await page.goto('/trips');
    await expect(page).toHaveURL(/\/login$/);
  });
});

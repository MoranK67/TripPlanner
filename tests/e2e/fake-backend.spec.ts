// Fidelity checks for the fake Supabase backend itself (DEC-028): where the specs rely on a
// server rule, the fake must behave like supabase/migrations and PostgREST, or the E2E suite
// would prove the app against the wrong contract.

import { test as plain, type Page } from '@playwright/test';
import { FakeDb, type ActivityRow } from './fake-backend/db';
import { FAKE_PUBLISHABLE_KEY, FAKE_SUPABASE_URL } from './fake-backend/server';
import { expect, test } from './support/fixtures';
import { TEST_PASSWORD, TEST_USER_EMAIL, TRIPS } from '../fixtures/testData';

plain.describe('update_activity (20261112140500_m1_update_activity.sql, DEC-022)', () => {
  function setup() {
    const db = new FakeDb();
    const user = db.addUser(TEST_USER_EMAIL, TEST_PASSWORD);
    // Rome: 10–13 Mar 2027, 10:00–20:00.
    const trip = db.seedTrip(user, TRIPS.rome, [
      { name: 'morning', scheduled_date: '2027-03-11', start_minute: 600, duration_minutes: 60 },
      { name: 'noon', scheduled_date: '2027-03-11', start_minute: 720, duration_minutes: 60 },
      { name: 'evening', scheduled_date: '2027-03-13', start_minute: 1080, duration_minutes: 60 },
    ]);
    const byName = (name: string) => db.activities.find((a) => a.name === name)!;
    const update = (a: ActivityRow, args: Record<string, unknown>) =>
      db.rpc(user.id, 'update_activity', { activity_id: a.id, ...args }) as {
        activity: ActivityRow;
        returned_to_bank: boolean;
      };
    return { db, trip, byName, update };
  }

  plain('a longer duration that still fits stays placed', () => {
    const { byName, update } = setup();
    const result = update(byName('morning'), { duration_minutes: 120 });
    expect(result.returned_to_bank).toBe(false);
    expect(result.activity).toMatchObject({ scheduled_date: '2027-03-11', start_minute: 600 });
  });

  plain('a duration that overlaps the next block returns it to the end of the bank', () => {
    const { byName, update } = setup();
    const result = update(byName('morning'), { duration_minutes: 180 });
    expect(result.returned_to_bank).toBe(true);
    expect(result.activity).toMatchObject({
      scheduled_date: null,
      start_minute: null,
      duration_minutes: 180,
      bank_position: 4,
    });
  });

  plain('a duration past the end of the trip returns it to the bank', () => {
    const { byName, update } = setup();
    expect(update(byName('evening'), { duration_minutes: 180 }).returned_to_bank).toBe(true);
  });

  plain('rename / recolour never moves a placed block, even one that no longer fits', () => {
    const { trip, byName, update } = setup();
    // The window shrank without the trigger running (e.g. legacy data): the block sticks out.
    trip.end_minute = 1110;
    const result = update(byName('evening'), { name: 'late dinner', color: '#CDE5FF' });
    expect(result.returned_to_bank).toBe(false);
    expect(result.activity).toMatchObject({
      name: 'late dinner',
      color: '#CDE5FF',
      scheduled_date: '2027-03-13',
      start_minute: 1080,
    });
    // Sending the unchanged duration is not a change either.
    expect(update(byName('late dinner'), { duration_minutes: 60 }).returned_to_bank).toBe(false);
  });
});

test.describe('PostgREST auth', () => {
  /** Calls the fake PostgREST from the page (so the fixture's routes answer) with a bearer token. */
  async function getTrips(page: Page, token: string) {
    return page.evaluate(
      async ({ url, key, token }) => {
        const response = await fetch(`${url}/rest/v1/trips?select=*`, {
          headers: { apikey: key, Authorization: `Bearer ${token}` },
        });
        return { status: response.status, body: (await response.json()) as unknown };
      },
      { url: FAKE_SUPABASE_URL, key: FAKE_PUBLISHABLE_KEY, token },
    );
  }

  test('anonymous (publishable key) sees no rows; a live session sees its trips', async ({
    page,
    backend,
    user,
  }) => {
    backend.db.seedTrip(user, TRIPS.rome);
    await page.goto('/login');
    expect(await getTrips(page, FAKE_PUBLISHABLE_KEY)).toEqual({ status: 200, body: [] });
    const { access_token } = backend.issueSession(user);
    const live = await getTrips(page, access_token);
    expect(live.status).toBe(200);
    expect(live.body).toHaveLength(1);
  });

  test('a revoked (expired) session token gets 401 PGRST303; garbage gets 401 PGRST301', async ({
    page,
    backend,
    user,
  }) => {
    await page.goto('/login');
    const { access_token } = backend.issueSession(user);
    backend.revokeAllSessions();
    expect(await getTrips(page, access_token)).toEqual({
      status: 401,
      body: { code: 'PGRST303', message: 'JWT expired', details: null, hint: null },
    });
    const garbage = await getTrips(page, 'not-a-jwt');
    expect(garbage.status).toBe(401);
    expect(garbage.body).toMatchObject({ code: 'PGRST301' });
  });
});

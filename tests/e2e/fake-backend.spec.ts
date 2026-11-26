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

plain.describe(
  'import_activities with placement (20261126120000_feat3_import_placement.sql)',
  () => {
    plain('places in input order and banks the rest with the reason, never raising', () => {
      const db = new FakeDb();
      const user = db.addUser(TEST_USER_EMAIL, TEST_PASSWORD);
      // Rome: 10–13 Mar 2027, 10:00–20:00. "old" sits on 11 Mar 12:00–13:00.
      const trip = db.seedTrip(user, TRIPS.rome, [
        { name: 'old', scheduled_date: '2027-03-11', start_minute: 720, duration_minutes: 60 },
      ]);
      const old = db.activities[0]!;
      const item = (name: string, extra: Record<string, unknown> = {}) => ({
        name,
        duration_minutes: 60,
        ...extra,
      });
      const rows = db.rpc(user.id, 'import_activities', {
        trip_id: trip.id,
        items: [
          item('a', { scheduled_date: '2027-03-11', start_minute: 600 }),
          item('b', { scheduled_date: '2027-03-11' }),
          item('c', { scheduled_date: '2027-03-11', start_minute: 615 }),
          item('d', { scheduled_date: '2027-03-20', start_minute: 600 }),
          item('e', { scheduled_date: '2027-03-10', start_minute: 540 }),
          item('f', { scheduled_date: '2027-03-11', start_minute: 690 }),
          item('g', { scheduled_date: '2027-03-11', start_minute: 630 }),
          item('h', { scheduled_date: '2027-03-11', start_minute: 660 }),
          item('i'),
        ],
      }) as (ActivityRow & Record<string, unknown>)[];
      const outcome = (r: (typeof rows)[number]) => [
        r.name,
        r.item_index,
        r.placed,
        r.bank_reason,
        r.conflict_activity_id,
        r.conflict_item,
      ];
      expect(rows.map(outcome)).toEqual([
        ['a', 1, true, null, null, null],
        ['b', 2, false, 'placement_incomplete', null, null],
        ['c', 3, false, 'placement_invalid', null, null],
        ['d', 4, false, 'day_out_of_trip', null, null],
        ['e', 5, false, 'outside_trip_hours', null, null],
        ['f', 6, false, 'overlaps_existing', old.id, null],
        ['g', 7, false, 'overlaps_import_row', rows[0]!.id, 1],
        // Back to back with "a" and with "old": no overlap.
        ['h', 8, true, null, null, null],
        ['i', 9, false, null, null, null],
      ]);
      expect(rows[0]).toMatchObject({ scheduled_date: '2027-03-11', start_minute: 600 });
      expect(rows[1]).toMatchObject({ scheduled_date: null, start_minute: null });
    });
  },
);

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

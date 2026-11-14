// Test data for the E2E suite. Everything here is fictional and only ever sent to the in-memory
// fake backend (tests/e2e/fake-backend) — never to a real Supabase project.

/** The fake backend's only user. Not a real account; the password exists only in the fake. */
export const TEST_USER_EMAIL = 'traveler@example.test';
export const TEST_PASSWORD = 'mock-only-password';

/** "Today" for every test: Wednesday 10 March 2027, 09:00 Israel time (before DST). */
export const TODAY = new Date('2027-03-10T09:00:00+02:00');

/** Trips seeded by several specs (dates relative to TODAY). */
export const TRIPS = {
  rome: { name: 'רומא 2027', start_date: '2027-03-10', end_date: '2027-03-13' },
  lisbon: { name: 'ליסבון', start_date: '2027-04-02', end_date: '2027-04-05' },
  athens: { name: 'Athens אתונה', start_date: '2027-01-15', end_date: '2027-01-16' },
} as const;

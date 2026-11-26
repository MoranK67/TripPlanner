import type { MockInstance } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { Providers } from './Providers';
import { routes } from './router';

const fake = vi.hoisted(() => ({ signedIn: true }));

// Never hit the real server from unit tests.
vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    checkServerConnection: vi.fn(async () => false),
    authRepo: {
      onAuthChange: (listener: (event: string, session: unknown) => void) => {
        queueMicrotask(() =>
          listener(
            'initial_session',
            fake.signedIn ? { user: { id: 'u1', email: 'a@b.c' }, expiresAt: null } : null,
          ),
        );
        return () => {};
      },
      signOut: vi.fn(async () => {}),
      getStoredUser: () => null,
      resumeSession: vi.fn(async () => ({ status: 'signed_out' })),
    },
    tripsRepo: { list: vi.fn(async () => []) },
  };
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
  return router;
}

/** Lazy route chunks are imported cold in jsdom; give them more than the 1 s default. */
const LAZY = { timeout: 5000 };

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  fake.signedIn = true;
  warn = vi.spyOn(console, 'warn');
});

afterEach(() => {
  // React Router logs deprecations / missing HydrateFallback through console.warn.
  const routerWarnings = warn.mock.calls.filter((args) =>
    args.some((a) => typeof a === 'string' && /react router|hydratefallback|future/i.test(a)),
  );
  expect(routerWarnings).toEqual([]);
  warn.mockRestore();
});

describe('app shell routing', () => {
  it('redirects / to the trips page when signed in', async () => {
    const router = renderAt('/');
    expect(await screen.findByRole('heading', { name: 'הטיולים שלי' }, LAZY)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/trips');
  });

  it('shows the app title in Hebrew', async () => {
    renderAt('/trips');
    expect(await screen.findByRole('heading', { name: 'TripPlanner' })).toBeInTheDocument();
  });

  it('sends a signed-out user from a guarded page to the login page', async () => {
    fake.signedIn = false;
    const router = renderAt('/trips');
    expect(await screen.findByRole('heading', { name: 'התחברות' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('serves the password reset pages without a session', async () => {
    fake.signedIn = false;
    renderAt('/forgot-password');
    expect(await screen.findByRole('heading', { name: 'איפוס סיסמה' })).toBeInTheDocument();
  });

  it('has no sign-up route (FR-1.3)', async () => {
    fake.signedIn = false;
    renderAt('/signup');
    expect(await screen.findByRole('heading', { name: 'הדף לא נמצא' })).toBeInTheDocument();
  });

  it('shows a not-found page for unknown routes', async () => {
    renderAt('/nope');
    expect(await screen.findByRole('heading', { name: 'הדף לא נמצא' })).toBeInTheDocument();
  });

  it('shows a loading state while a lazy page loads on first visit', async () => {
    renderAt('/dev/ui');
    expect(await screen.findByText('טוען…')).toBeInTheDocument();
  });

  it('serves the UI gallery at /dev/ui in development', async () => {
    renderAt('/dev/ui');
    expect(
      await screen.findByRole('heading', { name: 'גלריית רכיבי ממשק' }, LAZY),
    ).toBeInTheDocument();
  });

  it('sets the document direction to RTL', () => {
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('he');
  });
});

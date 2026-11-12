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

beforeEach(() => {
  fake.signedIn = true;
});

describe('app shell routing', () => {
  it('redirects / to the trips page when signed in', async () => {
    const router = renderAt('/');
    expect(await screen.findByRole('heading', { name: 'הטיולים שלי' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/trips');
  });

  it('shows the app title in Hebrew', async () => {
    renderAt('/trips');
    expect(await screen.findByRole('heading', { name: 'מתכנן הטיולים' })).toBeInTheDocument();
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

  it('serves the UI gallery at /dev/ui in development', async () => {
    renderAt('/dev/ui');
    expect(await screen.findByRole('heading', { name: 'גלריית רכיבי ממשק' })).toBeInTheDocument();
  });

  it('sets the document direction to RTL', () => {
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('he');
  });
});

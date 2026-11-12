import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { Providers } from './Providers';
import { routes } from './router';

// Never hit the real server from unit tests.
vi.mock('@/data', () => ({
  isSupabaseConfigured: () => false,
  checkServerConnection: vi.fn(async () => false),
}));

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
}

describe('app shell routing', () => {
  it('redirects / to the trips page', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'הטיולים שלי' })).toBeInTheDocument();
  });

  it('shows the app title in Hebrew', async () => {
    renderAt('/trips');
    expect(await screen.findByRole('heading', { name: 'מתכנן הטיולים' })).toBeInTheDocument();
  });

  it('renders the login placeholder', async () => {
    renderAt('/login');
    expect(await screen.findByRole('heading', { name: 'התחברות' })).toBeInTheDocument();
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

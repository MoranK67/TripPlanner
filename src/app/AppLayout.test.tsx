import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { Button, HeaderActions } from '@/components/ui';
import { AppLayout, MAIN_CONTENT_ID } from './AppLayout';
import { Providers } from './Providers';

vi.mock('@/data', () => ({
  isSupabaseConfigured: () => false,
  checkServerConnection: vi.fn(async () => false),
}));

function renderLayout(page: React.ReactNode) {
  const router = createMemoryRouter(
    [{ element: <AppLayout />, children: [{ path: '/', element: page }] }],
    { initialEntries: ['/'] },
  );
  render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
}

describe('AppLayout', () => {
  it('has a header bar with the app title linking to the trips list', () => {
    renderLayout(<p>תוכן</p>);
    const banner = screen.getByRole('banner');
    const title = within(banner).getByRole('heading', { level: 1, name: 'מתכנן הטיולים' });
    expect(title.closest('a')).toHaveAttribute('href', '/trips');
  });

  it('renders the page inside the main landmark', () => {
    renderLayout(<p>תוכן הדף</p>);
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', MAIN_CONTENT_ID);
    expect(within(main).getByText('תוכן הדף')).toBeInTheDocument();
  });

  it('offers a skip link to the main content', () => {
    renderLayout(<p>תוכן</p>);
    expect(screen.getByRole('link', { name: 'דילוג לתוכן הראשי' })).toHaveAttribute(
      'href',
      `#${MAIN_CONTENT_ID}`,
    );
  });

  it('renders page controls from <HeaderActions> into the header', async () => {
    renderLayout(
      <>
        <p>תוכן</p>
        <HeaderActions>
          <Button>טיול חדש</Button>
        </HeaderActions>
      </>,
    );
    const banner = screen.getByRole('banner');
    expect(await within(banner).findByRole('button', { name: 'טיול חדש' })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps the header slot empty (and hidden) without page controls', () => {
    renderLayout(<p>תוכן</p>);
    const slot = screen.getByTestId('header-slot');
    expect(slot).toBeEmptyDOMElement();
    expect(slot.className).toContain('empty:hidden');
  });
});

describe('HeaderActions', () => {
  it('renders nothing outside the app layout', () => {
    render(
      <HeaderActions>
        <Button>טיול חדש</Button>
      </HeaderActions>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

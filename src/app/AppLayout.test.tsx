import { act, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { Button, HeaderActions } from '@/components/ui';
import { AppLayout, MAIN_CONTENT_ID } from './AppLayout';
import { Providers } from './Providers';

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    checkServerConnection: vi.fn(async () => false),
    authRepo: {
      onAuthChange: (listener: (event: string, session: unknown) => void) => {
        queueMicrotask(() =>
          listener('initial_session', { user: { id: 'u1', email: 'a@b.c' }, expiresAt: null }),
        );
        return () => {};
      },
      signOut: vi.fn(async () => {}),
    },
  };
});

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

describe('AppLayout sign-out', () => {
  it('offers sign-out in the header while signed in (FR-1.4)', async () => {
    renderLayout(<p>תוכן</p>);
    const banner = screen.getByRole('banner');
    expect(await within(banner).findByRole('button', { name: 'יציאה' })).toBeInTheDocument();
  });
});

describe('AppLayout offline banner (M7.3, FR-8.3)', () => {
  const OFFLINE_TEXT =
    'אין חיבור לאינטרנט. אפשר לצפות בטיולים שנשמרו, אבל עריכה תחזור כשהחיבור יחזור.';

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('shows no banner online', () => {
    renderLayout(<p>תוכן</p>);
    expect(screen.queryByText(OFFLINE_TEXT)).not.toBeInTheDocument();
  });

  it('shows a polite status banner while offline and hides it on reconnect', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderLayout(<p>תוכן</p>);
    const banner = screen.getByText(OFFLINE_TEXT);
    expect(banner.closest('[role="status"]')).not.toBeNull();
    // Outside the header and the main region: visible on every page.
    expect(within(screen.getByRole('banner')).queryByText(OFFLINE_TEXT)).not.toBeInTheDocument();
    expect(within(screen.getByRole('main')).queryByText(OFFLINE_TEXT)).not.toBeInTheDocument();
    // The header chip agrees with the banner.
    expect(within(screen.getByRole('banner')).getByText('אין חיבור לאינטרנט')).toBeInTheDocument();

    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText(OFFLINE_TEXT)).not.toBeInTheDocument();
  });

  it('announces the banner when the connection drops', () => {
    renderLayout(<p>תוכן</p>);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText(OFFLINE_TEXT).closest('[role="status"]')).not.toBeNull();
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

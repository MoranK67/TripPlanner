import { useMutation } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { useState } from 'react';
import { Button, HeaderAction, HeaderActions, Modal } from '@/components/ui';
import type { SessionResumeResult } from '@/data';
import { AppLayout, MAIN_CONTENT_ID } from './AppLayout';
import { Providers } from './Providers';

const layoutAuth = vi.hoisted(() => ({
  session: { user: { id: 'u1', email: 'a@b.c' }, expiresAt: null } as unknown,
  storedUser: null as { id: string; email: string | null } | null,
}));

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    checkServerConnection: vi.fn(async () => false),
    authRepo: {
      onAuthChange: (listener: (event: string, session: unknown) => void) => {
        queueMicrotask(() => listener('initial_session', layoutAuth.session));
        return () => {};
      },
      signOut: vi.fn(async () => {}),
      getStoredUser: () => layoutAuth.storedUser,
      // Renewal never gets through in these tests (auth server unreachable).
      resumeSession: vi.fn(async (): Promise<SessionResumeResult> =>
        layoutAuth.storedUser
          ? {
              status: 'unreachable',
              user: layoutAuth.storedUser,
              error: new actual.AppError('network', { retryable: true }),
            }
          : { status: 'signed_out' },
      ),
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

describe('AppLayout on phones (PHONE-1)', () => {
  // A resizable viewport: starts at phone width (< 601 px); `resize` fires the media listeners.
  let width = 390;
  const mediaListeners = new Set<() => void>();
  function resize(next: number) {
    width = next;
    act(() => mediaListeners.forEach((l) => l()));
  }
  beforeEach(() => {
    width = 390;
    mediaListeners.clear();
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => {
        const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
        return {
          get matches() {
            return width >= min;
          },
          media: query,
          addEventListener: (_: string, l: () => void) => mediaListeners.add(l),
          removeEventListener: (_: string, l: () => void) => mediaListeners.delete(l),
        };
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function TripLikePage({ onEdit }: { onEdit: () => void }) {
    return (
      <HeaderActions>
        <select aria-label="מעבר לטיול" data-header-primary="">
          <option>רומא</option>
        </select>
        <HeaderAction label="עריכה" order={10} onSelect={onEdit} />
        <HeaderAction label="+ טיול חדש" order={40} variant="primary" onSelect={() => {}} />
      </HeaderActions>
    );
  }

  it('one slim row: page control, status dot and a "⋯" menu with the page actions and sign-out', async () => {
    const onEdit = vi.fn();
    renderLayout(<TripLikePage onEdit={onEdit} />);
    const banner = screen.getByRole('banner');
    expect(await within(banner).findByLabelText('מעבר לטיול')).toBeInTheDocument();
    // The actions are not buttons in the header any more…
    expect(within(banner).queryByRole('button', { name: 'עריכה' })).not.toBeInTheDocument();
    expect(within(banner).queryByRole('button', { name: 'יציאה' })).not.toBeInTheDocument();
    // …but items of the menu, sign-out last.
    const more = within(banner).getByRole('button', { name: 'פעולות נוספות' });
    fireEvent.click(more);
    const menu = within(banner).getByRole('menu', { name: 'פעולות נוספות' });
    await waitFor(() =>
      expect(
        within(menu)
          .getAllByRole('menuitem')
          .map((el) => el.textContent),
      ).toEqual(['עריכה', '+ טיול חדש', 'יציאה']),
    );
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'עריכה' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(more).toHaveFocus();
  });

  it('rotating across the breakpoint keeps an open dialog and what was typed in it', async () => {
    /** Like the trip header: a header action that opens a dialog owned by the page controls. */
    function EditablePage() {
      const [open, setOpen] = useState(false);
      return (
        <HeaderActions>
          <select aria-label="מעבר לטיול" data-header-primary="">
            <option>רומא</option>
          </select>
          <HeaderAction label="עריכה" order={10} onSelect={() => setOpen(true)} />
          <Modal open={open} onClose={() => setOpen(false)} title="עריכת טיול">
            <input aria-label="שם הטיול" defaultValue="רומא" />
          </Modal>
        </HeaderActions>
      );
    }
    renderLayout(<EditablePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'פעולות נוספות' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'עריכה' }));
    const name = screen.getByLabelText('שם הטיול');
    fireEvent.change(name, { target: { value: 'רומא והוותיקן' } });

    resize(800); // phone -> tablet (landscape)
    expect(screen.getByRole('dialog', { name: 'עריכת טיול' })).toBeInTheDocument();
    expect(screen.getByLabelText('שם הטיול')).toBe(name);
    expect(name).toHaveValue('רומא והוותיקן');
    // The header is the tablet one now: the action is a button again, no "⋯" menu.
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('button', { name: 'עריכה' })).toBeInTheDocument();
    expect(within(banner).queryByRole('button', { name: 'פעולות נוספות' })).not.toBeInTheDocument();

    resize(390); // and back
    expect(screen.getByLabelText('שם הטיול')).toHaveValue('רומא והוותיקן');
  });

  it('sign-out from the menu still asks first', async () => {
    renderLayout(<p>תוכן</p>);
    // The menu appears once the session is known (sign-out is its only item here).
    fireEvent.click(await screen.findByRole('button', { name: 'פעולות נוספות' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'יציאה' }));
    expect(screen.getByRole('alertdialog', { name: 'יציאה מהחשבון' })).toBeInTheDocument();
  });

  it('keeps the title (as a home link) and shows the server status as a labelled dot', () => {
    renderLayout(<p>תוכן</p>);
    const banner = screen.getByRole('banner');
    const title = within(banner).getByRole('heading', { level: 1, name: 'מתכנן הטיולים' });
    expect(title.closest('a')).toHaveAttribute('href', '/trips');
    // Supabase is not configured in these tests: the dot says so for screen readers.
    const status = within(banner).getByRole('status');
    expect(status).toHaveTextContent('השרת לא מוגדר');
    expect(status).toHaveAttribute('title', expect.stringContaining('השרת לא מוגדר'));
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

  it('while a stored session is being renewed: says "reconnecting" online, offline text offline', async () => {
    layoutAuth.session = null;
    layoutAuth.storedUser = { id: 'u1', email: 'a@b.c' };
    try {
      const RECONNECTING =
        'מחדש את החיבור לחשבון… בינתיים אפשר לצפות בטיולים שנשמרו, ועריכה תחזור כשהחיבור יתחדש.';
      renderLayout(<p>תוכן</p>);
      const banner = await screen.findByText(RECONNECTING);
      expect(banner.closest('[role="status"]')).not.toBeNull();
      // Signing out stays possible.
      expect(
        within(screen.getByRole('banner')).getByRole('button', { name: 'יציאה' }),
      ).toBeInTheDocument();

      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      act(() => {
        window.dispatchEvent(new Event('offline'));
      });
      expect(screen.getByText(OFFLINE_TEXT)).toBeInTheDocument();
      expect(screen.queryByText(RECONNECTING)).not.toBeInTheDocument();
    } finally {
      layoutAuth.session = { user: { id: 'u1', email: 'a@b.c' }, expiresAt: null };
      layoutAuth.storedUser = null;
    }
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

describe('AppLayout unsaved writes (UX-4)', () => {
  /** A page whose button starts a trip write that never finishes. */
  function SavingPage() {
    const save = useMutation({
      mutationKey: ['trips', 'create'],
      mutationFn: () => new Promise<never>(() => {}),
    });
    return <Button onClick={() => save.mutate()}>שמירה</Button>;
  }

  function unloadIsBlocked() {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it('asks before leaving the page while a write is pending', async () => {
    renderLayout(<SavingPage />);
    expect(unloadIsBlocked()).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: 'שמירה' }));
    await waitFor(() => expect(unloadIsBlocked()).toBe(true));
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

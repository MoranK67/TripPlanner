import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { ToastProvider, useCanEdit } from '@/components/ui';
import {
  AppError,
  type AuthChangeListener,
  type AuthEvent,
  type AuthSession,
  type SessionResumeResult,
  type StoredAuthUser,
} from '@/data';
import { AuthProvider } from './AuthProvider';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { LoginPage } from './LoginPage';
import { RequireAuth } from './RequireAuth';
import { ResetPasswordPage } from './ResetPasswordPage';
import { SignOutButton } from './SignOutButton';

const fake = vi.hoisted(() => ({
  configured: true,
  listeners: [] as Array<(event: string, session: unknown) => void>,
  signIn: vi.fn(),
  signOut: vi.fn(),
  requestPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
  storedUser: null as StoredAuthUser | null,
  resumeSession: vi.fn<() => Promise<SessionResumeResult>>(),
}));

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return {
    ...actual,
    isSupabaseConfigured: () => fake.configured,
    authRepo: {
      signIn: fake.signIn,
      signOut: fake.signOut,
      requestPasswordReset: fake.requestPasswordReset,
      updatePassword: fake.updatePassword,
      getSession: vi.fn(async () => null),
      getStoredUser: () => fake.storedUser,
      resumeSession: () => fake.resumeSession(),
      onAuthChange: (listener: AuthChangeListener) => {
        fake.listeners.push(listener as (event: string, session: unknown) => void);
        return () => {
          fake.listeners = fake.listeners.filter((l) => l !== listener);
        };
      },
    },
  };
});

const SESSION: AuthSession = { user: { id: 'u1', email: 'owner@example.com' }, expiresAt: null };

function emit(event: AuthEvent, session: AuthSession | null) {
  act(() => {
    for (const listener of fake.listeners) listener(event, session);
  });
}

function renderApp(path: string) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <SignOutButton />
            <Outlet />
          </>
        ),
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/forgot-password', element: <ForgotPasswordPage /> },
          { path: '/reset-password', element: <ResetPasswordPage /> },
          {
            element: <RequireAuth />,
            children: [
              { path: '/trips', element: <h2>רשימת טיולים</h2> },
              { path: '/trips/:id', element: <h2>דף טיול</h2> },
              { path: '/expiring', element: <ExpiringPage /> },
              { path: '/editing', element: <EditingPage /> },
              { path: '/not-renewed', element: <NotRenewedPage /> },
            ],
          },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return Object.assign(router, { queryClient });
}

/** A page whose request fails because the server rejects the session. */
function ExpiringPage() {
  useQuery({
    queryKey: ['expiring'],
    queryFn: () => Promise.reject(new AppError('auth_expired')),
  });
  return <h2>דף שפג תוקפו</h2>;
}

/** Shows whether writing is allowed (M7.3b: never on a stored, unrenewed session). */
function EditingPage() {
  const { canEdit, reason } = useCanEdit();
  return (
    <>
      <h2>עריכה</h2>
      <button type="button" disabled={!canEdit} title={reason}>
        שמירה
      </button>
      {reason && <p>{reason}</p>}
    </>
  );
}

/** A request that ran before the stored session was renewed (anon → `session_not_refreshed`). */
function NotRenewedPage() {
  useQuery({
    queryKey: ['not-renewed'],
    queryFn: () =>
      Promise.reject(new AppError('network', { reason: 'session_not_refreshed', retryable: true })),
  });
  return <h2>מחכה לחידוש</h2>;
}

const OTHER: AuthSession = { user: { id: 'u2', email: 'other@example.com' }, expiresAt: null };

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  fake.configured = true;
  fake.listeners = [];
  fake.signIn.mockReset();
  fake.signOut.mockReset();
  fake.requestPasswordReset.mockReset();
  fake.updatePassword.mockReset();
  fake.storedUser = null;
  fake.resumeSession.mockReset();
  fake.resumeSession.mockResolvedValue({
    status: 'unreachable',
    user: { id: 'u1', email: 'owner@example.com' },
    error: new AppError('network', { reason: 'refresh_failed', retryable: true }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('route guard', () => {
  it('waits for initial_session before deciding', () => {
    renderApp('/trips');
    expect(screen.getByText('טוען…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'התחברות' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'רשימת טיולים' })).not.toBeInTheDocument();
  });

  it('shows the page when a stored session exists (FR-1.2)', () => {
    renderApp('/trips');
    emit('initial_session', SESSION);
    expect(screen.getByRole('heading', { name: 'רשימת טיולים' })).toBeInTheDocument();
  });

  it('sends a signed-out user to the login page', () => {
    renderApp('/trips/abc');
    emit('initial_session', null);
    expect(screen.getByRole('heading', { name: 'התחברות' })).toBeInTheDocument();
  });

  it('sends a user who followed a reset link to the new-password page', () => {
    renderApp('/trips');
    emit('initial_session', SESSION);
    emit('password_recovery', SESSION);
    expect(screen.getByRole('heading', { name: 'בחירת סיסמה חדשה' })).toBeInTheDocument();
  });
});

describe('LoginPage', () => {
  it('explains that the server is not configured instead of showing a form', () => {
    fake.configured = false;
    renderApp('/login');
    expect(screen.getByRole('heading', { name: 'האפליקציה לא מחוברת לשרת' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/סיסמה/)).not.toBeInTheDocument();
  });

  it('has no sign-up option (FR-1.3)', () => {
    renderApp('/login');
    emit('initial_session', null);
    expect(screen.queryByText(/הרשמה/)).not.toBeInTheDocument();
  });

  it('requires email and password and focuses the first missing field', () => {
    renderApp('/login');
    emit('initial_session', null);
    fireEvent.click(screen.getByRole('button', { name: 'כניסה' }));
    expect(screen.getByText('צריך להזין כתובת אימייל')).toBeInTheDocument();
    expect(screen.getByLabelText(/אימייל/)).toHaveFocus();
    expect(screen.getByLabelText(/אימייל/)).toHaveAttribute('aria-invalid', 'true');
    expect(fake.signIn).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid_credentials', 'invalid_credentials', 'האימייל או הסיסמה לא נכונים.'],
    ['invalid_credentials', 'email_not_confirmed', 'החשבון עדיין לא אושר'],
    ['rate_limited', 'over_request_rate_limit', 'יותר מדי ניסיונות'],
    ['network', null, 'אין חיבור לשרת'],
  ] as const)('shows a Hebrew message for %s / %s', async (kind, reason, message) => {
    fake.signIn.mockRejectedValue(new AppError(kind, { reason }));
    renderApp('/login');
    emit('initial_session', null);
    type('אימייל*', 'owner@example.com');
    type('סיסמה*', 'wrong');
    fireEvent.click(screen.getByRole('button', { name: 'כניסה' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('signs in and returns to the page the user asked for', async () => {
    fake.signIn.mockResolvedValue(SESSION);
    const router = renderApp('/trips/abc');
    emit('initial_session', null);
    type('אימייל*', 'owner@example.com');
    type('סיסמה*', 'secret');
    fireEvent.click(screen.getByRole('button', { name: 'כניסה' }));
    await waitFor(() => expect(fake.signIn).toHaveBeenCalledWith('owner@example.com', 'secret'));
    emit('signed_in', SESSION);
    expect(await screen.findByRole('heading', { name: 'דף טיול' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/trips/abc');
  });
});

describe('ForgotPasswordPage', () => {
  it('requests a reset link that returns to /reset-password', async () => {
    fake.requestPasswordReset.mockResolvedValue(undefined);
    renderApp('/forgot-password');
    type('אימייל*', 'owner@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'שליחת קישור' }));
    expect(await screen.findByText(/נשלח אליה עכשיו קישור/)).toBeInTheDocument();
    expect(fake.requestPasswordReset).toHaveBeenCalledWith(
      'owner@example.com',
      `${window.location.origin}/reset-password`,
    );
  });

  it('shows the email rate limit message', async () => {
    fake.requestPasswordReset.mockRejectedValue(
      new AppError('rate_limited', { reason: 'over_email_send_rate_limit' }),
    );
    renderApp('/forgot-password');
    type('אימייל*', 'owner@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'שליחת קישור' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('נשלחו יותר מדי אימיילים');
  });
});

describe('ResetPasswordPage', () => {
  it('explains an invalid or expired link when there is no session', () => {
    renderApp('/reset-password');
    emit('initial_session', null);
    expect(screen.getByText(/לא תקין או שפג תוקפו/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'שליחת קישור חדש' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('checks that both passwords match', () => {
    renderApp('/reset-password');
    emit('password_recovery', SESSION);
    type('סיסמה חדשה*', 'abcdef12');
    type('שוב את הסיסמה החדשה*', 'abcdef13');
    fireEvent.click(screen.getByRole('button', { name: 'שמירת הסיסמה' }));
    expect(screen.getByText('שתי הסיסמאות לא זהות')).toBeInTheDocument();
    expect(fake.updatePassword).not.toHaveBeenCalled();
  });

  it('shows a generic weak-password message when the server names no rule', async () => {
    fake.updatePassword.mockRejectedValue(new AppError('validation', { reason: 'weak_password' }));
    renderApp('/reset-password');
    emit('password_recovery', SESSION);
    type('סיסמה חדשה*', 'abc');
    type('שוב את הסיסמה החדשה*', 'abc');
    fireEvent.click(screen.getByRole('button', { name: 'שמירת הסיסמה' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('הסיסמה לא עומדת בדרישות האבטחה.');
  });

  it('explains missing character types for a long password (UX-9)', async () => {
    fake.updatePassword.mockRejectedValue(
      new AppError('validation', {
        reason: 'weak_password',
        weakPasswordReasons: ['characters'],
      }),
    );
    renderApp('/reset-password');
    emit('password_recovery', SESSION);
    type('סיסמה חדשה*', 'abcdefghijklmnopqr');
    type('שוב את הסיסמה החדשה*', 'abcdefghijklmnopqr');
    fireEvent.click(screen.getByRole('button', { name: 'שמירת הסיסמה' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'הסיסמה צריכה לכלול אותיות גדולות וקטנות באנגלית, ספרה וסימן (למשל ! או #).',
    );
    expect(alert).not.toHaveTextContent('קצרה');
  });

  it('names a leaked password (UX-9)', async () => {
    fake.updatePassword.mockRejectedValue(
      new AppError('validation', { reason: 'weak_password', weakPasswordReasons: ['pwned'] }),
    );
    renderApp('/reset-password');
    emit('password_recovery', SESSION);
    type('סיסמה חדשה*', 'Password1!');
    type('שוב את הסיסמה החדשה*', 'Password1!');
    fireEvent.click(screen.getByRole('button', { name: 'שמירת הסיסמה' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('הופיעה בדליפות מידע');
  });

  it('saves the new password, ends recovery and opens the trips list', async () => {
    fake.updatePassword.mockResolvedValue(undefined);
    renderApp('/reset-password');
    emit('initial_session', SESSION);
    emit('password_recovery', SESSION);
    type('סיסמה חדשה*', 'abcdef12');
    type('שוב את הסיסמה החדשה*', 'abcdef12');
    fireEvent.click(screen.getByRole('button', { name: 'שמירת הסיסמה' }));
    expect(await screen.findByRole('heading', { name: 'רשימת טיולים' })).toBeInTheDocument();
    expect(fake.updatePassword).toHaveBeenCalledWith('abcdef12');
    expect(screen.getByText('הסיסמה עודכנה')).toBeInTheDocument();
  });
});

describe('SignOutButton', () => {
  it('is hidden while signed out', () => {
    renderApp('/login');
    emit('initial_session', null);
    expect(screen.queryByRole('button', { name: 'יציאה' })).not.toBeInTheDocument();
  });

  it('asks first (Cancel focused), then signs out and shows the login page (FR-1.4)', async () => {
    fake.signOut.mockImplementation(async () => {
      emit('signed_out', null);
    });
    renderApp('/trips');
    emit('initial_session', SESSION);
    fireEvent.click(screen.getByRole('button', { name: 'יציאה' }));
    const dialog = screen.getByRole('alertdialog', { name: 'יציאה מהחשבון' });
    expect(screen.getByRole('button', { name: 'ביטול' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'יציאה' }));
    expect(await screen.findByRole('heading', { name: 'התחברות' })).toBeInTheDocument();
    expect(fake.signOut).toHaveBeenCalledTimes(1);
  });
});

describe('session changes and the query cache', () => {
  it('clears cached data on sign-out', () => {
    const { queryClient } = renderApp('/trips');
    emit('initial_session', SESSION);
    queryClient.setQueryData(['trips', 'list'], [{ id: 't1' }]);
    emit('signed_out', null);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('keeps the cache when the same user refreshes the token', () => {
    const { queryClient } = renderApp('/trips');
    emit('initial_session', SESSION);
    queryClient.setQueryData(['trips', 'list'], [{ id: 't1' }]);
    emit('token_refreshed', SESSION);
    expect(queryClient.getQueryData(['trips', 'list'])).toEqual([{ id: 't1' }]);
  });

  it('clears the cache when another user signs in (e.g. in another tab)', () => {
    const { queryClient } = renderApp('/trips');
    emit('initial_session', SESSION);
    queryClient.setQueryData(['trips', 'list'], [{ id: 't1' }]);
    emit('signed_in', OTHER);
    expect(queryClient.getQueryData(['trips', 'list'])).toBeUndefined();
  });

  it('signs out after an expired session and explains it on the login page', async () => {
    fake.signOut.mockImplementation(async () => {
      emit('signed_out', null);
    });
    renderApp('/expiring');
    emit('initial_session', SESSION);
    expect(await screen.findByRole('heading', { name: 'התחברות' })).toBeInTheDocument();
    expect(fake.signOut).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('ההתחברות פגה');
  });
});

describe('ResetPasswordPage without a reset link', () => {
  it('does not let a normal session set a password', () => {
    renderApp('/reset-password');
    emit('initial_session', SESSION);
    expect(screen.getByText(/לא תקין או שפג תוקפו/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/סיסמה חדשה/)).not.toBeInTheDocument();
  });
});

describe('stored session that could not be renewed (M7.3b)', () => {
  const STORED: StoredAuthUser = { id: 'u1', email: 'owner@example.com' };
  const UNREACHABLE: SessionResumeResult = {
    status: 'unreachable',
    user: STORED,
    error: new AppError('network', { reason: 'refresh_failed', retryable: true }),
  };
  const EDIT_LOCK =
    'החיבור לחשבון עדיין מתחדש, אז אי אפשר לשמור שינויים כרגע. בינתיים אפשר רק לצפות.';

  function setOnline(online: boolean) {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
    act(() => {
      window.dispatchEvent(new Event(online ? 'online' : 'offline'));
    });
  }

  /** Lets a pending resumeSession() promise settle. */
  async function flush() {
    await act(async () => {});
  }

  it('opens guarded pages read-only from a stored session, keeping the cache', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    fake.storedUser = STORED;
    const { queryClient } = renderApp('/editing');
    queryClient.setQueryData(['trips', 'list'], [{ id: 't1' }]);
    emit('initial_session', null);
    await flush();

    expect(screen.getByRole('heading', { name: 'עריכה' })).toBeInTheDocument();
    expect(queryClient.getQueryData(['trips', 'list'])).toEqual([{ id: 't1' }]);
    // Offline: nothing is tried until the connection is back.
    expect(fake.resumeSession).not.toHaveBeenCalled();
    // The device can still be signed out.
    expect(screen.getByRole('button', { name: 'יציאה' })).toBeInTheDocument();
  });

  it('never allows writes on the unverified stored session, even online', async () => {
    fake.storedUser = STORED;
    renderApp('/editing');
    emit('initial_session', null);
    await flush();
    expect(screen.getByRole('button', { name: 'שמירה' })).toBeDisabled();
    expect(screen.getByText(EDIT_LOCK)).toBeInTheDocument();
  });

  it('without a stored session it is a normal sign-out (login page, cache cleared)', () => {
    const { queryClient } = renderApp('/trips');
    queryClient.setQueryData(['trips', 'list'], [{ id: 't1' }]);
    emit('initial_session', null);
    expect(screen.getByRole('heading', { name: 'התחברות' })).toBeInTheDocument();
    expect(queryClient.getQueryData(['trips', 'list'])).toBeUndefined();
  });

  it('renews on reconnect: same user → signed in, cache kept, trips reloaded', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    fake.storedUser = STORED;
    const { queryClient } = renderApp('/editing');
    queryClient.setQueryData(['trips', 'list'], [{ id: 't1' }]);
    emit('initial_session', null);
    await flush();
    expect(screen.getByRole('button', { name: 'שמירה' })).toBeDisabled();

    fake.resumeSession.mockResolvedValue({ status: 'signed_in', session: SESSION });
    setOnline(true);
    await flush();

    expect(fake.resumeSession).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'שמירה' })).toBeEnabled();
    expect(queryClient.getQueryData(['trips', 'list'])).toEqual([{ id: 't1' }]);
    expect(queryClient.getQueryState(['trips', 'list'])?.isInvalidated).toBe(true);
  });

  it('a token_refreshed event from supabase-js also ends the read-only phase', async () => {
    fake.storedUser = STORED;
    const { queryClient } = renderApp('/editing');
    queryClient.setQueryData(['trips', 'list'], [{ id: 't1' }]);
    emit('initial_session', null);
    await flush();
    emit('token_refreshed', SESSION);
    expect(screen.getByRole('button', { name: 'שמירה' })).toBeEnabled();
    expect(queryClient.getQueryData(['trips', 'list'])).toEqual([{ id: 't1' }]);
  });

  it('a different user after the read-only phase clears the cache', async () => {
    fake.storedUser = STORED;
    const { queryClient } = renderApp('/editing');
    queryClient.setQueryData(['trips', 'list'], [{ id: 't1' }]);
    emit('initial_session', null);
    await flush();
    emit('signed_in', OTHER);
    expect(queryClient.getQueryData(['trips', 'list'])).toBeUndefined();
  });

  it('a refused renewal signs out, clears the cache and explains it on the login page', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    fake.storedUser = STORED;
    const { queryClient } = renderApp('/editing');
    queryClient.setQueryData(['trips', 'list'], [{ id: 't1' }]);
    emit('initial_session', null);
    await flush();

    // supabase-js deletes the stored session and emits signed_out while getSession() runs.
    fake.resumeSession.mockImplementation(async () => {
      fake.storedUser = null;
      emit('signed_out', null);
      return { status: 'signed_out' };
    });
    setOnline(true);
    expect(await screen.findByRole('heading', { name: 'התחברות' })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('ההתחברות פגה');
    expect(queryClient.getQueryData(['trips', 'list'])).toBeUndefined();
  });

  it('a refused renewal without a signed_out event also signs out', async () => {
    fake.storedUser = STORED;
    fake.resumeSession.mockResolvedValue({ status: 'signed_out' });
    renderApp('/editing');
    emit('initial_session', null);
    expect(await screen.findByRole('heading', { name: 'התחברות' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('ההתחברות פגה');
  });

  it('stays read-only while the server is unreachable and retries every 30 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fake.storedUser = STORED;
    fake.resumeSession.mockResolvedValue(UNREACHABLE);
    renderApp('/editing');
    emit('initial_session', null);
    await flush();
    expect(fake.resumeSession).toHaveBeenCalledTimes(1); // online at entry: tried at once

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fake.resumeSession).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('heading', { name: 'עריכה' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'שמירה' })).toBeDisabled();
  });

  it('a request that ran before the renewal (session_not_refreshed) does not sign out', async () => {
    fake.storedUser = STORED;
    renderApp('/not-renewed');
    emit('initial_session', null);
    expect(await screen.findByRole('heading', { name: 'מחכה לחידוש' })).toBeInTheDocument();
    await flush();
    expect(fake.signOut).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'התחברות' })).not.toBeInTheDocument();
  });

  it('signing out from the read-only phase works and is not reported as expired', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    fake.storedUser = STORED;
    fake.signOut.mockImplementation(async () => {
      fake.storedUser = null;
      emit('signed_out', null);
    });
    renderApp('/editing');
    emit('initial_session', null);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'יציאה' }));
    const dialog = screen.getByRole('alertdialog', { name: 'יציאה מהחשבון' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'יציאה' }));
    expect(await screen.findByRole('heading', { name: 'התחברות' })).toBeInTheDocument();
    expect(fake.signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it("supabase-js's own refresh tick seeing the token refused (signed_out event) also explains it", async () => {
    fake.storedUser = STORED;
    fake.resumeSession.mockResolvedValue(UNREACHABLE);
    const { queryClient } = renderApp('/editing');
    queryClient.setQueryData(['trips', 'list'], [{ id: 't1' }]);
    emit('initial_session', null);
    await flush();
    expect(screen.getByRole('heading', { name: 'עריכה' })).toBeInTheDocument();

    fake.storedUser = null;
    emit('signed_out', null);
    expect(await screen.findByRole('heading', { name: 'התחברות' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('ההתחברות פגה');
    expect(queryClient.getQueryData(['trips', 'list'])).toBeUndefined();
  });

  it('a renewal that ends after the user signed out is not reported as expired', async () => {
    fake.storedUser = STORED;
    let finish: (result: SessionResumeResult) => void = () => {};
    fake.resumeSession.mockImplementation(
      () => new Promise<SessionResumeResult>((resolve) => (finish = resolve)),
    );
    fake.signOut.mockImplementation(async () => {
      fake.storedUser = null;
      emit('signed_out', null);
    });
    renderApp('/editing');
    emit('initial_session', null);
    await flush();
    expect(fake.resumeSession).toHaveBeenCalledTimes(1); // still pending

    fireEvent.click(screen.getByRole('button', { name: 'יציאה' }));
    const dialog = screen.getByRole('alertdialog', { name: 'יציאה מהחשבון' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'יציאה' }));
    expect(await screen.findByRole('heading', { name: 'התחברות' })).toBeInTheDocument();

    await act(async () => finish({ status: 'signed_out' }));
    expect(screen.getByRole('heading', { name: 'התחברות' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a renewal refused after another sign-in meanwhile keeps that sign-in', async () => {
    fake.storedUser = STORED;
    let finish: (result: SessionResumeResult) => void = () => {};
    fake.resumeSession.mockImplementation(
      () => new Promise<SessionResumeResult>((resolve) => (finish = resolve)),
    );
    renderApp('/editing');
    emit('initial_session', null);
    await flush();
    emit('signed_in', SESSION);
    await act(async () => finish({ status: 'signed_out' }));
    expect(screen.getByRole('button', { name: 'שמירה' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: 'התחברות' })).not.toBeInTheDocument();
  });

  it('the login page sends a stored session back into the app', async () => {
    fake.storedUser = STORED;
    renderApp('/login');
    emit('initial_session', null);
    await flush();
    expect(screen.getByRole('heading', { name: 'רשימת טיולים' })).toBeInTheDocument();
  });
});

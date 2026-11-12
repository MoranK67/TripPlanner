import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { ToastProvider } from '@/components/ui';
import { AppError, type AuthChangeListener, type AuthEvent, type AuthSession } from '@/data';
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

  it('shows the weak-password reason from the server', async () => {
    fake.updatePassword.mockRejectedValue(new AppError('validation', { reason: 'weak_password' }));
    renderApp('/reset-password');
    emit('password_recovery', SESSION);
    type('סיסמה חדשה*', 'abc');
    type('שוב את הסיסמה החדשה*', 'abc');
    fireEvent.click(screen.getByRole('button', { name: 'שמירת הסיסמה' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('הסיסמה חלשה מדי');
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

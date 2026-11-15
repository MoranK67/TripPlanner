import { useMutation } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Button, Field, FormError, Input, LoadingState } from '@/components/ui';
import { authRepo, isSupabaseConfigured } from '@/data';
import { errorMessage } from '@/i18n/errors';
import { AuthCard, authLinkClass } from './AuthCard';
import { useAuth } from './authContext';
import { NotConfiguredNotice } from './NotConfiguredNotice';
import { redirectTarget } from './redirectTarget';

/**
 * Email + password sign-in (FR-1.1). There is no sign-up anywhere (FR-1.3): the owner's account
 * is created in the Supabase dashboard.
 */
export function LoginPage() {
  const { t } = useTranslation();
  const { status, recovery, expired } = useAuth();
  const location = useLocation();

  if (!isSupabaseConfigured()) return <NotConfiguredNotice />;
  if (status === 'loading') return <LoadingState />;
  // A stored session that is not renewed yet (offline) still opens the app, read-only (M7.3b).
  if (status === 'signed_in' || status === 'stored_offline') {
    return <Navigate to={recovery ? '/reset-password' : redirectTarget(location.state)} replace />;
  }

  return (
    <AuthCard title={t('auth.login.title')} intro={t('auth.login.intro')}>
      <LoginForm expired={expired || isExpiredState(location.state)} />
    </AuthCard>
  );
}

/** RequireAuth adds `reason: 'expired'` when the server rejected the session. */
function isExpiredState(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as { reason?: unknown }).reason === 'expired'
  );
}

function LoginForm({ expired }: { expired: boolean }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // On success the AuthProvider receives `signed_in` and LoginPage redirects.
  const signIn = useMutation({
    mutationFn: () => authRepo.signIn(email, password),
  });

  const emailError = submitted && email.trim() === '' ? t('auth.login.emailRequired') : undefined;
  const passwordError = submitted && password === '' ? t('auth.login.passwordRequired') : undefined;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (email.trim() === '') return emailRef.current?.focus();
    if (password === '') return passwordRef.current?.focus();
    signIn.mutate();
  }

  return (
    <form noValidate onSubmit={handleSubmit}>
      {signIn.isError ? (
        <FormError>{errorMessage(signIn.error, t)}</FormError>
      ) : (
        expired && <FormError>{t('errors.kinds.auth_expired')}</FormError>
      )}
      <Field label={t('auth.login.email')} error={emailError} required>
        <Input
          ref={emailRef}
          type="email"
          inputMode="email"
          autoComplete="username"
          dir="ltr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label={t('auth.login.password')} error={passwordError} required>
        <Input
          ref={passwordRef}
          type="password"
          autoComplete="current-password"
          dir="ltr"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Button type="submit" variant="primary" fullWidth loading={signIn.isPending} className="mt-1">
        {t('auth.login.submit')}
      </Button>
      <p className="mt-4 mb-0 text-center">
        <Link to="/forgot-password" className={authLinkClass}>
          {t('auth.login.forgot')}
        </Link>
      </p>
    </form>
  );
}

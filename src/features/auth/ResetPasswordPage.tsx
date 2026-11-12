import { useMutation } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Field, FormError, Input, LoadingState, useToast } from '@/components/ui';
import { authRepo, isSupabaseConfigured } from '@/data';
import { errorMessage } from '@/i18n/errors';
import { AuthCard, authLinkClass } from './AuthCard';
import { useAuth } from './authContext';
import { NotConfiguredNotice } from './NotConfiguredNotice';

/**
 * Set a new password (FR-1.5). The reset email links here; supabase-js reads the token from the
 * URL and signs the user in (event `password_recovery`). Without a session the link was invalid
 * or expired, so we offer to send a new one. A normal signed-in session (not from a reset link)
 * gets the same view: changing the password inside the app is out of scope.
 */
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const { status, recovery } = useAuth();

  if (!isSupabaseConfigured()) return <NotConfiguredNotice />;
  if (status === 'loading') return <LoadingState />;
  // Only a session opened by a reset link may set a password here (no in-app password change).
  if (status === 'signed_out' || !recovery) {
    return (
      <AuthCard title={t('auth.reset.title')}>
        <p className="m-0 leading-relaxed">{t('auth.reset.invalidLink')}</p>
        <p className="mt-4 mb-0 text-center">
          <Link to="/forgot-password" className={authLinkClass}>
            {t('auth.reset.requestNew')}
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('auth.reset.title')} intro={t('auth.reset.intro')}>
      <ResetPasswordForm />
    </AuthCard>
  );
}

function ResetPasswordForm() {
  const { t } = useTranslation();
  const { finishRecovery } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const update = useMutation({
    mutationFn: () => authRepo.updatePassword(password),
    onSuccess: () => {
      finishRecovery();
      toast.show(t('auth.reset.done'));
      navigate('/trips', { replace: true });
    },
  });

  // Password strength rules live in Supabase Auth; its `weak_password` error is shown as is.
  const passwordError = submitted && password === '' ? t('auth.reset.passwordRequired') : undefined;
  const confirmError =
    submitted && password !== '' && confirm !== password ? t('auth.reset.mismatch') : undefined;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (password === '') {
      passwordRef.current?.focus();
      return;
    }
    if (confirm !== password) {
      confirmRef.current?.focus();
      return;
    }
    update.mutate();
  }

  return (
    <form noValidate onSubmit={handleSubmit}>
      {update.isError && <FormError>{errorMessage(update.error, t)}</FormError>}
      <Field label={t('auth.reset.password')} error={passwordError} required>
        <Input
          ref={passwordRef}
          type="password"
          autoComplete="new-password"
          dir="ltr"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Field label={t('auth.reset.confirm')} error={confirmError} required>
        <Input
          ref={confirmRef}
          type="password"
          autoComplete="new-password"
          dir="ltr"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Field>
      <Button type="submit" variant="primary" fullWidth loading={update.isPending}>
        {t('auth.reset.submit')}
      </Button>
    </form>
  );
}

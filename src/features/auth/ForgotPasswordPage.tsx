import { useMutation } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, Field, FormError, Input } from '@/components/ui';
import { authRepo, isSupabaseConfigured } from '@/data';
import { errorMessage } from '@/i18n/errors';
import { AuthCard, authLinkClass } from './AuthCard';
import { NotConfiguredNotice } from './NotConfiguredNotice';

/** Path of the set-new-password page; must be an allowed redirect URL in Supabase Auth. */
export const RESET_PASSWORD_PATH = '/reset-password';

/** Asks Supabase to email a password-reset link (FR-1.5). */
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const request = useMutation({
    mutationFn: () =>
      authRepo.requestPasswordReset(email, `${window.location.origin}${RESET_PASSWORD_PATH}`),
  });

  if (!isSupabaseConfigured()) return <NotConfiguredNotice />;

  const backLink = (
    <p className="mt-4 mb-0 text-center">
      <Link to="/login" className={authLinkClass}>
        {t('auth.forgot.back')}
      </Link>
    </p>
  );

  if (request.isSuccess) {
    return (
      <AuthCard title={t('auth.forgot.title')}>
        {/* Same text whether or not the address has an account (no account enumeration). */}
        <p role="status" className="m-0 leading-relaxed">
          {t('auth.forgot.sent', { email: email.trim() })}
        </p>
        {backLink}
      </AuthCard>
    );
  }

  const emailError = submitted && email.trim() === '' ? t('auth.login.emailRequired') : undefined;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (email.trim() === '') {
      emailRef.current?.focus();
      return;
    }
    request.mutate();
  }

  return (
    <AuthCard title={t('auth.forgot.title')} intro={t('auth.forgot.intro')}>
      <form noValidate onSubmit={handleSubmit}>
        {request.isError && <FormError>{errorMessage(request.error, t)}</FormError>}
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
        <Button type="submit" variant="primary" fullWidth loading={request.isPending}>
          {t('auth.forgot.submit')}
        </Button>
        {backLink}
      </form>
    </AuthCard>
  );
}

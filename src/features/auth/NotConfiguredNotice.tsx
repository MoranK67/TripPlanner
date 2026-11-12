import { useTranslation } from 'react-i18next';
import { AuthCard } from './AuthCard';

/**
 * Shown instead of the login form when the app has no Supabase URL / key (`.env.local` missing):
 * a form that can never work would only confuse.
 */
export function NotConfiguredNotice() {
  const { t } = useTranslation();
  return (
    <AuthCard title={t('auth.notConfigured.title')}>
      <p className="m-0 leading-relaxed text-ink-soft">{t('auth.notConfigured.body')}</p>
    </AuthCard>
  );
}

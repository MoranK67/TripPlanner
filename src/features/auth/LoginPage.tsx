import { useTranslation } from 'react-i18next';
import { PagePlaceholder } from '@/components/ui';

export function LoginPage() {
  const { t } = useTranslation();
  return <PagePlaceholder title={t('login.title')} note={t('login.placeholder')} />;
}

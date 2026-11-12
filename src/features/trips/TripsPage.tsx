import { useTranslation } from 'react-i18next';
import { PagePlaceholder } from '@/components/ui';

export function TripsPage() {
  const { t } = useTranslation();
  return <PagePlaceholder title={t('trips.title')} note={t('trips.placeholder')} />;
}

import { useTranslation } from 'react-i18next';
import { PagePlaceholder } from '@/components/ui';

export function TripPlannerPage() {
  const { t } = useTranslation();
  return <PagePlaceholder title={t('planner.title')} note={t('planner.placeholder')} />;
}

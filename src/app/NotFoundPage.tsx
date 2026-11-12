import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="grid place-items-center p-6">
      <Card className="max-w-md text-center">
        <h2 className="mb-4 text-xl font-bold">{t('notFound.title')}</h2>
        <Link
          to="/trips"
          className="inline-block rounded-full bg-accent px-4 py-2 font-medium text-accent-ink no-underline hover:bg-accent-hover"
        >
          {t('notFound.back')}
        </Link>
      </Card>
    </div>
  );
}

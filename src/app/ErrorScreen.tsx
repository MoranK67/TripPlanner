import { useTranslation } from 'react-i18next';
import { Button, Card } from '@/components/ui';

export function ErrorScreen() {
  const { t } = useTranslation();
  return (
    <div className="grid h-full place-items-center p-6">
      <Card className="max-w-md text-center">
        <h2 className="mb-2 text-xl font-bold">{t('errors.title')}</h2>
        <p className="mb-5 leading-relaxed text-ink-soft">{t('errors.body')}</p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          {t('errors.reload')}
        </Button>
      </Card>
    </div>
  );
}

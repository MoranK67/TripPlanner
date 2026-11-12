import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, useToast } from '@/components/ui';
import { Section } from './Section';

type Which = 'none' | 'delete' | 'slow' | 'neutral';

/** Gallery section for ConfirmDialog (M3.2). */
export function ConfirmDialogDemo() {
  const { t } = useTranslation();
  const toast = useToast();
  const [which, setWhich] = useState<Which>('none');
  const [loading, setLoading] = useState(false);
  const name = t('devUi.sampleName');
  const close = () => setWhich('none');

  function confirmSlow() {
    // Simulates a mutation in flight: the dialog stays open and cannot be cancelled.
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      close();
      toast.show(t('devUi.deleted', { name }));
    }, 1500);
  }

  return (
    <Section title={t('devUi.confirm')}>
      <p className="mt-0 mb-3 text-sm text-ink-soft">{t('devUi.confirmIntro')}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" onClick={() => setWhich('delete')}>
          {t('devUi.openConfirm')}
        </Button>
        <Button onClick={() => setWhich('slow')}>{t('devUi.openConfirmLoading')}</Button>
        <Button variant="ghost" onClick={() => setWhich('neutral')}>
          {t('devUi.openConfirmNeutral')}
        </Button>
      </div>

      <ConfirmDialog
        open={which === 'delete' || which === 'slow'}
        title={t('devUi.confirmTitle')}
        message={t('devUi.confirmMessage', { name })}
        loading={loading}
        onCancel={close}
        onConfirm={() => {
          if (which === 'slow') {
            confirmSlow();
            return;
          }
          close();
          toast.show(t('devUi.deleted', { name }));
        }}
      />
      <ConfirmDialog
        open={which === 'neutral'}
        destructive={false}
        title={t('devUi.confirmNeutralTitle')}
        message={t('devUi.confirmNeutralMessage')}
        onCancel={close}
        onConfirm={close}
      />
    </Section>
  );
}

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Field, Input, Modal, Select, Textarea, useToast } from '@/components/ui';
import { ActivityBlockDemo } from './ActivityBlockDemo';
import { ConfirmDialogDemo } from './ConfirmDialogDemo';
import { LayoutDemo } from './LayoutDemo';
import { Section } from './Section';

// Development-only gallery of the UI primitives (M3.1). The route is registered only when
// import.meta.env.DEV is true, so this module is not part of production builds.

const HOURS = Array.from({ length: 6 }, (_, i) => `${String(8 + i).padStart(2, '0')}:00`);

export function UiGalleryPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [modal, setModal] = useState<'none' | 'md' | 'wide'>('none');
  const [tripName, setTripName] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const close = () => setModal('none');

  return (
    <div className="mx-auto max-w-3xl">
      <h2 className="mt-0 mb-1 text-xl font-bold">{t('devUi.title')}</h2>
      <p className="mt-0 mb-5 text-ink-soft">{t('devUi.intro')}</p>

      <Section title={t('devUi.buttons')}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button variant="primary">{t('devUi.primary')}</Button>
          <Button variant="soft">{t('devUi.soft')}</Button>
          <Button variant="ghost">{t('devUi.ghost')}</Button>
          <Button variant="danger">{t('devUi.danger')}</Button>
          <Button size="icon" aria-label={t('devUi.iconLabel')}>
            <span aria-hidden="true">+</span>
          </Button>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm">
            {t('devUi.small')}
          </Button>
          <Button variant="soft" size="sm">
            {t('devUi.small')}
          </Button>
          <Button variant="primary" disabled>
            {t('devUi.disabled')}
          </Button>
          <Button variant="primary" loading>
            {t('devUi.loading')}
          </Button>
        </div>
        <Button variant="soft" fullWidth>
          {t('devUi.fullWidth')}
        </Button>
      </Section>

      <Section title={t('devUi.fields')}>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label={t('devUi.nameLabel')} hint={t('devUi.nameHint')}>
            <Input maxLength={60} autoComplete="off" placeholder={t('devUi.namePlaceholder')} />
          </Field>
          <Field
            label={t('devUi.requiredLabel')}
            required
            error={tripName.trim() ? undefined : t('devUi.requiredError')}
          >
            <Input value={tripName} onChange={(e) => setTripName(e.target.value)} />
          </Field>
          <Field label={t('devUi.selectLabel')}>
            <Select defaultValue={HOURS[1]}>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('devUi.disabledLabel')}>
            <Input disabled defaultValue={t('devUi.disabled')} />
          </Field>
        </div>
        <Field label={t('devUi.notesLabel')}>
          <Textarea placeholder={t('devUi.notesPlaceholder')} />
        </Field>
      </Section>

      <Section title={t('devUi.modal')}>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setModal('md')}>
            {t('devUi.openModal')}
          </Button>
          <Button onClick={() => setModal('wide')}>{t('devUi.openWideModal')}</Button>
        </div>
      </Section>

      <ConfirmDialogDemo />

      <ActivityBlockDemo />

      <LayoutDemo />

      <Section title={t('devUi.toast')}>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => toast.show(t('devUi.toastMessage'))}>
            {t('devUi.showToast')}
          </Button>
          <Button
            variant="danger"
            onClick={() => toast.show(t('devUi.toastError'), { tone: 'error' })}
          >
            {t('devUi.showErrorToast')}
          </Button>
        </div>
      </Section>

      <Modal
        open={modal === 'md'}
        onClose={close}
        title={t('devUi.modalTitle')}
        description={t('devUi.modalDescription')}
        initialFocusRef={nameRef}
        footer={
          <>
            <Button variant="primary" onClick={close}>
              {t('common.save')}
            </Button>
            <Button variant="ghost" onClick={close}>
              {t('common.cancel')}
            </Button>
          </>
        }
      >
        <Field label={t('devUi.nameLabel')} hint={t('devUi.nameHint')}>
          <Input ref={nameRef} placeholder={t('devUi.namePlaceholder')} />
        </Field>
        <Field label={t('devUi.selectLabel')}>
          <Select defaultValue={HOURS[0]}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </Select>
        </Field>
      </Modal>

      <Modal
        open={modal === 'wide'}
        onClose={close}
        size="wide"
        title={t('devUi.wideModalTitle')}
        footer={
          <Button variant="ghost" onClick={close}>
            {t('common.close')}
          </Button>
        }
      >
        <Field label={t('devUi.notesLabel')}>
          <Textarea placeholder={t('devUi.notesPlaceholder')} />
        </Field>
      </Modal>
    </div>
  );
}

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, useToast } from '@/components/ui';
import {
  buildExportLayout,
  fittedExportRange,
  minuteLabel,
  PDF_DAYS_PER_PAGE,
  type Activity,
  type ExportHourRange,
  type Trip,
} from '@/domain';
import { errorMessage } from '@/i18n/errors';
import { platform } from '@/platform';
import { exportText } from './exportText';
import { EXPORT_MIME, exportFileName, type ExportFormat } from './fileName';

export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  trip: Pick<Trip, 'name' | 'window'>;
  /** All of the trip's activities (bank activities are ignored by the layout). */
  activities: readonly Activity[];
}

interface GeneratedFile {
  blob: Blob;
  name: string;
  mime: string;
}

type Step =
  | { kind: 'idle' }
  | { kind: 'generating'; format: ExportFormat }
  /** Generation outlived the tap's user activation: one more tap opens the share sheet. */
  | { kind: 'ready'; file: GeneratedFile }
  | { kind: 'saving'; file: GeneratedFile };

/**
 * True when the browser reports that the tap's user activation has expired (generation was slow).
 * A share sheet needs a fresh activation, so the dialog asks for one more tap instead.
 */
function userActivationExpired(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
    .userActivation;
  return activation !== undefined && !activation.isActive;
}

function rangeLabel(startMinute: number, endMinute: number): string {
  return `${minuteLabel(startMinute)}–${minuteLabel(endMinute)}`;
}

/**
 * "Export timetable" dialog (FR-7.1–FR-7.5, prototype `openExportModal`): choose the hour range
 * (FR-7.3) and save the timetable as one PNG or as an A4 PDF. The renderer and jsPDF are loaded
 * only when a file is made (NFR-4). The file goes to `platform.saveFile` (share sheet on phones,
 * download on desktop). The dialog cannot be closed while the file is being made.
 */
export function ExportDialog({ open, onClose, trip, activities }: ExportDialogProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const radioName = useId();
  const [hourRange, setHourRange] = useState<ExportHourRange>('fitted');
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const busy = step.kind === 'generating' || step.kind === 'saving';

  // Ignore results that arrive after the dialog was closed or unmounted.
  const runRef = useRef(0);
  useEffect(() => {
    const runs = runRef;
    return () => {
      runs.current += 1;
    };
  }, []);

  const fitted = fittedExportRange(trip.window, activities);

  function close() {
    if (busy) return;
    runRef.current += 1;
    setStep({ kind: 'idle' });
    setHourRange('fitted');
    onClose();
  }

  function fail(error: unknown) {
    console.error('[export] export failed', error);
    toast.show(t('export.failed', { reason: errorMessage(error, t) }), { tone: 'error' });
    setStep({ kind: 'idle' });
  }

  async function save(file: GeneratedFile, run: number) {
    setStep({ kind: 'saving', file });
    try {
      const result = await platform.saveFile(file.blob, file.name, file.mime);
      if (run !== runRef.current) return;
      if (result === 'cancelled') {
        // The user closed the share sheet / save dialog: nothing to report.
        setStep({ kind: 'idle' });
        return;
      }
      toast.show(t(result === 'shared' ? 'export.shared' : 'export.saved'));
      setStep({ kind: 'idle' });
      setHourRange('fitted');
      onClose();
    } catch (error) {
      if (run === runRef.current) fail(error);
    }
  }

  async function generate(format: ExportFormat) {
    if (busy) return;
    const run = ++runRef.current;
    setStep({ kind: 'generating', format });
    try {
      const layout = buildExportLayout(trip, activities, {
        hourRange,
        daysPerPage: format === 'pdf' ? PDF_DAYS_PER_PAGE : undefined,
      });
      const text = exportText(layout, t);
      const renderer = await import('./renderExport');
      const blob =
        format === 'png'
          ? await renderer.renderPng(layout, text)
          : await renderer.renderPdf(layout, text);
      if (run !== runRef.current) return;
      const file: GeneratedFile = {
        blob,
        name: exportFileName(trip.name, format, t('export.fileFallback')),
        mime: EXPORT_MIME[format],
      };
      if (userActivationExpired()) {
        setStep({ kind: 'ready', file });
        return;
      }
      await save(file, run);
    } catch (error) {
      if (run === runRef.current) fail(error);
    }
  }

  const ready = step.kind === 'ready' || step.kind === 'saving' ? step.file : null;

  const footer = ready ? (
    <>
      <Button
        variant="primary"
        loading={step.kind === 'saving'}
        onClick={() => void save(ready, runRef.current)}
      >
        {t('export.saveReady')}
      </Button>
      <Button variant="ghost" disabled={busy} onClick={close}>
        {t('common.cancel')}
      </Button>
    </>
  ) : (
    <>
      <Button
        variant="primary"
        disabled={busy}
        loading={step.kind === 'generating' && step.format === 'png'}
        onClick={() => void generate('png')}
      >
        {step.kind === 'generating' && step.format === 'png'
          ? t('export.generating')
          : t('export.png')}
      </Button>
      <Button
        variant="primary"
        disabled={busy}
        loading={step.kind === 'generating' && step.format === 'pdf'}
        onClick={() => void generate('pdf')}
      >
        {step.kind === 'generating' && step.format === 'pdf'
          ? t('export.generating')
          : t('export.pdf')}
      </Button>
      <Button variant="ghost" disabled={busy} onClick={close}>
        {t('common.cancel')}
      </Button>
    </>
  );

  const options: { value: ExportHourRange; label: string; range: string }[] = [
    {
      value: 'fitted',
      label: t('export.rangeFitted'),
      range: rangeLabel(fitted.startMinute, fitted.endMinute),
    },
    { value: 'full', label: t('export.rangeFull'), range: rangeLabel(0, 24 * 60) },
  ];

  return (
    <Modal
      open={open}
      onClose={close}
      closeOnBackdrop={!busy}
      showCloseButton={!busy}
      size="wide"
      title={t('export.title')}
      footer={footer}
    >
      {/* Announces progress and the "ready" step to screen readers. */}
      <p role="status" className="sr-only">
        {step.kind === 'generating' ? t('export.generating') : ready ? t('export.ready') : ''}
      </p>
      {ready ? (
        <p className="mt-0 mb-0 leading-relaxed text-ink-soft">{t('export.readyHint')}</p>
      ) : (
        <>
          <fieldset className="m-0 mb-4 min-w-0 border-0 p-0" disabled={busy}>
            <legend className="mb-2 p-0 text-[13.5px] font-medium text-ink-soft">
              {t('export.rangeLegend')}
            </legend>
            <div className="flex flex-col gap-2">
              {options.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-field)] border border-line-strong px-3 py-2.5 text-sm transition-colors has-checked:border-accent-strong has-checked:bg-accent-soft has-focus-visible:ring-2 has-focus-visible:ring-accent-soft has-disabled:cursor-default"
                >
                  <input
                    type="radio"
                    name={radioName}
                    value={option.value}
                    checked={hourRange === option.value}
                    onChange={() => setHourRange(option.value)}
                    className="m-0 size-4 shrink-0 accent-accent-ink"
                  />
                  <span className="font-medium">{option.label}</span>
                  <span className="ms-auto text-[12.5px] whitespace-nowrap text-ink-soft">
                    {option.range}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="mt-0 mb-0 text-[12.5px] leading-relaxed text-ink-soft">
            {t('export.pdfHint', { max: PDF_DAYS_PER_PAGE })}
          </p>
        </>
      )}
    </Modal>
  );
}

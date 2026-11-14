import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, useToast } from '@/components/ui';
import { useTripsQuery } from '@/features/trips';
import { errorMessage } from '@/i18n/errors';
import { platform } from '@/platform';
import { tripCountLabel } from './backupMessages';
import { BackupImportDialog } from './BackupImportDialog';
import { BACKUP_MIME, useBuildBackupFile, type BackupFile } from './hooks';

/**
 * True when the browser reports that the tap's user activation has expired (the server was slow).
 * A share sheet needs a fresh activation, so the user is asked for one more tap.
 */
function userActivationExpired(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
    .userActivation;
  return activation !== undefined && !activation.isActive;
}

type ExportStep =
  | { kind: 'idle' }
  | { kind: 'building' }
  /** Built after the tap's activation expired: a small dialog asks for one more tap. */
  | { kind: 'ready'; file: BackupFile }
  | { kind: 'saving'; file: BackupFile; fromReady: boolean };

/**
 * Trips-page header buttons (FR-8.1, FR-8.2): "שמירת גיבוי" saves all trips as one JSON file via
 * `platform.saveFile` (share sheet on phones, download on desktop), and "שחזור מגיבוי" opens the
 * restore dialog. The export button is hidden while the trips list is loading or empty (it reads
 * the shared trips list query).
 */
export function BackupActions() {
  const { t } = useTranslation();
  const toast = useToast();
  const buildFile = useBuildBackupFile();
  const canExport = (useTripsQuery().data?.length ?? 0) > 0;
  const [step, setStep] = useState<ExportStep>({ kind: 'idle' });
  const [importing, setImporting] = useState(false);
  const busy = step.kind === 'building' || step.kind === 'saving';

  // Ignore results that arrive after the page was left.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function fail(error: unknown) {
    if (!mounted.current) return;
    console.error('[backup] export failed', error);
    toast.show(t('backup.export.failed', { reason: errorMessage(error, t) }), { tone: 'error' });
    setStep({ kind: 'idle' });
  }

  async function save(file: BackupFile, fromReady: boolean) {
    setStep({ kind: 'saving', file, fromReady });
    try {
      const result = await platform.saveFile(file.blob, file.name, BACKUP_MIME);
      if (!mounted.current) return;
      setStep({ kind: 'idle' });
      // The user closed the share sheet / save dialog: nothing to report.
      if (result === 'cancelled') return;
      const trips = tripCountLabel(file.tripCount, t);
      toast.show(
        t(result === 'shared' ? 'backup.export.shared' : 'backup.export.saved', { trips }),
      );
    } catch (error) {
      fail(error);
    }
  }

  async function startExport() {
    if (busy) return;
    setStep({ kind: 'building' });
    let file: BackupFile;
    try {
      file = await buildFile.mutateAsync();
    } catch (error) {
      fail(error);
      return;
    }
    if (!mounted.current) return;
    if (file.tripCount === 0) {
      toast.show(t('backup.export.empty'));
      setStep({ kind: 'idle' });
      return;
    }
    if (userActivationExpired()) {
      setStep({ kind: 'ready', file });
      return;
    }
    await save(file, false);
  }

  const ready = step.kind === 'ready' || (step.kind === 'saving' && step.fromReady) ? step : null;

  return (
    <>
      {canExport && (
        <Button size="sm" loading={busy} onClick={() => void startExport()}>
          {t('backup.export.open')}
        </Button>
      )}
      <Button size="sm" aria-haspopup="dialog" onClick={() => setImporting(true)}>
        {t('backup.import.open')}
      </Button>
      <p role="status" className="sr-only">
        {step.kind === 'building' ? t('backup.export.busy') : ''}
      </p>

      <BackupImportDialog open={importing} onClose={() => setImporting(false)} />
      <Modal
        open={ready !== null}
        onClose={() => {
          if (step.kind === 'ready') setStep({ kind: 'idle' });
        }}
        closeOnBackdrop={step.kind === 'ready'}
        showCloseButton={step.kind === 'ready'}
        title={t('backup.export.readyTitle')}
        description={
          ready
            ? t('backup.export.readyHint', { trips: tripCountLabel(ready.file.tripCount, t) })
            : null
        }
        footer={
          ready && (
            <>
              <Button
                variant="primary"
                loading={step.kind === 'saving'}
                onClick={() => void save(ready.file, true)}
              >
                {t('backup.export.saveReady')}
              </Button>
              <Button
                variant="ghost"
                disabled={step.kind === 'saving'}
                onClick={() => setStep({ kind: 'idle' })}
              >
                {t('common.cancel')}
              </Button>
            </>
          )
        }
      />
    </>
  );
}

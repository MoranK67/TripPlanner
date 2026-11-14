import { useIsMutating } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, FormError, Modal, useToast } from '@/components/ui';
import {
  MAX_BACKUP_TEXT_LENGTH,
  parseBackup,
  type BackupParseResult,
  type BackupTrip,
  type BackupWarning,
} from '@/domain';
import { tripDaysLabel, tripRangeLabel } from '@/features/trips';
import {
  activityCountLabel,
  BACKUP_FORMAT_KEYS,
  importErrorMessage,
  parseErrorMessage,
  tripCountLabel,
  warningMessage,
} from './backupMessages';
import { backupMutationKeys, useImportBackup } from './hooks';

/**
 * Files above this size are rejected without reading them. A character takes at most 4 bytes in
 * UTF-8, so no file under it can exceed `MAX_BACKUP_TEXT_LENGTH` characters unnoticed: the exact
 * check is `parseBackup`'s.
 */
export const MAX_BACKUP_FILE_BYTES = MAX_BACKUP_TEXT_LENGTH * 4;

export interface BackupImportDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * "Restore from backup" dialog (FR-8.1, FR-8.2, DEC-033): pick a backup file (the prototype's
 * or the app's), see what is in it with Hebrew warnings, then add all its trips in one atomic
 * call. The import only adds trips. It cannot be closed while saving (DEC-025).
 */
export function BackupImportDialog({ open, onClose }: BackupImportDialogProps) {
  const { t } = useTranslation();
  const saving = useIsMutating({ mutationKey: backupMutationKeys.import }) > 0;
  return (
    <Modal
      open={open}
      onClose={saving ? noop : onClose}
      closeOnBackdrop={!saving}
      showCloseButton={!saving}
      size="wide"
      title={t('backup.import.title')}
      description={t('backup.import.description')}
    >
      {open && <ImportForm onDone={onClose} />}
    </Modal>
  );
}

function noop() {}

type Loaded =
  | { kind: 'none' }
  | { kind: 'reading'; fileName: string }
  | { kind: 'read_error'; fileName: string }
  | { kind: 'parsed'; fileName: string; result: BackupParseResult };

function ImportForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const importBackup = useImportBackup();
  const saving = importBackup.isPending;
  const inputRef = useRef<HTMLInputElement>(null);
  const fileNameId = useId();
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'none' });

  // Ignore a file read that finishes after another file was picked or the dialog closed.
  const readRef = useRef(0);
  useEffect(() => {
    const reads = readRef;
    return () => {
      reads.current += 1;
    };
  }, []);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Allow picking the same file again after a change (the browser skips identical values).
    e.target.value = '';
    if (!file || saving) return;
    importBackup.reset();
    const read = ++readRef.current;
    const fileName = file.name;
    if (file.size > MAX_BACKUP_FILE_BYTES) {
      setLoaded({
        kind: 'parsed',
        fileName,
        result: { ok: false, error: 'too_large', warnings: [] },
      });
      return;
    }
    setLoaded({ kind: 'reading', fileName });
    try {
      const text = await file.text();
      if (read !== readRef.current) return;
      setLoaded({ kind: 'parsed', fileName, result: parseBackup(text) });
    } catch {
      if (read === readRef.current) setLoaded({ kind: 'read_error', fileName });
    }
  }

  const result = loaded.kind === 'parsed' ? loaded.result : null;
  const trips = result?.ok ? result.trips : null;

  function handleImport() {
    if (!result?.ok || saving) return;
    const toImport = result.trips;
    importBackup.reset();
    importBackup.mutate(toImport, {
      onSuccess: (counts) => {
        toast.show(
          t('backup.import.success', {
            trips: tripCountLabel(counts.trips, t),
            activities: activityCountLabel(counts.activities, t),
          }),
        );
        onDone();
      },
    });
  }

  const serverError =
    importBackup.isError && trips ? importErrorMessage(importBackup.error, trips, t) : null;

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        aria-label={t('backup.import.fileLabel')}
        // The visible button below opens it; keep the native control out of focus and the a11y tree.
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
        disabled={saving}
        onChange={(e) => void handleFile(e)}
      />
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          aria-describedby={loaded.kind === 'none' ? undefined : fileNameId}
          disabled={saving}
          onClick={() => inputRef.current?.click()}
        >
          {loaded.kind === 'none' ? t('backup.import.pick') : t('backup.import.pickOther')}
        </Button>
        {loaded.kind !== 'none' && (
          <span
            id={fileNameId}
            className="min-w-0 text-[13.5px] text-ink-soft [overflow-wrap:anywhere]"
          >
            {t('backup.import.selectedFile', { name: loaded.fileName })}
          </span>
        )}
      </div>

      <p role="status" className="sr-only">
        {loaded.kind === 'reading'
          ? t('backup.import.reading')
          : saving
            ? t('backup.import.saving')
            : ''}
      </p>
      {loaded.kind === 'reading' && (
        <p className="mt-0 mb-3 text-[13.5px] text-ink-soft">{t('backup.import.reading')}</p>
      )}
      {loaded.kind === 'read_error' && <FormError>{t('backup.import.readFailed')}</FormError>}
      {result && !result.ok && (
        <>
          <FormError>{parseErrorMessage(result.error, t)}</FormError>
          <WarningList warnings={result.warnings} />
        </>
      )}
      {result?.ok && <Preview result={result} />}

      {serverError && <FormError className="mt-3">{serverError}</FormError>}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button variant="primary" loading={saving} disabled={!trips} onClick={handleImport}>
          {trips
            ? t('backup.import.submit', { count: trips.length })
            : t('backup.import.submitNone')}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={saving}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}

function Preview({ result }: { result: Extract<BackupParseResult, { ok: true }> }) {
  const { t } = useTranslation();
  const exportedAt = formatExportedAt(result.exportedAt);
  return (
    <>
      <div className="mb-3 rounded-xl bg-accent-soft px-3 py-2.5 text-[13.5px] leading-relaxed text-ink">
        <p className="m-0 font-medium">
          {t('backup.preview.contents', {
            trips: tripCountLabel(result.trips.length, t),
            activities: activityCountLabel(result.activityCount, t),
          })}
        </p>
        <p className="m-0 text-ink-soft">
          {t('backup.preview.format', { format: t(BACKUP_FORMAT_KEYS[result.format]) })}
          {exportedAt && ` · ${t('backup.preview.exportedAt', { date: exportedAt })}`}
        </p>
      </div>

      <ul
        aria-label={t('backup.preview.tripsLabel')}
        className="m-0 mb-3 max-h-[200px] list-none overflow-auto rounded-xl border border-line p-0"
      >
        {result.trips.map((trip, index) => (
          <TripRow key={index} trip={trip} />
        ))}
      </ul>

      <WarningList warnings={result.warnings} />

      <p className="mt-0 mb-0 rounded-xl border border-line-strong px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
        {t('backup.import.addOnly')}
      </p>
    </>
  );
}

function TripRow({ trip }: { trip: BackupTrip }) {
  const { t } = useTranslation();
  const placed = trip.activities.filter((a) => a.placement !== null).length;
  const bank = trip.activities.length - placed;
  return (
    <li className="border-b border-line px-3 py-2 text-[13.5px] last:border-b-0">
      <span className="block font-semibold [overflow-wrap:anywhere]">{trip.name}</span>
      <span className="block text-[12.5px] leading-relaxed text-ink-soft">
        {tripRangeLabel(trip.window, t, 'long')} · {tripDaysLabel(trip.window, t)}
      </span>
      <span className="block text-[12.5px] leading-relaxed text-ink-soft">
        {activityCountLabel(trip.activities.length, t)}
        {trip.activities.length > 0 && ` (${t('backup.preview.placement', { placed, bank })})`}
      </span>
    </li>
  );
}

function WarningList({ warnings }: { warnings: readonly BackupWarning[] }) {
  const { t } = useTranslation();
  const titleId = useId();
  if (warnings.length === 0) return null;
  return (
    <div className="mb-3 rounded-xl bg-pastel-butter px-3 py-2.5 text-[13px] leading-relaxed text-ink">
      <p id={titleId} className="m-0 mb-1 font-semibold">
        {t('backup.preview.warningsTitle', { count: warnings.length })}
      </p>
      <ul aria-labelledby={titleId} className="m-0 max-h-[160px] list-disc overflow-auto ps-5">
        {warnings.map((warning, index) => (
          <li key={index} className="[overflow-wrap:anywhere]">
            {warningMessage(warning, t)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The file's `exportedAt` as a local Hebrew date and time, or `null` if it is not a date. */
function formatExportedAt(value: string | null): string | null {
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('he-IL', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

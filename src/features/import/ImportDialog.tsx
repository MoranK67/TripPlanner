import { useIsMutating } from '@tanstack/react-query';
import {
  useDeferredValue,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Button,
  Field,
  FormError,
  Modal,
  MODAL_FORM_CLASS,
  ModalActions,
  OfflineNote,
  Textarea,
  useCanEdit,
  useToast,
} from '@/components/ui';
import {
  ACTIVITY_NAME_MAX,
  formatDurationHe,
  MAX_IMPORT_ROWS,
  parseImport,
  TAG_MAX,
  type Activity,
  type ActivityInput,
  type ImportParseResult,
  type Trip,
} from '@/domain';
import { errorMessage, isAbortedError, isTimeoutError } from '@/i18n/errors';
import { AiPromptCopy } from './AiPromptCopy';
import { importMutationKeys, useImportActivities } from './hooks';
import { IMPORT_REASON_KEYS } from './importReasons';
import { previewColors } from './previewColors';
import { useDebouncedValue } from './useDebouncedValue';

/** Delay before the counts are announced to screen readers, so typing is not interrupted. */
const ANNOUNCE_DELAY_MS = 500;

export interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * The trip to import into: its color cursor gives the preview colors (FR-6.4); its name and
   * dates go into the AI prompt (FEAT-2).
   */
  trip: ImportTrip;
  /** The trip's activities: a tag they already use gives the preview its group colour (FEAT-2). */
  activities?: readonly Activity[];
}

type ImportTrip = Pick<Trip, 'id' | 'colorCursor' | 'name' | 'window'>;

const NO_ACTIVITIES: readonly Activity[] = [];

/**
 * "Import list" dialog (FR-6.1–FR-6.5): paste text, see a live preview of the parsed rows (valid
 * rows with color and duration, invalid rows with the reason) and add the valid rows to the bank
 * in one call. More than `MAX_IMPORT_ROWS` valid rows blocks the whole import (DEC-015).
 */
export function ImportDialog({
  open,
  onClose,
  trip,
  activities = NO_ACTIVITIES,
}: ImportDialogProps) {
  const { t } = useTranslation();
  // While saving, the dialog cannot be closed: its toast and error report need it.
  const saving = useIsMutating({ mutationKey: importMutationKeys.import(trip.id) }) > 0;
  // The paste box is what the user came for, so it gets focus on open (M6.1 nit).
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  return (
    <Modal
      initialFocusRef={textareaRef}
      open={open}
      onClose={saving ? noop : onClose}
      closeOnBackdrop={!saving}
      showCloseButton={!saving}
      size="wide"
      title={t('import.title')}
      description={
        <Trans
          i18nKey="import.formatHint"
          components={{ code: <code className="rounded bg-accent-soft px-1 text-accent-ink" /> }}
        />
      }
    >
      {open && (
        <ImportForm
          trip={trip}
          activities={activities}
          onDone={onClose}
          textareaRef={textareaRef}
        />
      )}
    </Modal>
  );
}

function noop() {}

function validItems(result: ImportParseResult): ActivityInput[] {
  return result.rows.flatMap((row) =>
    row.ok
      ? [
          {
            name: row.name,
            durationMinutes: row.durationMinutes,
            ...(row.tag === null ? {} : { tag: row.tag }),
          },
        ]
      : [],
  );
}

function ImportForm({
  trip,
  activities,
  onDone,
  textareaRef,
}: {
  trip: ImportTrip;
  activities: readonly Activity[];
  onDone: () => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { canEdit, reason: offlineReason } = useCanEdit();
  const importActivities = useImportActivities(trip.id);
  const saving = importActivities.isPending;
  const limitId = useId();

  const [text, setText] = useState('');
  // Large pastes re-render a long list; let typing stay responsive while it catches up.
  const deferredText = useDeferredValue(text);
  const result = useMemo(() => parseImport(deferredText), [deferredText]);
  const { rows, validCount, invalidCount, exceedsLimit } = result;
  const canImport = validCount > 0 && !exceedsLimit;
  // The colors the DB will assign: the cursor's next colors, or a tag group's colour (FEAT-2).
  const rowColors = useMemo(
    () => previewColors(rows, trip.colorCursor, activities),
    [rows, trip.colorCursor, activities],
  );

  // Separators come from the translation, not from code (M6.1 nit).
  let summary = '';
  if (rows.length > 0) {
    const valid =
      validCount > 0 ? t('import.summary.valid', { count: validCount }) : t('import.summary.none');
    summary =
      invalidCount > 0
        ? t('import.summary.withInvalid', {
            valid,
            invalid: t('import.summary.invalid', { count: invalidCount }),
          })
        : valid;
  }
  const limitMessage = exceedsLimit
    ? t('import.tooMany', { count: validCount, max: MAX_IMPORT_ROWS })
    : '';
  const announcement = useDebouncedValue(
    summary && limitMessage
      ? t('import.announceWithLimit', { summary, limit: limitMessage })
      : summary || limitMessage,
    ANNOUNCE_DELAY_MS,
  );

  // A timed-out import may have been committed anyway (UX-3): say so instead of "nothing added".
  const generalError =
    importActivities.isError && !isAbortedError(importActivities.error)
      ? isTimeoutError(importActivities.error)
        ? t('import.uncertain')
        : t('import.failed', { reason: errorMessage(importActivities.error, t) })
      : null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Parse the current text, not the deferred one, so exactly what the user sees is imported.
    const current = parseImport(text);
    // Offline nothing is imported (M7.3): the button is disabled, and Enter must not slip through.
    if (current.validCount === 0 || current.exceedsLimit || saving || !canEdit) return;
    const items = validItems(current);
    importActivities.reset();
    importActivities.mutate(items, {
      onSuccess: (created) => {
        toast.show(t('import.success', { count: created.length }));
        onDone();
      },
    });
  }

  return (
    <form noValidate onSubmit={handleSubmit} className={MODAL_FORM_CLASS}>
      <OfflineNote />
      {generalError && <FormError>{generalError}</FormError>}
      <AiPromptCopy trip={trip} />
      <Field label={t('import.textLabel')}>
        <Textarea
          ref={textareaRef}
          value={text}
          readOnly={saving}
          spellCheck={false}
          autoComplete="off"
          placeholder={t('import.placeholder')}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>

      {/* Announced after typing pauses; the visible summary below updates at once. */}
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {rows.length === 0 ? (
        <p className="mt-0 mb-3 text-[13.5px] text-ink-soft">{t('import.empty')}</p>
      ) : (
        <p className="mt-0 mb-3 text-[13.5px] font-medium text-ink-soft">{summary}</p>
      )}
      {exceedsLimit && (
        <p
          id={limitId}
          className="mt-0 mb-3 rounded-xl bg-danger/40 px-3 py-2 text-[13.5px] leading-relaxed text-danger-ink"
        >
          {limitMessage}
        </p>
      )}

      {rows.length > 0 && (
        <ul
          aria-label={t('import.previewLabel')}
          className="m-0 mb-3 max-h-[220px] list-none overflow-auto rounded-xl border border-line p-0"
        >
          {rows.map((row, index) => {
            if (row.ok) {
              const color = rowColors[index] ?? undefined;
              return (
                <li
                  key={index}
                  className="flex items-center gap-2 border-b border-line px-3 py-[7px] text-[13.5px] last:border-b-0"
                >
                  <span
                    aria-hidden="true"
                    className="size-3.5 shrink-0 rounded border border-line-strong"
                    style={{ backgroundColor: color }}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium" title={row.name}>
                    {row.name}
                  </span>
                  {row.tag !== null && (
                    <span
                      className="max-w-[35%] shrink truncate rounded-full bg-accent-soft px-2 text-[12px] leading-[1.6] text-accent-ink"
                      title={row.tag}
                    >
                      <span className="sr-only">{t('import.tagPrefix')} </span>
                      {row.tag}
                    </span>
                  )}
                  <span className="text-[12.5px] whitespace-nowrap text-ink-soft">
                    {formatDurationHe(row.durationMinutes)}
                    {row.rounded && ` ${t('import.rounded')}`}
                  </span>
                </li>
              );
            }
            return (
              <li
                key={index}
                className="flex items-center gap-2 border-b border-line bg-danger/15 px-3 py-[7px] text-[13.5px] text-danger-ink last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className="grid size-3.5 shrink-0 place-items-center rounded border border-line-strong bg-panel text-[10px] leading-none"
                >
                  ✕
                </span>
                <span className="sr-only">{t('import.invalidRow')}</span>
                <span className="min-w-0 flex-1 truncate" title={row.raw}>
                  {row.raw}
                </span>
                <span className="max-w-[55%] shrink-0 text-[12.5px] leading-snug">
                  {t(IMPORT_REASON_KEYS[row.reason], { max: ACTIVITY_NAME_MAX, tagMax: TAG_MAX })}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <ModalActions className="mt-5">
        <Button
          type="submit"
          variant="primary"
          loading={saving}
          disabled={!canImport || !canEdit}
          title={offlineReason}
          aria-describedby={exceedsLimit ? limitId : undefined}
        >
          {canImport ? t('import.submit', { count: validCount }) : t('import.submitNone')}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={saving}>
          {t('common.cancel')}
        </Button>
      </ModalActions>
    </form>
  );
}

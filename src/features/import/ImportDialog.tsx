import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
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
import type { ImportedActivity } from '@/data';
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
  IMPORT_TYPES,
  MAX_IMPORT_ROWS,
  minuteLabel,
  parseImport,
  planImportPlacements,
  TAG_MAX,
  toEpochDay,
  type Activity,
  type ImportRow,
  type ImportRowPlan,
  type ImportType,
  type Trip,
  type TripWithActivities,
} from '@/domain';
import { tripKeys } from '@/features/trips';
import { errorMessage, isAbortedError, isTimeoutError } from '@/i18n/errors';
import { AiPromptCopy } from './AiPromptCopy';
import { importMutationKeys, useImportActivities } from './hooks';
import {
  buildImportRequest,
  countDestinations,
  serverRowPlans,
  unexpectedlyBanked,
} from './importOutcome';
import { bankReasonText, IMPORT_REASON_KEYS } from './importReasons';
import { previewColors } from './previewColors';
import { useDebouncedValue } from './useDebouncedValue';
import { useImportType } from './useImportType';

/** Delay before the counts are announced to screen readers, so typing is not interrupted. */
const ANNOUNCE_DELAY_MS = 500;
/** A toast that explains why rows were not placed needs more reading time than the default. */
const LONG_TOAST_MS = 6000;

export interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * The trip to import into: its color cursor gives the preview colors (FR-6.4); its name and
   * dates go into the AI prompt (FEAT-2); its window places the rows (FEAT-3).
   */
  trip: ImportTrip;
  /**
   * All of the trip's activities: a tag they already use gives the preview its group colour
   * (FEAT-2), and placed ones block the slots a row asks for (FEAT-3).
   */
  activities?: readonly Activity[];
}

type ImportTrip = Pick<Trip, 'id' | 'colorCursor' | 'name' | 'window'>;

const NO_ACTIVITIES: readonly Activity[] = [];

/**
 * "Import list" dialog (FR-6.1–FR-6.5, FEAT-3): choose what to import, paste text, see a live
 * preview of the parsed rows (valid rows with color, duration and, for the placement type, where
 * each one goes; invalid rows with the reason) and add the valid rows in one call. More than
 * `MAX_IMPORT_ROWS` valid rows blocks the whole import (DEC-015).
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

/** `יום 2 · 09:30–12:30` for a planned or placed row. */
function placedText(
  plan: Extract<ImportRowPlan, { placement: unknown }>,
  durationMinutes: number,
  window: Trip['window'],
  t: TFunction,
): string {
  const { date, startMinute } = plan.placement;
  const day = toEpochDay(date) - toEpochDay(window.startDate) + 1;
  const time = `${minuteLabel(startMinute)}–${minuteLabel(startMinute + durationMinutes)}`;
  return t('import.destination.placed', { day, time });
}

/** Where a valid row goes (FEAT-3, placement type only). */
function Destination({
  row,
  plan,
  window,
}: {
  row: Extract<ImportRow, { ok: true }>;
  plan: ImportRowPlan;
  window: Trip['window'];
}) {
  const { t } = useTranslation();
  // Aligned under the name: chip (14 px) + gap (8 px).
  const base = 'basis-full ps-[22px] text-[12.5px] leading-snug';
  if ('placement' in plan) {
    return (
      <span className={`${base} font-medium text-accent-ink`}>
        {placedText(plan, row.durationMinutes, window, t)}
        {row.placement?.startRounded && ` ${t('import.destination.startRounded')}`}
      </span>
    );
  }
  const reason = bankReasonText(plan, t);
  return (
    <span className={`${base} text-ink-soft`}>
      {reason === null
        ? t('import.destination.bank')
        : t('import.destination.bankWithReason', { reason })}
    </span>
  );
}

function ImportTypeChoice({
  value,
  onChange,
  disabled,
}: {
  value: ImportType;
  onChange: (type: ImportType) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const baseId = useId();
  const legendId = `${baseId}-legend`;
  return (
    <fieldset
      role="radiogroup"
      aria-labelledby={legendId}
      className="m-0 mb-3.5 min-w-0 border-0 p-0"
      disabled={disabled}
    >
      <legend id={legendId} className="mb-2 p-0 text-[13.5px] font-medium text-ink-soft">
        {t('import.type.legend')}
      </legend>
      <div className="flex flex-col gap-1.5">
        {IMPORT_TYPES.map((type) => {
          const titleId = `${baseId}-${type}`;
          const descriptionId = `${baseId}-${type}-description`;
          return (
            <label
              key={type}
              className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-field)] border border-line-strong px-3 py-2 text-sm transition-colors has-checked:border-accent-strong has-checked:bg-accent-soft has-focus-visible:ring-2 has-focus-visible:ring-accent-soft has-disabled:cursor-default"
            >
              <input
                type="radio"
                name={baseId}
                value={type}
                checked={value === type}
                onChange={() => onChange(type)}
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                className="m-0 mt-0.5 size-4 shrink-0 accent-accent-ink"
              />
              <span className="min-w-0">
                <span id={titleId} className="block font-medium">
                  {t(`import.type.${type}.label`)}
                </span>
                <span
                  id={descriptionId}
                  className="block text-[12.5px] leading-relaxed text-ink-soft"
                >
                  {t(`import.type.${type}.description`)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
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
  const queryClient = useQueryClient();
  const { canEdit, reason: offlineReason } = useCanEdit();
  const importActivities = useImportActivities(trip.id);
  const saving = importActivities.isPending;
  const limitId = useId();
  const hintId = useId();
  const [type, setType] = useImportType();
  const placing = type === 'placement';

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
  // Where each row will go (FEAT-3); placement fields are ignored for the other types.
  const plans = useMemo(
    () => (placing ? planImportPlacements(trip, activities, rows) : null),
    [placing, trip, activities, rows],
  );
  const destinations = plans ? countDestinations(plans) : null;

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
  // A part whose count is 0 is left out ("שתיים ישובצו", not "שתיים ישובצו, 0 למאגר").
  let placementSummary = '';
  if (destinations && validCount > 0) {
    const placed =
      destinations.placed > 0
        ? t('import.placementSummary.placed', { count: destinations.placed })
        : '';
    const bank =
      destinations.banked > 0
        ? t('import.placementSummary.bank', { count: destinations.banked })
        : '';
    placementSummary =
      placed && bank ? t('import.placementSummary.line', { placed, bank }) : placed || bank;
  }
  const limitMessage = exceedsLimit
    ? t('import.tooMany', { count: validCount, max: MAX_IMPORT_ROWS })
    : '';
  const fullSummary = [summary, placementSummary].filter(Boolean).join('. ');
  const announcement = useDebouncedValue(
    fullSummary && limitMessage
      ? t('import.announceWithLimit', { summary: fullSummary, limit: limitMessage })
      : fullSummary || limitMessage,
    ANNOUNCE_DELAY_MS,
  );

  // A timed-out import may have been committed anyway (UX-3): say so instead of "nothing added".
  const generalError =
    importActivities.isError && !isAbortedError(importActivities.error)
      ? isTimeoutError(importActivities.error)
        ? t('import.uncertain')
        : t('import.failed', { reason: errorMessage(importActivities.error, t) })
      : null;

  /**
   * The toast after an import (FEAT-3): the server's outcome is authoritative. When it banked rows
   * the preview had placed (the timetable changed meanwhile), the toast says so.
   */
  function successToast(
    current: readonly ImportRow[],
    rowIndexes: readonly number[],
    outcomes: readonly ImportedActivity[],
    previewPlans: readonly (ImportRowPlan | null)[] | null,
  ) {
    const count = outcomes.length;
    // An unexpected overlap may be with an activity the dialog never saw (another device): the
    // trip cache may know its name by now.
    const cached = queryClient.getQueryData<TripWithActivities>(tripKeys.detail(trip.id));
    const known = cached ? [...activities, ...cached.activities] : activities;
    const server = serverRowPlans(current, { rowIndexes }, outcomes, known);
    const { placed, banked } = countDestinations(server);
    let message: string;
    if (placed === 0) message = t('import.success', { count });
    else if (banked === 0) message = t('import.successPlaced', { count });
    else {
      message = t('import.successMixed', {
        count,
        placed: t('import.successParts.placed', { count: placed }),
        bank: t('import.successParts.bank', { count: banked }),
      });
    }
    const surprises = previewPlans ? unexpectedlyBanked(previewPlans, server) : [];
    if (surprises.length === 0) {
      toast.show(message);
      return;
    }
    let note: string;
    const [only] = surprises;
    const row = only === undefined ? undefined : current[only];
    const plan = only === undefined ? undefined : server[only];
    if (surprises.length === 1 && row?.ok && plan) {
      note = t('import.serverChanged.one', {
        name: row.name,
        reason: bankReasonText(plan, t) ?? t('import.destination.bank'),
      });
    } else {
      note = t('import.serverChanged.several', { count: surprises.length });
    }
    toast.show(t('import.serverChanged.line', { message, note }), { durationMs: LONG_TOAST_MS });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Parse the current text, not the deferred one, so exactly what the user sees is imported.
    const current = parseImport(text);
    // Offline nothing is imported (M7.3): the button is disabled, and Enter must not slip through.
    if (current.validCount === 0 || current.exceedsLimit || saving || !canEdit) return;
    const request = buildImportRequest(current.rows, type, trip.window);
    const previewPlans = placing ? planImportPlacements(trip, activities, current.rows) : null;
    importActivities.reset();
    importActivities.mutate(request.items, {
      onSuccess: (outcomes) => {
        successToast(current.rows, request.rowIndexes, outcomes, previewPlans);
        onDone();
      },
    });
  }

  const submitLabel = !canImport
    ? t('import.submitNone')
    : destinations && destinations.placed > 0
      ? t('import.submitPlacement', { count: validCount })
      : t('import.submit', { count: validCount });

  return (
    <form noValidate onSubmit={handleSubmit} className={MODAL_FORM_CLASS}>
      <OfflineNote />
      {generalError && <FormError>{generalError}</FormError>}
      <ImportTypeChoice value={type} onChange={setType} disabled={saving} />
      <p id={hintId} className="mt-0 mb-3.5 text-[13.5px] leading-relaxed text-ink-soft">
        <Trans
          i18nKey={`import.formatHint.${type}`}
          components={{ code: <code className="rounded bg-accent-soft px-1 text-accent-ink" /> }}
        />
      </p>
      <AiPromptCopy trip={trip} type={type} />
      <Field label={t('import.textLabel')}>
        <Textarea
          ref={textareaRef}
          value={text}
          readOnly={saving}
          spellCheck={false}
          autoComplete="off"
          placeholder={t(`import.placeholder.${type}`)}
          aria-describedby={hintId}
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
        <p className="mt-0 mb-3 text-[13.5px] font-medium text-ink-soft">
          {summary}
          {placementSummary && (
            <>
              <br />
              <span className="text-accent-ink">{placementSummary}</span>
            </>
          )}
        </p>
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
          // A long preview scrolls: focusable so keyboard users can scroll it (WCAG 2.1.1).
          tabIndex={0}
          className="m-0 mb-3 max-h-[220px] list-none overflow-auto rounded-xl border border-line p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
        >
          {rows.map((row, index) => {
            if (row.ok) {
              const color = rowColors[index] ?? undefined;
              const plan = plans?.[index] ?? null;
              return (
                <li
                  key={index}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-line px-3 py-[7px] text-[13.5px] last:border-b-0"
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
                  {plan && <Destination row={row} plan={plan} window={trip.window} />}
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
          {submitLabel}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={saving}>
          {t('common.cancel')}
        </Button>
      </ModalActions>
    </form>
  );
}

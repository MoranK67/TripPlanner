import { useIsMutating } from '@tanstack/react-query';
import { lazy, Suspense, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Field,
  FormError,
  Input,
  LoadingState,
  Modal,
  OfflineNote,
  TimeInput,
  useCanEdit,
  useToast,
} from '@/components/ui';
import { isAppError } from '@/data';
import {
  formatLongDate,
  isValidTripName,
  localIsoDate,
  MAX_END_MINUTE,
  MAX_START_MINUTE,
  MIN_END_MINUTE,
  TRIP_NAME_MAX,
  tripDayCount,
  type Minute,
  type Trip,
} from '@/domain';
import { errorMessage, isAbortedError } from '@/i18n/errors';
import { tripMutationKeys, useCreateTrip, useUpdateTripWindow } from './hooks';
import {
  DEFAULT_END_MINUTE,
  DEFAULT_START_MINUTE,
  defaultRange,
  isTripWindowError,
  tripWindowFormError,
  windowFromForm,
  type DayRange,
  type TripWindowFormError,
} from './tripForm';

// The calendar (react-day-picker + date-fns locale) loads only when a trip dialog first opens.
const TripRangeCalendar = lazy(() =>
  import('./TripRangeCalendar').then((m) => ({ default: m.TripRangeCalendar })),
);

export interface TripDialogProps {
  open: boolean;
  onClose: () => void;
  /** The trip to edit. Omit to create a new trip (which then opens). */
  trip?: Trip;
}

/**
 * Create / edit a trip (FR-2.2–FR-2.6): name, one range calendar for the days and start / end
 * typed start / end times rounded to the 30-minute grid (UX-5). Rules come from `validateTripWindow`; messages are inline.
 * Mounted fresh each time it opens, so it always starts from the trip's current values.
 */
export function TripDialog({ open, onClose, trip }: TripDialogProps) {
  const { t } = useTranslation();
  // While saving, the dialog cannot be closed: its toast, navigation and error report need it.
  const saving =
    useIsMutating({ mutationKey: trip ? tripMutationKeys.update : tripMutationKeys.create }) > 0;
  return (
    <Modal
      open={open}
      onClose={saving ? noop : onClose}
      closeOnBackdrop={!saving}
      showCloseButton={!saving}
      title={trip ? t('trips.dialog.editTitle') : t('trips.dialog.newTitle')}
    >
      {open && <TripForm trip={trip} onDone={onClose} onCancel={onClose} />}
    </Modal>
  );
}

function noop() {}

/** Which control shows a window problem. */
function windowErrorTarget(error: TripWindowFormError | null) {
  if (error === 'end_not_after_start' || error === 'invalid_end_minute') return 'end';
  if (error === 'invalid_start_minute') return 'start';
  return error ? 'calendar' : null;
}

function TripForm({
  trip,
  onDone,
  onCancel,
}: {
  trip?: Trip;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { canEdit, reason: offlineReason } = useCanEdit();
  const createTrip = useCreateTrip();
  const updateTrip = useUpdateTripWindow();
  const mutation = trip ? updateTrip : createTrip;

  const [name, setName] = useState(trip?.name ?? '');
  const [range, setRange] = useState<DayRange>(() =>
    trip
      ? { from: trip.window.startDate, to: trip.window.endDate }
      : defaultRange(localIsoDate(new Date())),
  );
  // `null` while the typed time is not valid (UX-5); saving is blocked then.
  const [startMinute, setStartMinute] = useState<Minute | null>(
    trip?.window.startMinute ?? DEFAULT_START_MINUTE,
  );
  const [endMinute, setEndMinute] = useState<Minute | null>(
    trip?.window.endMinute ?? DEFAULT_END_MINUTE,
  );
  const [submitted, setSubmitted] = useState(false);

  const baseId = useId();
  const calendarLabelId = `${baseId}-calendar-label`;
  const calendarHintId = `${baseId}-calendar-hint`;
  const calendarErrorId = `${baseId}-calendar-error`;
  const nameRef = useRef<HTMLInputElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

  // FR-2.2: an empty name becomes the default name.
  const finalName = name.trim() === '' ? t('trips.dialog.defaultName') : name.trim();
  const nameInvalid = !isValidTripName(finalName);
  // Cross-field rules apply once both typed times are valid (the fields show their own errors).
  const windowError =
    startMinute === null || endMinute === null
      ? null
      : tripWindowFormError(range, startMinute, endMinute);

  // A server-side validation reason is shown at the same place as the client check.
  const serverReason =
    mutation.isError && isAppError(mutation.error) && mutation.error.kind === 'validation'
      ? mutation.error.reason
      : null;
  const serverWindowError = isTripWindowError(serverReason) ? serverReason : null;
  const shownWindowError = submitted ? (windowError ?? serverWindowError) : null;
  const shownNameError = submitted && (nameInvalid || serverReason === 'name');
  const generalError =
    mutation.isError &&
    !isAbortedError(mutation.error) &&
    serverWindowError === null &&
    serverReason !== 'name'
      ? errorMessage(mutation.error, t)
      : null;

  const errorTarget = windowErrorTarget(shownWindowError);
  const windowMessage = shownWindowError ? t(`trips.dialog.errors.${shownWindowError}`) : null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    mutation.reset();
    if (nameInvalid) {
      nameRef.current?.focus();
      return;
    }
    if (startMinute === null) {
      startRef.current?.focus();
      return;
    }
    if (endMinute === null) {
      endRef.current?.focus();
      return;
    }
    const target = windowErrorTarget(windowError);
    if (target) {
      ({ calendar: calendarRef, start: startRef, end: endRef })[target].current?.focus();
      return;
    }
    const window = windowFromForm(range, startMinute, endMinute);
    if (!window) return;
    // Offline the save button is disabled; Enter in a field must not start a write either (M7.3).
    if (!canEdit) return;
    const input = { name: finalName, window };

    if (trip) {
      updateTrip.mutate(
        { tripId: trip.id, input },
        {
          onSuccess: ({ movedCount }) => {
            // FR-2.6: say how many activities left the timetable.
            if (movedCount > 0) toast.show(t('trips.movedToBank', { count: movedCount }));
            onDone();
          },
        },
      );
    } else {
      createTrip.mutate(input, {
        onSuccess: (created) => {
          onDone();
          navigate(`/trips/${created.id}`);
        },
      });
    }
  }

  const selectedSummary =
    range.from && range.to
      ? t('trips.dialog.selected', {
          start: formatLongDate(range.from),
          end: formatLongDate(range.to),
          days: t('trips.days', {
            count: tripDayCount({
              startDate: range.from,
              startMinute: startMinute ?? 0,
              endDate: range.to,
              endMinute: endMinute ?? MAX_END_MINUTE,
            }),
          }),
        })
      : range.from
        ? t('trips.dialog.selectedStart', { start: formatLongDate(range.from) })
        : t('trips.dialog.selectedNone');

  return (
    <form noValidate onSubmit={handleSubmit}>
      <OfflineNote />
      {generalError && <FormError>{generalError}</FormError>}
      <Field
        label={t('trips.dialog.name')}
        error={shownNameError ? t('trips.dialog.errors.name', { max: TRIP_NAME_MAX }) : undefined}
      >
        <Input
          ref={nameRef}
          value={name}
          maxLength={TRIP_NAME_MAX}
          autoComplete="off"
          placeholder={t('trips.dialog.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <div className="mb-3.5">
        <span id={calendarLabelId} className="mb-1.5 block text-[13px] font-medium text-ink-soft">
          {t('trips.dialog.dates')}
        </span>
        <Suspense fallback={<LoadingState className="h-[300px]" />}>
          <TripRangeCalendar
            ref={calendarRef}
            value={range}
            onChange={setRange}
            labelledBy={calendarLabelId}
            describedBy={
              errorTarget === 'calendar' ? `${calendarHintId} ${calendarErrorId}` : calendarHintId
            }
            invalid={errorTarget === 'calendar'}
          />
        </Suspense>
        <p
          id={calendarHintId}
          aria-live="polite"
          className="mt-1.5 mb-0 text-[12.5px] leading-relaxed text-ink-soft"
        >
          {selectedSummary}
        </p>
        {errorTarget === 'calendar' && (
          <p id={calendarErrorId} className="mt-1.5 mb-0 text-[13px] text-danger-ink">
            {windowMessage}
          </p>
        )}
      </div>

      <div className="flex gap-2.5 [&>*]:min-w-0 [&>*]:flex-1">
        <TimeInput
          ref={startRef}
          label={t('trips.dialog.startTime')}
          hint={t('trips.dialog.startTimeHint')}
          value={startMinute}
          min={0}
          max={MAX_START_MINUTE}
          onChange={setStartMinute}
          showErrors={submitted}
          error={errorTarget === 'start' ? windowMessage : undefined}
        />
        <TimeInput
          ref={endRef}
          label={t('trips.dialog.endTime')}
          hint={t('trips.dialog.endTimeHint')}
          value={endMinute}
          min={MIN_END_MINUTE}
          max={MAX_END_MINUTE}
          onChange={setEndMinute}
          showErrors={submitted}
          error={errorTarget === 'end' ? windowMessage : undefined}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          loading={mutation.isPending}
          disabled={!canEdit}
          title={offlineReason}
        >
          {trip ? t('common.save') : t('trips.dialog.create')}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={mutation.isPending}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

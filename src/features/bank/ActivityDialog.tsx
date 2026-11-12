import { useIsMutating } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  ColorSwatches,
  Field,
  FormError,
  Input,
  Modal,
  Select,
  useToast,
} from '@/components/ui';
import { isAppError } from '@/data';
import {
  ACTIVITY_NAME_MAX,
  formatDurationHe,
  isValidActivityName,
  MAX_ACTIVITY_MINUTES,
  MIN_ACTIVITY_MINUTES,
  normalizeHexColor,
  paletteColorAt,
  SLOT_MINUTES,
  type Activity,
  type ActivityPatch,
} from '@/domain';
import { errorMessage, isAbortedError } from '@/i18n/errors';
import { activityMutationKeys, useCreateActivity, useUpdateActivity } from './hooks';

/** Default duration of a new activity (prototype: one hour). */
export const DEFAULT_DURATION_MINUTES = 60;

/** Duration options: 30 min – 24 h on the 30-minute grid (FR-3.1). */
function durationOptions(): number[] {
  const result: number[] = [];
  for (let m = MIN_ACTIVITY_MINUTES; m <= MAX_ACTIVITY_MINUTES; m += SLOT_MINUTES) result.push(m);
  return result;
}

export interface ActivityDialogProps {
  open: boolean;
  onClose: () => void;
  tripId: string;
  /** The trip's color cursor: a new activity previews `paletteColorAt(colorCursor)` (FR-3.2). */
  colorCursor: number;
  /** The activity to edit. Omit to add a new one to the bank. */
  activity?: Activity;
}

/** Add / edit an activity (FR-3.1, FR-3.2, FR-3.5). */
export function ActivityDialog({
  open,
  onClose,
  tripId,
  colorCursor,
  activity,
}: ActivityDialogProps) {
  const { t } = useTranslation();
  // While saving, the dialog cannot be closed: its toast and error report need it.
  const saving =
    useIsMutating({
      mutationKey: activity
        ? activityMutationKeys.update(tripId)
        : activityMutationKeys.create(tripId),
    }) > 0;
  return (
    <Modal
      open={open}
      onClose={saving ? noop : onClose}
      closeOnBackdrop={!saving}
      showCloseButton={!saving}
      title={activity ? t('bank.dialog.editTitle') : t('bank.dialog.newTitle')}
    >
      {open && (
        <ActivityForm
          tripId={tripId}
          colorCursor={colorCursor}
          activity={activity}
          onDone={onClose}
        />
      )}
    </Modal>
  );
}

function noop() {}

function ActivityForm({
  tripId,
  colorCursor,
  activity,
  onDone,
}: {
  tripId: string;
  colorCursor: number;
  activity?: Activity;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const createActivity = useCreateActivity(tripId);
  const updateActivity = useUpdateActivity(tripId);
  const mutation = activity ? updateActivity : createActivity;

  const defaultColor = paletteColorAt(colorCursor);
  const [name, setName] = useState(activity?.name ?? '');
  const [duration, setDuration] = useState(activity?.durationMinutes ?? DEFAULT_DURATION_MINUTES);
  const [color, setColor] = useState<string>(
    activity ? normalizeHexColor(activity.color) : defaultColor,
  );
  const [submitted, setSubmitted] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const trimmed = name.trim();
  const nameError =
    trimmed === ''
      ? t('bank.dialog.errors.nameRequired')
      : !isValidActivityName(trimmed)
        ? t('bank.dialog.errors.nameTooLong', { max: ACTIVITY_NAME_MAX })
        : null;

  const serverReason =
    mutation.isError && isAppError(mutation.error) && mutation.error.kind === 'validation'
      ? mutation.error.reason
      : null;
  const shownNameError = submitted
    ? (nameError ?? (serverReason === 'name' ? t('bank.dialog.errors.nameInvalid') : null))
    : null;
  // Field problems are shown at the field; anything else (network, not found, …) above the form.
  const generalError =
    mutation.isError && !isAbortedError(mutation.error) && serverReason !== 'name'
      ? errorMessage(mutation.error, t)
      : null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    mutation.reset();
    if (nameError) {
      nameRef.current?.focus();
      return;
    }
    if (activity) {
      const patch: ActivityPatch = { name: trimmed, durationMinutes: duration, color };
      updateActivity.mutate(
        { id: activity.id, patch },
        {
          onSuccess: ({ returnedToBank }) => {
            // FR-3.6: the longer activity no longer fitted its slot in the timetable.
            if (returnedToBank) toast.show(t('bank.returnedToBank'));
            onDone();
          },
        },
      );
    } else {
      // Unchanged default color: let the DB assign it from the cursor (DEC-019), so two devices
      // adding at the same time still get consecutive colors.
      createActivity.mutate(
        { name: trimmed, durationMinutes: duration, ...(color === defaultColor ? {} : { color }) },
        { onSuccess: onDone },
      );
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit}>
      {generalError && <FormError>{generalError}</FormError>}
      <Field label={t('bank.dialog.name')} error={shownNameError}>
        <Input
          ref={nameRef}
          value={name}
          maxLength={ACTIVITY_NAME_MAX}
          autoComplete="off"
          placeholder={t('bank.dialog.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label={t('bank.dialog.duration')}>
        <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
          {durationOptions().map((m) => (
            <option key={m} value={m}>
              {formatDurationHe(m)}
            </option>
          ))}
        </Select>
      </Field>
      <ColorSwatches
        label={t('bank.dialog.color')}
        value={color}
        onChange={setColor}
        className="mb-3.5"
      />
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" loading={mutation.isPending}>
          {activity ? t('common.save') : t('bank.dialog.add')}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={mutation.isPending}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

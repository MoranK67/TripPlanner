import { useIsMutating } from '@tanstack/react-query';
import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  ColorSwatches,
  cx,
  Field,
  FormError,
  Input,
  Modal,
  MODAL_FORM_CLASS,
  ModalActions,
  OfflineNote,
  PALETTE_COLOR_KEYS,
  Select,
  TimeInput,
  useCanEdit,
  useToast,
} from '@/components/ui';
import { isAppError } from '@/data';
import {
  ACTIVITY_NAME_MAX,
  activityToDialogPlacement,
  canPlace,
  dayBounds,
  durationToEnd,
  formatShortDate,
  formatWeekday,
  isValidActivityName,
  MAX_ACTIVITY_MINUTES,
  MAX_END_MINUTE,
  MAX_START_MINUTE,
  MIN_ACTIVITY_MINUTES,
  MIN_END_MINUTE,
  minuteLabel,
  normalizeHexColor,
  normalizeTag,
  PALETTE,
  paletteColorAt,
  rangeToDuration,
  SLOT_MINUTES,
  TAG_MAX,
  tagColor,
  tagKey,
  tripDays,
  tripTags,
  validateDialogPlacement,
  validateTag,
  type Activity,
  type ActivityInput,
  type ActivityPatch,
  type DialogPlacementCheck,
  type IsoDate,
  type Minute,
  type Placement,
  type Trip,
} from '@/domain';
import { activityEditMutationKey, useQueuedActivityUpdate } from '@/features/schedule';
import { createErrorMessage, errorMessage, isAbortedError } from '@/i18n/errors';
import { activityMutationKeys, useCreateActivity } from './hooks';

/** Default duration of a new activity (prototype: one hour). */
export const DEFAULT_DURATION_MINUTES = 60;

export interface ActivityDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * The trip: its window bounds the placement section (FEAT-1) and its color cursor gives a new
   * activity's preview color `paletteColorAt(colorCursor)` (FR-3.2).
   */
  trip: Trip;
  /** All of the trip's activities: overlap checks (FEAT-1) and tag suggestions (FEAT-2). */
  activities: readonly Activity[];
  /** The activity to edit. Omit to add a new one. */
  activity?: Activity;
}

/** Add / edit an activity (FR-3.1, FR-3.2, FR-3.5), its tag (FEAT-2) and placement (FEAT-1). */
export function ActivityDialog({ open, onClose, trip, activities, activity }: ActivityDialogProps) {
  const { t } = useTranslation();
  // While saving, the dialog cannot be closed: its toast and error report need it. A new activity
  // with a placement is created first and then placed, so both count.
  const creating = useIsMutating({ mutationKey: activityMutationKeys.create(trip.id) }) > 0;
  const editing = useIsMutating({ mutationKey: activityEditMutationKey(trip.id) }) > 0;
  const saving = creating || editing;
  return (
    <Modal
      open={open}
      onClose={saving ? noop : onClose}
      closeOnBackdrop={!saving}
      showCloseButton={!saving}
      title={activity ? t('bank.dialog.editTitle') : t('bank.dialog.newTitle')}
    >
      {open && (
        <ActivityForm trip={trip} activities={activities} activity={activity} onDone={onClose} />
      )}
    </Modal>
  );
}

function noop() {}

/** Day select value for "not placed" (the bank). */
const UNPLACED = '';

/** Where the search for a free slot starts on a full trip day (not midnight). */
const PREFERRED_DAY_START = 9 * 60;

/**
 * First start on `day` where an activity of `duration` fits (trip hours, no overlap), for the
 * From field when a day is picked: from 09:00 (or the trip start on its first day), else from
 * the day's first slot; the day's first slot if nothing fits.
 */
function firstFreeStart(
  trip: Trip,
  activities: readonly Activity[],
  subjectId: string | null,
  day: IsoDate,
  duration: number,
): Minute {
  const bounds = dayBounds(trip.window, day);
  if (!bounds) return 0;
  const subject = { id: subjectId ?? '', tripId: trip.id, durationMinutes: duration };
  const context = { window: trip.window, activities };
  const preferred = Math.max(bounds.startMinute, PREFERRED_DAY_START);
  for (const from of [preferred, bounds.startMinute]) {
    for (let m = from; m + duration <= bounds.endMinute; m += SLOT_MINUTES) {
      if (canPlace(context, subject, { date: day, startMinute: m }).ok) return m;
    }
  }
  return bounds.startMinute;
}

/**
 * Weekday without the leading "יום" that `Intl` adds in Hebrew ("יום רביעי" → "רביעי"), so the
 * option reads "יום 2 · רביעי 11.3" (spec) instead of repeating "יום".
 */
function shortWeekday(date: IsoDate): string {
  return formatWeekday(date).replace(/^יום\s+/u, '');
}

function samePlacement(a: Placement | null, b: Placement | null): boolean {
  if (a === null || b === null) return a === b;
  return a.date === b.date && a.startMinute === b.startMinute;
}

function ActivityForm({
  trip,
  activities,
  activity,
  onDone,
}: {
  trip: Trip;
  activities: readonly Activity[];
  activity?: Activity;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { canEdit, reason: offlineReason } = useCanEdit();
  const createActivity = useCreateActivity(trip.id);
  const updateActivity = useQueuedActivityUpdate(trip.id);
  const mutation = activity ? updateActivity : createActivity;
  const pending = createActivity.isPending || updateActivity.isPending;
  const subjectId = activity?.id ?? null;
  const tagListId = useId();

  const defaultColor = paletteColorAt(trip.colorCursor);
  const [initialPlacement] = useState(() =>
    activity ? activityToDialogPlacement(activity) : null,
  );
  const [name, setName] = useState(activity?.name ?? '');
  // `null` while the typed duration is not valid (UX-5); saving is blocked then.
  const [duration, setDuration] = useState<number | null>(
    activity?.durationMinutes ?? DEFAULT_DURATION_MINUTES,
  );
  const [color, setColor] = useState<string>(
    activity ? normalizeHexColor(activity.color) : defaultColor,
  );
  const [tagText, setTagText] = useState(activity?.tag ?? '');
  // FEAT-1 placement: Day ('' = in the bank), From / To (minutes, `null` while not valid).
  const [day, setDay] = useState<string>(initialPlacement?.day ?? UNPLACED);
  const [start, setStart] = useState<number | null>(initialPlacement?.startMinute ?? null);
  const [end, setEnd] = useState<number | null>(initialPlacement?.endMinute ?? null);
  const [submitted, setSubmitted] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const tagRef = useRef<HTMLInputElement>(null);
  const durationRef = useRef<HTMLInputElement>(null);
  const durationMessages = {
    empty: t('bank.dialog.errors.durationEmpty'),
    format: t('bank.dialog.errors.durationFormat'),
    below_min: t('bank.dialog.errors.durationMin'),
    above_max: t('bank.dialog.errors.durationMax'),
  };

  const days = useMemo(() => tripDays(trip.window), [trip.window]);
  const tags = useMemo(() => tripTags(activities), [activities]);

  // --- name ---
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

  // --- tag (FEAT-2) ---
  const tag = normalizeTag(tagText);
  const tagProblem = tag === null ? null : validateTag(tag);
  const tagError =
    tagProblem === 'too_long'
      ? t('bank.dialog.errors.tagTooLong', { max: TAG_MAX })
      : tagProblem !== null || serverReason === 'tag'
        ? t('bank.dialog.errors.tagInvalid')
        : null;
  // Joining a tag group takes the group's colour on save (DEC-042): preview it and lock the
  // swatches. Changing the colour of an activity already in the group is allowed.
  const tagChanged = tagKey(tag) !== tagKey(activity?.tag);
  const groupColor =
    tag !== null && tagProblem === null && tagChanged ? tagColor(activities, tag, subjectId) : null;
  const shownColor = groupColor ?? color;
  const groupColorKey = groupColor
    ? PALETTE_COLOR_KEYS[PALETTE.findIndex((c) => c === normalizeHexColor(groupColor))]
    : undefined;
  const groupColorName = groupColorKey ? t(`common.colors.${groupColorKey}`) : (groupColor ?? '');

  // --- placement (FEAT-1) ---
  const placed = day !== UNPLACED;
  const check: DialogPlacementCheck | null =
    placed && start !== null && end !== null
      ? validateDialogPlacement(
          { window: trip.window, activities },
          { id: subjectId, tripId: trip.id },
          { day, startMinute: start, endMinute: end },
        )
      : null;
  // A typed duration that would end after midnight leaves To where it was.
  const pastMidnight =
    placed &&
    start !== null &&
    end !== null &&
    duration !== null &&
    end - start !== duration &&
    start + duration > MAX_END_MINUTE;
  const placementInvalid =
    placed &&
    (check === null ||
      !check.ok ||
      duration === null ||
      (end !== null && start !== null && end - start !== duration));

  let dayError: string | null = null;
  let startError: string | null = null;
  let endError: string | null = null;
  if (check && !check.ok) {
    switch (check.reason) {
      case 'invalid_day':
        dayError = t('bank.dialog.placement.errors.invalid_day');
        break;
      case 'out_of_range': {
        const bounds = dayBounds(trip.window, day);
        startError = t('bank.dialog.placement.errors.out_of_range', {
          start: minuteLabel(bounds?.startMinute ?? 0),
          end: minuteLabel(bounds?.endMinute ?? MAX_END_MINUTE),
        });
        break;
      }
      case 'conflict_overlap': {
        const other = check.conflicts[0];
        endError = other
          ? t('bank.dialog.placement.errors.conflict_overlap', {
              name: other.name,
              time: `${minuteLabel(other.placement.startMinute)}–${minuteLabel(
                other.placement.startMinute + other.durationMinutes,
              )}`,
            })
          : t('errors.kinds.conflict_overlap');
        break;
      }
      default:
        endError = t(`bank.dialog.placement.errors.${check.reason}`);
    }
  }

  // Field problems are shown at the field; anything else (network, overlap, …) above the form.
  const fieldReason = serverReason === 'name' || serverReason === 'tag';
  const generalError =
    mutation.isError && !isAbortedError(mutation.error) && !fieldReason
      ? // A timed-out create may have been saved: ask to check the bank first (UX-3).
        activity
        ? errorMessage(mutation.error, t)
        : createErrorMessage(mutation.error, t)
      : null;

  function changeStart(next: number | null) {
    setStart(next);
    const d = next !== null && end !== null ? rangeToDuration(next, end) : null;
    if (d !== null) setDuration(d);
  }

  function changeEnd(next: number | null) {
    setEnd(next);
    const d = next !== null && start !== null ? rangeToDuration(start, next) : null;
    if (d !== null) setDuration(d);
  }

  function changeDuration(next: number | null) {
    setDuration(next);
    if (!placed || start === null || next === null) return;
    const e = durationToEnd(start, next);
    if (e !== null) setEnd(e);
  }

  function changeDay(next: string) {
    setDay(next);
    if (next === UNPLACED) return;
    // Keep the times when moving to another day; on a first placement, take the first free slot.
    const d = duration ?? DEFAULT_DURATION_MINUTES;
    const s = start ?? firstFreeStart(trip, activities, subjectId, next, d);
    setStart(s);
    const e = durationToEnd(s, d);
    if (e !== null) setEnd(e);
    if (duration === null) setDuration(d);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    mutation.reset();
    if (nameError) {
      nameRef.current?.focus();
      return;
    }
    if (tagProblem !== null) {
      tagRef.current?.focus();
      return;
    }
    if (duration === null || pastMidnight) {
      durationRef.current?.focus();
      return;
    }
    // Save is disabled then (implicit submission is blocked too); each reason is shown at its field.
    if (placementInvalid) return;
    // Offline the save button is disabled; Enter in a field must not start a write either (M7.3).
    if (!canEdit) return;
    const placement: Placement | null =
      placed && start !== null ? { date: day, startMinute: start } : null;

    if (activity) {
      const patch: ActivityPatch = { name: trimmed, durationMinutes: duration, color: shownColor };
      if (tag !== normalizeTag(activity.tag)) patch.tag = tag;
      // Unchanged placement: let the server keep it (a longer activity that no longer fits then
      // returns to the bank, FR-3.6, the only case with the "returned to bank" notice).
      if (!samePlacement(placement, activity.placement)) patch.placement = placement;
      updateActivity.mutate(
        { id: activity.id, patch },
        {
          onSuccess: ({ returnedToBank }) => {
            if (returnedToBank) toast.show(t('bank.returnedToBank'));
            onDone();
          },
        },
      );
      return;
    }

    // Unchanged default color: let the DB assign it from the cursor (DEC-019), so two devices
    // adding at the same time still get consecutive colors. A tag group's colour is the DB's too.
    const input: ActivityInput = {
      name: trimmed,
      durationMinutes: duration,
      ...(color === defaultColor || groupColor !== null ? {} : { color }),
      ...(tag === null ? {} : { tag }),
    };
    createActivity.mutate(input, {
      onSuccess: (created) => {
        if (!placement) {
          onDone();
          return;
        }
        // `create` cannot place: place the new activity in a second, queued request.
        updateActivity.mutate(
          { id: created.id, patch: { placement } },
          {
            onSuccess: onDone,
            onError: (error) => {
              if (!isAbortedError(error)) {
                toast.show(
                  t('bank.dialog.placement.createdNotPlaced', { reason: errorMessage(error, t) }),
                  { tone: 'error' },
                );
              }
              onDone();
            },
          },
        );
      },
    });
  }

  return (
    <form noValidate onSubmit={handleSubmit} className={MODAL_FORM_CLASS}>
      <OfflineNote />
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

      <Field
        label={t('bank.dialog.tag')}
        error={tagError}
        hint={
          groupColor ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block size-3 shrink-0 rounded-full border border-line-strong"
                style={{ backgroundColor: groupColor }}
              />
              {t('bank.dialog.tagGroupColor', { tag, color: groupColorName })}
            </span>
          ) : (
            t('bank.dialog.tagHint')
          )
        }
        className={tags.length > 0 ? 'mb-2' : undefined}
      >
        <Input
          ref={tagRef}
          value={tagText}
          list={tags.length > 0 ? tagListId : undefined}
          autoComplete="off"
          placeholder={t('bank.dialog.tagPlaceholder')}
          onChange={(e) => setTagText(e.target.value)}
        />
      </Field>
      {tags.length > 0 && (
        <>
          <datalist id={tagListId}>
            {tags.map((item) => (
              <option key={item.key} value={item.tag} />
            ))}
          </datalist>
          <div
            role="group"
            aria-label={t('bank.dialog.tagSuggestions')}
            className="mb-3.5 flex flex-wrap gap-1.5"
          >
            {tags.map((item) => {
              const pressed = item.key === tagKey(tag);
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={pressed}
                  // A toggle, like the bank's tag chips: pressing the chosen tag again clears it.
                  onClick={() => setTagText(pressed ? '' : item.tag)}
                  className={cx(
                    'inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[12.5px]',
                    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-ink',
                    pressed
                      ? 'border-accent-strong bg-accent-soft font-semibold text-accent-ink'
                      : 'border-line-strong bg-panel text-ink hover:bg-accent-soft-hover',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full border border-line-strong"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="max-w-40 truncate">{item.tag}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <TimeInput
        ref={durationRef}
        label={t('bank.dialog.duration')}
        hint={t('bank.dialog.durationHint')}
        value={duration}
        min={MIN_ACTIVITY_MINUTES}
        max={MAX_ACTIVITY_MINUTES}
        onChange={changeDuration}
        // While placed, an invalid duration also disables Save: say why at once.
        showErrors={submitted || placed}
        messages={durationMessages}
        error={pastMidnight ? t('bank.dialog.placement.errors.pastMidnight') : undefined}
      />

      <fieldset className="m-0 mb-3.5 min-w-0 rounded-xl border border-line px-3 pt-1 pb-0">
        <legend className="px-1 text-[13px] font-semibold text-ink">
          {t('bank.dialog.placement.legend')}
        </legend>
        <Field label={t('bank.dialog.placement.day')} error={dayError}>
          <Select value={day} onChange={(e) => changeDay(e.target.value)}>
            <option value={UNPLACED}>{t('bank.dialog.placement.unplaced')}</option>
            {days.map((date, i) => (
              <option key={date} value={date}>
                {t('bank.dialog.placement.dayOption', {
                  weekday: shortWeekday(date),
                  date: formatShortDate(date),
                  n: i + 1,
                })}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-x-3">
          <TimeInput
            label={t('bank.dialog.placement.from')}
            value={start}
            min={0}
            max={MAX_START_MINUTE}
            onChange={changeStart}
            // Save is disabled while these are not valid times: always show why.
            showErrors
            error={startError}
            disabled={!placed}
            className="min-w-0"
          />
          <TimeInput
            label={t('bank.dialog.placement.to')}
            value={end}
            min={MIN_END_MINUTE}
            max={MAX_END_MINUTE}
            onChange={changeEnd}
            // Save is disabled while these are not valid times: always show why.
            showErrors
            error={endError}
            disabled={!placed}
            className="min-w-0"
          />
        </div>
      </fieldset>

      <ColorSwatches
        label={t('bank.dialog.color')}
        value={shownColor}
        onChange={setColor}
        disabled={groupColor !== null}
        className={groupColor ? 'mb-1.5' : 'mb-3.5'}
      />
      {groupColor && (
        <p className="mt-0 mb-3.5 text-[12.5px] leading-relaxed text-ink-soft">
          {t('bank.dialog.colorFromTag')}
        </p>
      )}

      <ModalActions className="mt-5">
        <Button
          type="submit"
          variant="primary"
          loading={pending}
          disabled={!canEdit || placementInvalid}
          title={offlineReason}
        >
          {activity ? t('common.save') : t('bank.dialog.add')}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={pending}>
          {t('common.cancel')}
        </Button>
      </ModalActions>
    </form>
  );
}

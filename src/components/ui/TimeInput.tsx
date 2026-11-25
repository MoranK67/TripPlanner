import { forwardRef, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { minuteLabel } from '@/domain';
import { Field } from './Field';
import { Input } from './Input';
import { parseHhmm, type HhmmError } from './parseHhmm';

export interface TimeInputProps {
  /** Visible label of the field. */
  label: ReactNode;
  /** Helper text under the field, e.g. "לדוגמה 0800". */
  hint?: ReactNode;
  /**
   * Current value in minutes, or `null` while the text is invalid (what `onChange` reported).
   * Shown as `HH:MM`. When it changes to a number the typed text does not represent (e.g. a
   * reset by the parent), the text is replaced.
   */
  value: number | null;
  /** Smallest / largest allowed value in minutes, checked after rounding. */
  min: number;
  max: number;
  /** Rounding step in minutes (default: the 30-minute slot). */
  step?: number;
  /** Called on every edit with the rounded minutes, or `null` while the text is not valid. */
  onChange: (minutes: number | null) => void;
  /** Show the field's own parse error even before it was left (e.g. after a submit). */
  showErrors?: boolean;
  /** An error from outside (cross-field rules). Shown when the text itself is valid. */
  error?: ReactNode;
  /** Replaces the default message for a parse error (e.g. "משך מינימלי חצי שעה"). */
  messages?: Partial<Record<HhmmError, string>>;
  /** Field id (see `Field`). */
  id?: string;
  /** Disables the field; it then shows no error (e.g. a time that does not apply right now). */
  disabled?: boolean;
  className?: string;
}

/**
 * Typed time / duration field (UX-5). Accepts `HHMM` and forgiving forms (see `parseHhmm`),
 * rounds to the half hour, and on blur rewrites the text as `HH:MM` with a polite note when it
 * was rounded. LTR digits and a numeric keypad on phones.
 */
export const TimeInput = forwardRef<HTMLInputElement, TimeInputProps>(function TimeInput(
  {
    label,
    hint,
    value,
    min,
    max,
    step,
    onChange,
    showErrors = false,
    error,
    messages,
    id,
    disabled = false,
    className,
  },
  ref,
) {
  const { t } = useTranslation();
  const noteId = `${useId()}-rounded`;
  const [text, setText] = useState(() => (value === null ? '' : minuteLabel(value)));
  const [touched, setTouched] = useState(false);
  const [roundedTo, setRoundedTo] = useState<number | null>(null);
  const [prevValue, setPrevValue] = useState(value);

  const options = step === undefined ? { min, max } : { min, max, step };
  const parsed = parseHhmm(text, options);

  // The parent set a value the text does not show (e.g. a reset): follow it.
  if (value !== prevValue) {
    setPrevValue(value);
    if (value !== null && parsed.minutes !== value) {
      setText(minuteLabel(value));
      setRoundedTo(null);
    }
  }

  const parseError = parsed.error
    ? (messages?.[parsed.error] ??
      t(`common.timeInput.errors.${parsed.error}`, {
        min: minuteLabel(min),
        max: minuteLabel(max),
      }))
    : null;
  const shownError = disabled
    ? null
    : parseError
      ? touched || showErrors
        ? parseError
        : null
      : error;

  function handleChange(next: string) {
    setText(next);
    setRoundedTo(null);
    onChange(parseHhmm(next, options).minutes ?? null);
  }

  function handleBlur() {
    setTouched(true);
    if (parsed.error) return;
    setText(minuteLabel(parsed.minutes));
    setRoundedTo(parsed.rounded ? parsed.minutes : null);
  }

  return (
    <Field label={label} hint={hint} error={shownError} id={id} className={className}>
      <Input
        ref={ref}
        value={text}
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        maxLength={5}
        disabled={disabled}
        className="text-end tabular-nums"
        aria-describedby={roundedTo !== null ? noteId : undefined}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
      />
      <p
        id={noteId}
        aria-live="polite"
        className="mt-1 mb-0 text-[12.5px] leading-relaxed text-ink-soft empty:mt-0"
      >
        {roundedTo !== null ? t('common.timeInput.rounded', { time: minuteLabel(roundedTo) }) : ''}
      </p>
    </Field>
  );
});

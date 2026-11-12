import { useId, useMemo, type ReactNode } from 'react';
import { cx } from './cx';
import { FieldContext, type FieldContextValue } from './fieldContext';

export interface FieldProps {
  /** Visible label, linked to the control with `htmlFor`. */
  label: ReactNode;
  /** Helper text under the control; linked with `aria-describedby`. */
  hint?: ReactNode;
  /**
   * Validation message. When set, the control gets `aria-invalid` and the message is linked via
   * `aria-describedby` only (no live region, to avoid announcing on every keystroke).
   * Convention: on submit, forms must move focus to the first invalid field so the error is read.
   */
  error?: ReactNode;
  /** Marks the control `required` and shows a visual marker. */
  required?: boolean;
  /**
   * Id for the control. Generated when omitted. Put a custom id here, not on the control —
   * the Field's id overrides any id set on the control so the label always matches.
   */
  id?: string;
  className?: string;
  /** A single Input / Select / Textarea (or any control using `useFieldControlProps`). */
  children: ReactNode;
}

/**
 * Label + control + hint + error with accessible wiring.
 * The control picks up id / aria-describedby / aria-invalid / required from context,
 * so callers write `<Field label="…"><Input /></Field>` and nothing else.
 * Need a specific id? Use `<Field id="trip-name">`, never `<Input id>` inside a Field.
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  id,
  className,
  children,
}: FieldProps) {
  const generatedId = useId();
  const controlId = id ?? `field-${generatedId}`;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const hasHint = hint != null && hint !== false && hint !== '';
  const hasError = error != null && error !== false && error !== '';

  const value = useMemo<FieldContextValue>(
    () => ({
      controlId,
      describedBy: [hasHint && hintId, hasError && errorId].filter(Boolean).join(' ') || undefined,
      invalid: hasError,
      required,
    }),
    [controlId, hasHint, hintId, hasError, errorId, required],
  );

  return (
    <div className={cx('mb-3.5 block', className)}>
      <label htmlFor={controlId} className="mb-1.5 block text-[13px] font-medium text-ink-soft">
        {label}
        {required && (
          <span aria-hidden="true" className="ms-0.5 text-danger-ink">
            *
          </span>
        )}
      </label>
      <FieldContext.Provider value={value}>{children}</FieldContext.Provider>
      {hasHint && (
        <p id={hintId} className="mt-1.5 mb-0 text-[12.5px] leading-relaxed text-ink-soft">
          {hint}
        </p>
      )}
      {hasError && (
        <p id={errorId} className="mt-1.5 mb-0 text-[13px] text-danger-ink">
          {error}
        </p>
      )}
    </div>
  );
}

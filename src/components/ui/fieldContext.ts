import { createContext, useContext } from 'react';

/** Wiring that <Field> hands to the control inside it (Input / Select / Textarea). */
export interface FieldContextValue {
  controlId: string;
  /** Space-separated ids of the hint and error elements, or undefined if there are none. */
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

export const FieldContext = createContext<FieldContextValue | null>(null);

interface ControlA11yProps {
  id?: string | undefined;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling' | undefined;
  required?: boolean | undefined;
}

/**
 * Merges the surrounding <Field>'s id / describedby / invalid / required into a control's props.
 * The Field's id always wins (the <label htmlFor> points at it) — set `id` on the Field, not on
 * the control. Explicit `aria-invalid` / `required` on the control win; `aria-describedby` is
 * concatenated.
 */
export function useFieldControlProps<P extends ControlA11yProps>(props: P): P {
  const field = useContext(FieldContext);
  if (!field) return props;
  const describedBy =
    [field.describedBy, props['aria-describedby']].filter(Boolean).join(' ') || undefined;
  return {
    ...props,
    id: field.controlId,
    'aria-describedby': describedBy,
    'aria-invalid': props['aria-invalid'] ?? (field.invalid || undefined),
    required: props.required ?? (field.required || undefined),
  };
}

import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { controlClass } from './controlStyles';
import { cx } from './cx';
import { useFieldControlProps } from './fieldContext';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Multi-line text input (used by the text import dialog). */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(props, ref) {
    const { className, ...rest } = useFieldControlProps(props);
    return (
      <textarea
        ref={ref}
        className={cx(controlClass, 'min-h-32 resize-y text-sm leading-relaxed', className)}
        {...rest}
      />
    );
  },
);

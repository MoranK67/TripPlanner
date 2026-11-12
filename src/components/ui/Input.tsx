import { forwardRef, type InputHTMLAttributes } from 'react';
import { controlClass } from './controlStyles';
import { cx } from './cx';
import { useFieldControlProps } from './fieldContext';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

/** Text-like input. Inside a <Field> it is labelled and described automatically. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(props, ref) {
  const { className, type = 'text', ...rest } = useFieldControlProps(props);
  return <input ref={ref} type={type} className={cx(controlClass, className)} {...rest} />;
});

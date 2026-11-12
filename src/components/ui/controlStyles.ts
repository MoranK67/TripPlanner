/** Shared look of text-like controls (prototype `.input`). */
export const controlClass = [
  'block w-full min-h-11 rounded-[var(--radius-field)] border border-line-strong bg-bg px-3 py-2.5 text-[15px] text-ink',
  'outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-soft',
  // Focus: darker border than the prototype's accent-strong so the indicator meets 3:1.
  'focus-visible:border-accent-ink focus-visible:ring-[3px] focus-visible:ring-accent-soft',
  'aria-invalid:border-danger-ink aria-invalid:focus-visible:ring-danger',
  'disabled:cursor-not-allowed disabled:opacity-60',
].join(' ');

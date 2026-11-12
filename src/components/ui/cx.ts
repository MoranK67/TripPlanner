/**
 * Joins class names, skipping falsy values. Tiny local helper — no clsx dependency needed.
 * Note: there is no tailwind-merge, so a conflicting utility passed via `className`
 * (e.g. `px-6` vs a primitive's `px-4`) does not reliably override — CSS order decides.
 * Add a prop/variant to the primitive instead of fighting its classes.
 */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

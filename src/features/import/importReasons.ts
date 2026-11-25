import type { ImportRowError } from '@/domain';

/**
 * i18n key for every reason the parser can reject a row with (DEC-009, DEC-015). Typed as a full
 * `Record`, so a new `ImportRowError` code fails the typecheck until it gets a Hebrew message.
 * Messages may use `{{max}}` (the name length limit) and `{{tagMax}}` (the tag length limit).
 */
export const IMPORT_REASON_KEYS: Readonly<Record<ImportRowError, string>> = {
  missing_separator: 'import.reasons.missing_separator',
  missing_name: 'import.reasons.missing_name',
  name_too_long: 'import.reasons.name_too_long',
  missing_duration: 'import.reasons.missing_duration',
  invalid_duration: 'import.reasons.invalid_duration',
  duration_out_of_range: 'import.reasons.duration_out_of_range',
  tag_too_long: 'import.reasons.tag_too_long',
  tag_invalid: 'import.reasons.tag_invalid',
};

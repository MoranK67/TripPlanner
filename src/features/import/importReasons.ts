import type { TFunction } from 'i18next';
import type { ImportBankReason, ImportRowError, ImportRowPlan } from '@/domain';

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

/**
 * Hebrew text for why a row goes to the bank instead of the timetable (FEAT-3), e.g. "חופף לשורה
 * 3". `null` for a plain bank row (no placement asked for) and for a placed row.
 */
export function bankReasonText(plan: ImportRowPlan, t: TFunction): string | null {
  if (!('bank' in plan) || plan.bank === null) return null;
  switch (plan.bank) {
    case 'overlaps_existing':
      return plan.conflict.activityName
        ? t('import.bankReasons.overlaps_existing', { name: plan.conflict.activityName })
        : t('import.bankReasons.overlaps_existing_unknown');
    case 'overlaps_import_row':
      return plan.conflict.rowNumber > 0
        ? t('import.bankReasons.overlaps_import_row', { row: plan.conflict.rowNumber })
        : t('import.bankReasons.overlaps_existing_unknown');
    default:
      return t(BANK_REASON_KEYS[plan.bank]);
  }
}

/** Reasons without a conflict detail. A full `Record`, so a new code fails the typecheck. */
const BANK_REASON_KEYS: Readonly<
  Record<Exclude<ImportBankReason, 'overlaps_existing' | 'overlaps_import_row'>, string>
> = {
  day_out_of_trip: 'import.bankReasons.day_out_of_trip',
  outside_trip_hours: 'import.bankReasons.outside_trip_hours',
  placement_incomplete: 'import.bankReasons.placement_incomplete',
  placement_invalid: 'import.bankReasons.placement_invalid',
};

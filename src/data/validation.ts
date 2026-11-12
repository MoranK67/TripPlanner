// Client-side pre-checks before a write (PROJECT_PLAN §4.6: inputs validated client-side and by
// the DB). They use the domain rules, so a bad input fails fast with the same `reason` codes the
// DB reports in TP_VALIDATION details ('name', 'duration_minutes', 'color', TripWindowError,
// 'item:<n>:<field>', 'too_many_items', 'scheduled_date', 'start_minute').

import {
  MAX_IMPORT_ROWS,
  isHexColor,
  isIsoDate,
  isValidActivityName,
  isValidDuration,
  isValidStartMinute,
  isValidTripName,
  validateTripWindow,
  type ActivityInput,
  type ActivityPatch,
  type Placement,
  type TripInput,
} from '@/domain';
import { AppError } from './errors';

function fail(reason: string): never {
  throw new AppError('validation', { reason });
}

export function assertTripInput(input: TripInput): void {
  if (!isValidTripName(input.name)) fail('name');
  const windowError = validateTripWindow(input.window);
  if (windowError !== null) fail(windowError);
}

function activityFieldError(fields: ActivityPatch): string | null {
  if (fields.name !== undefined && !isValidActivityName(fields.name)) return 'name';
  if (fields.durationMinutes !== undefined && !isValidDuration(fields.durationMinutes)) {
    return 'duration_minutes';
  }
  if (fields.color !== undefined && !isHexColor(fields.color)) return 'color';
  return null;
}

export function assertActivityPatch(patch: ActivityPatch): void {
  const error = activityFieldError(patch);
  if (error !== null) fail(error);
}

export function assertActivityInput(input: ActivityInput): void {
  assertActivityPatch(input);
}

/** FR-6.5: at most 200 items; every item valid. Reasons use the RPC's 1-based `item:<n>:…`. */
export function assertImportItems(items: readonly ActivityInput[]): void {
  if (items.length > MAX_IMPORT_ROWS) fail('too_many_items');
  items.forEach((item, index) => {
    const error = activityFieldError(item);
    if (error !== null) fail(`item:${index + 1}:${error}`);
  });
}

/** Well-formedness only; window and overlap are checked by `canPlace` and by the RPC. */
export function assertPlacementTarget(target: Placement): void {
  if (!isIsoDate(target.date)) fail('scheduled_date');
  if (!isValidStartMinute(target.startMinute)) fail('start_minute');
}

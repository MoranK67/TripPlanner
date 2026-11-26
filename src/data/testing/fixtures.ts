// Test-only DB row factories.
import type { ActivityRow, ImportActivitiesRow, TripRow } from '../mapping';

export function tripRow(overrides: Partial<TripRow> = {}): TripRow {
  return {
    id: 'trip-1',
    owner_id: 'user-1',
    name: 'רומא',
    start_date: '2026-05-01',
    start_minute: 600,
    end_date: '2026-05-03',
    end_minute: 1080,
    timezone: null,
    color_cursor: 2,
    created_at: '2026-04-01T10:00:00Z',
    updated_at: '2026-04-01T10:00:00Z',
    ...overrides,
  };
}

export function activityRow(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 'act-1',
    trip_id: 'trip-1',
    name: 'Colosseum',
    duration_minutes: 120,
    color: '#FFD6E0',
    scheduled_date: null,
    start_minute: null,
    bank_position: 1,
    tag: null,
    created_at: '2026-04-01T10:00:00Z',
    updated_at: '2026-04-01T10:00:00Z',
    ...overrides,
  };
}

/** An `import_activities` result row (FEAT-3): a bank activity, no placement requested. */
export function importActivitiesRow(
  overrides: Partial<ImportActivitiesRow> = {},
): ImportActivitiesRow {
  return {
    ...activityRow(),
    item_index: 1,
    placed: false,
    bank_reason: null,
    conflict_activity_id: null,
    conflict_item: null,
    ...overrides,
  };
}

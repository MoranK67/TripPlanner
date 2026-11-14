import { BackupActions } from '@/features/backup';
import { TripsPage } from '@/features/trips';

/**
 * The `/trips` route: the trips list with the backup buttons (FR-8.1, FR-8.2) in its header.
 * Composed here so the trips feature does not depend on the backup feature (no module cycle).
 */
export function TripsRoute() {
  return <TripsPage headerActions={<BackupActions />} />;
}

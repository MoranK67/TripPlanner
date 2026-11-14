// Backup mutations (M6.6, FR-8.1/FR-8.2, DEC-033). The import adds trips, so the trips list
// (`tripKeys.list`) is refetched afterwards.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { backupRepo } from '@/data';
import { backupFileName, localIsoDate, serializeBackup, type BackupTrip } from '@/domain';
import { tripKeys } from '@/features/trips';

export const BACKUP_MIME = 'application/json';

/** Mutation keys, so dialogs can tell (with `useIsMutating`) that a backup action is running. */
export const backupMutationKeys = {
  export: ['backup', 'export'] as const,
  import: ['backup', 'import'] as const,
};

export interface BackupFile {
  blob: Blob;
  name: string;
  tripCount: number;
}

/** Reads every trip with its activities and builds the backup file (not saved yet). */
export function useBuildBackupFile() {
  return useMutation({
    mutationKey: backupMutationKeys.export,
    mutationFn: async (): Promise<BackupFile> => {
      const trips = await backupRepo.exportAll();
      const now = new Date();
      return {
        blob: new Blob([serializeBackup(trips, now)], { type: BACKUP_MIME }),
        name: backupFileName(localIsoDate(now)),
        tripCount: trips.length,
      };
    },
  });
}

/**
 * Adds every trip of a parsed backup in one atomic call. Never retried (DEC-033). The trips list
 * is refetched even after an error: a network error may hide a commit.
 */
export function useImportBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: backupMutationKeys.import,
    mutationFn: (trips: readonly BackupTrip[]) => backupRepo.importAll(trips),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: tripKeys.list() });
    },
  });
}

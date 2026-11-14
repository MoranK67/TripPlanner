// Text-import mutation (M6.1, FR-6.1–FR-6.5). Updates the shared trip detail cache
// (`tripKeys.detail`) that the bank and the timetable render from.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { activitiesRepo } from '@/data';
import { PALETTE, type ActivityInput, type TripWithActivities } from '@/domain';
import { tripKeys } from '@/features/trips';

/** Mutation key per trip, so the dialog can tell (with `useIsMutating`) that an import is running. */
export const importMutationKeys = {
  import: (tripId: string) => ['activities', tripId, 'import'] as const,
};

/**
 * Adds the valid rows to the bank in one transaction (RPC `import_activities`). The DB assigns
 * colors from the trip's color cursor in input order, as the preview shows.
 */
export function useImportActivities(tripId: string) {
  const queryClient = useQueryClient();
  const key = tripKeys.detail(tripId);
  return useMutation({
    mutationKey: importMutationKeys.import(tripId),
    mutationFn: (items: readonly ActivityInput[]) => activitiesRepo.importMany(tripId, items),
    onSuccess: (created) => {
      // Show them at once (and move the color cursor like the DB did), then reconcile.
      queryClient.setQueryData<TripWithActivities>(key, (old) =>
        old
          ? {
              trip: {
                ...old.trip,
                colorCursor: (old.trip.colorCursor + created.length) % PALETTE.length,
              },
              activities: [...old.activities, ...created],
            }
          : old,
      );
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

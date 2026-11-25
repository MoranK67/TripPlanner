// Text-import mutation (M6.1, FR-6.1–FR-6.5). Updates the shared trip detail cache
// (`tripKeys.detail`) that the bank and the timetable render from.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { activitiesRepo } from '@/data';
import { PALETTE, tagKey, type ActivityInput, type TripWithActivities } from '@/domain';
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
      // Show them at once (and move the color cursor like the DB did), then reconcile. Rows
      // that joined a tag group (an existing one or one an earlier row started) took its colour
      // and did not move the cursor (DEC-042).
      queryClient.setQueryData<TripWithActivities>(key, (old) => {
        if (!old) return old;
        const groups = new Set(old.activities.map((a) => tagKey(a.tag)));
        let step = 0;
        for (const activity of created) {
          const group = tagKey(activity.tag);
          if (group !== null && groups.has(group)) continue;
          step += 1;
          groups.add(group);
        }
        return {
          trip: { ...old.trip, colorCursor: (old.trip.colorCursor + step) % PALETTE.length },
          activities: [...old.activities, ...created],
        };
      });
    },
    // Also after an error: a timed-out import may have been committed (UX-3, DEC-032), and the
    // refetched bank shows it before the user tries again.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

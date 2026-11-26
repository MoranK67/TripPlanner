// Text-import mutation (M6.1, FR-6.1–FR-6.5, FEAT-3). Updates the shared trip detail cache
// (`tripKeys.detail`) that the bank and the timetable render from.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { activitiesRepo } from '@/data';
import { PALETTE, tagKey, type ImportItemInput, type TripWithActivities } from '@/domain';
import { placementQueueScope } from '@/features/schedule';
import { tripKeys } from '@/features/trips';

/** Mutation key per trip, so the dialog can tell (with `useIsMutating`) that an import is running. */
export const importMutationKeys = {
  import: (tripId: string) => ['activities', tripId, 'import'] as const,
};

/**
 * Adds the valid rows in one transaction (RPC `import_activities`). The DB assigns colors from the
 * trip's color cursor in input order, as the preview shows. Items with a placement (FEAT-3) are
 * placed when the slot is free, otherwise banked with a reason; the result is one outcome per item.
 *
 * The import joins the trip's placement queue (`placementQueueScope`, DEC-031): it starts only
 * after the drops already queued reached the server, so its overlap checks see them, and a later
 * drop waits for it.
 */
export function useImportActivities(tripId: string) {
  const queryClient = useQueryClient();
  const key = tripKeys.detail(tripId);
  return useMutation({
    mutationKey: importMutationKeys.import(tripId),
    scope: placementQueueScope(tripId),
    mutationFn: (items: readonly ImportItemInput[]) => activitiesRepo.importMany(tripId, items),
    onSuccess: (outcomes) => {
      // Show them at once, placed ones in the timetable (and move the color cursor like the DB
      // did), then reconcile. Rows that joined a tag group (an existing one or one an earlier row
      // started) took its colour and did not move the cursor (DEC-042).
      queryClient.setQueryData<TripWithActivities>(key, (old) => {
        if (!old) return old;
        // A refetch that finished meanwhile (e.g. after the placement queue drained) may already
        // hold them, with the cursor the server moved.
        const known = new Set(old.activities.map((a) => a.id));
        const created = outcomes.map((o) => o.activity).filter((a) => !known.has(a.id));
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

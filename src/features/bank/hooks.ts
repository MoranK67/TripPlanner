// Activity mutations for the bank (M4.4). They update the shared trip detail cache
// (`tripKeys.detail`) that the bank and the timetable both render from. Edits (and placement from
// the dialog, FEAT-1) go through the trip's placement queue: `useQueuedActivityUpdate` in
// @/features/schedule (DEC-031).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { activitiesRepo } from '@/data';
import { PALETTE, tagColor, type ActivityInput, type TripWithActivities } from '@/domain';
import { tripKeys } from '@/features/trips';

/** Mutation keys per trip, so dialogs can tell (with `useIsMutating`) that a save is running. */
export const activityMutationKeys = {
  create: (tripId: string) => ['activities', tripId, 'create'] as const,
  delete: (tripId: string) => ['activities', tripId, 'delete'] as const,
};

/** New bank activity (FR-3.1). The DB picks the color from the trip's cursor when omitted. */
export function useCreateActivity(tripId: string) {
  const queryClient = useQueryClient();
  const key = tripKeys.detail(tripId);
  return useMutation({
    mutationKey: activityMutationKeys.create(tripId),
    mutationFn: (input: ActivityInput) => activitiesRepo.create(tripId, input),
    onSuccess: (activity) => {
      // Show it at once (and move the color cursor like the DB did, FR-3.2, unless it joined a
      // tag group, DEC-042), then reconcile.
      queryClient.setQueryData<TripWithActivities>(key, (old) => {
        if (!old) return old;
        const joined = tagColor(old.activities, activity.tag) !== null;
        const step = joined ? 0 : 1;
        return {
          trip: { ...old.trip, colorCursor: (old.trip.colorCursor + step) % PALETTE.length },
          activities: [...old.activities, activity],
        };
      });
    },
    // Also after an error: a timed-out create may have been saved (UX-3, DEC-032); the refetch
    // shows it in the bank, so trying again doesn't silently add a second copy.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

/** Delete (after confirmation, FR-3.4). Optimistic: the block disappears at once, and comes back if the server fails. */
export function useDeleteActivity(tripId: string) {
  const queryClient = useQueryClient();
  const key = tripKeys.detail(tripId);
  return useMutation({
    mutationKey: activityMutationKeys.delete(tripId),
    mutationFn: (id: string) => activitiesRepo.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TripWithActivities>(key);
      queryClient.setQueryData<TripWithActivities>(key, (old) =>
        old ? { ...old, activities: old.activities.filter((a) => a.id !== id) } : old,
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

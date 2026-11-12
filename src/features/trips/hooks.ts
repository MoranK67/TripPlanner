// TanStack Query hooks for trips (M4). The trip detail query (`tripKeys.detail`) is shared with
// the bank (M4.4) and the timetable (M5): both read and update the same cached
// `TripWithActivities`.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tripsRepo } from '@/data';
import type { TripInput, TripSummary, TripWithActivities } from '@/domain';

export const tripKeys = {
  all: ['trips'] as const,
  list: () => [...tripKeys.all, 'list'] as const,
  detail: (tripId: string) => [...tripKeys.all, 'detail', tripId] as const,
};

/** Mutation keys, so dialogs can tell (with `useIsMutating`) that a save is still running. */
export const tripMutationKeys = {
  create: ['trips', 'create'] as const,
  update: ['trips', 'update'] as const,
  delete: ['trips', 'delete'] as const,
};

/** All trips, sorted by start (FR-2.8). */
export function useTripsQuery() {
  return useQuery({ queryKey: tripKeys.list(), queryFn: () => tripsRepo.list() });
}

/** One trip with all its activities (bank order ascending). */
export function useTripQuery(tripId: string) {
  return useQuery({ queryKey: tripKeys.detail(tripId), queryFn: () => tripsRepo.get(tripId) });
}

export function useCreateTrip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: tripMutationKeys.create,
    mutationFn: (input: TripInput) => tripsRepo.create(input),
    onSuccess: (trip) => {
      queryClient.setQueryData<TripWithActivities>(tripKeys.detail(trip.id), {
        trip,
        activities: [],
      });
      void queryClient.invalidateQueries({ queryKey: tripKeys.list() });
    },
  });
}

/**
 * Name + window edit via RPC (FR-2.6). Activities outside the new window go back to the bank on
 * the server; the result's `movedCount` says how many, and the detail query is refetched.
 */
export function useUpdateTripWindow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: tripMutationKeys.update,
    mutationFn: ({ tripId, input }: { tripId: string; input: TripInput }) =>
      tripsRepo.updateWindow(tripId, input),
    onSuccess: ({ trip }) => {
      queryClient.setQueryData<TripWithActivities>(tripKeys.detail(trip.id), (old) =>
        old ? { ...old, trip } : old,
      );
      void queryClient.invalidateQueries({ queryKey: tripKeys.detail(trip.id) });
      void queryClient.invalidateQueries({ queryKey: tripKeys.list() });
    },
  });
}

/** Deletes a trip and (in the DB, by cascade) its activities (FR-2.7). */
export function useDeleteTrip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: tripMutationKeys.delete,
    mutationFn: (tripId: string) => tripsRepo.delete(tripId),
    onSuccess: (_, tripId) => {
      queryClient.removeQueries({ queryKey: tripKeys.detail(tripId) });
      queryClient.setQueryData<TripSummary[]>(tripKeys.list(), (old) =>
        old?.filter((trip) => trip.id !== tripId),
      );
      void queryClient.invalidateQueries({ queryKey: tripKeys.list() });
    },
  });
}

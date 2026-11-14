// Placement mutations (FR-5.1, FR-3.7, FR-5.7). They update the shared trip detail cache
// (`tripKeys.detail`) that the bank and the timetable both render from.
//
// Optimistic flow (PROJECT_PLAN §4.4): the block moves in the cache at once (`onMutate`); the
// server answer replaces it (`onSuccess`); a rejection or network failure puts it back and shows
// the `AppError` kind's Hebrew message (`onError`); the trip is refetched when the last placement
// write settles (`onSettled`).
//
// Concurrency: all placement writes of one trip share a mutation `scope`, so TanStack Query sends
// them to the server one at a time, in drop order. `onMutate` still runs immediately, so every drop
// is visible at once. Serialising (instead of refusing to drag a block whose save is in flight)
// keeps the UI responsive and also orders writes across blocks: moving A out of a slot and then B
// into it cannot reach the server in the opposite order and fail with `conflict_overlap`.
// For a block with several writes queued, only the last one decides what is shown: earlier
// answers update the rollback base but not the cache, and a rollback restores the last value the
// server confirmed (not a stale optimistic one).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui';
import { activitiesRepo } from '@/data';
import type { Activity, IsoDate, Minute, TripWithActivities } from '@/domain';
import { tripKeys } from '@/features/trips';
import { errorMessage, isAbortedError } from '@/i18n/errors';

export interface PlacementActions {
  /** Place a bank activity or move a placed one. */
  place: (activityId: string, date: IsoDate, startMinute: Minute) => void;
  /** Return a placed activity to the end of the bank. */
  unplace: (activityId: string) => void;
}

/** Mutation key of every placement write of a trip (also used to count pending writes). */
const placementMutationKey = (tripId: string) => ['placement', tripId] as const;

type PlacementVariables =
  | { kind: 'place'; id: string; date: IsoDate; startMinute: Minute }
  | { kind: 'unplace'; id: string };

/** Per activity: the last server-confirmed value and the number of writes not yet settled. */
interface PendingEntry {
  base: Activity;
  pending: number;
}

function replaceActivity(data: TripWithActivities, next: Activity): TripWithActivities {
  return {
    ...data,
    activities: data.activities.map((a) => (a.id === next.id ? next : a)),
  };
}

/** The activity as the server will return it, computed locally (unplace mirrors the RPC). */
function applyOptimistic(data: TripWithActivities, vars: PlacementVariables): Activity | null {
  const current = data.activities.find((a) => a.id === vars.id);
  if (!current) return null;
  if (vars.kind === 'place') {
    return { ...current, placement: { date: vars.date, startMinute: vars.startMinute } };
  }
  // unplace_activity: bank_position = max + 1 over all of the trip's activities.
  const max = data.activities.reduce((m, a) => Math.max(m, a.bankPosition), 0);
  return { ...current, placement: null, bankPosition: max + 1 };
}

/**
 * Place / move / unplace for one trip, ready to pass to `TimetableDragRoot`. Optimistic, with
 * rollback and a toast on failure (FR-5.7). See the file header for the concurrency rules.
 */
export function usePlacementActions(tripId: string): PlacementActions {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();
  const pendingRef = useRef(new Map<string, PendingEntry>());

  const key = tripKeys.detail(tripId);
  const mutationKey = placementMutationKey(tripId);

  const write = (activity: Activity) =>
    queryClient.setQueryData<TripWithActivities>(key, (old) =>
      old ? replaceActivity(old, activity) : old,
    );

  const { mutate } = useMutation({
    mutationKey,
    // One queue per trip: writes reach the server in drop order.
    scope: { id: `placement:${tripId}` },
    mutationFn: (vars: PlacementVariables) =>
      vars.kind === 'place'
        ? activitiesRepo.place(vars.id, vars.date, vars.startMinute)
        : activitiesRepo.unplace(vars.id),
    onMutate: async (vars) => {
      const pending = pendingRef.current;
      // Read and write synchronously, before any await, so a second drop in the same tick sees
      // this one's optimistic value and the counter.
      const data = queryClient.getQueryData<TripWithActivities>(key);
      const current = data?.activities.find((a) => a.id === vars.id);
      const next = data ? applyOptimistic(data, vars) : null;
      if (current) {
        const entry = pending.get(vars.id);
        if (entry) entry.pending += 1;
        else pending.set(vars.id, { base: current, pending: 1 });
      }
      // A refetch that started before the drop would overwrite the optimistic value.
      await queryClient.cancelQueries({ queryKey: key });
      if (next) write(next);
    },
    onSuccess: (activity, vars) => {
      const entry = pendingRef.current.get(vars.id);
      if (entry) entry.base = activity;
      // A later write of the same block is queued: keep showing its optimistic value.
      if (!entry || entry.pending <= 1) write(activity);
    },
    onError: (error, vars) => {
      const entry = pendingRef.current.get(vars.id);
      // Only the last queued write rolls back; earlier failures are superseded by it.
      if (entry && entry.pending <= 1) write(entry.base);
      if (isAbortedError(error)) return;
      toast.show(errorMessage(error, t), { tone: 'error' });
    },
    onSettled: (_data, _error, vars) => {
      const pending = pendingRef.current;
      const entry = pending.get(vars.id);
      if (entry) {
        entry.pending -= 1;
        if (entry.pending <= 0) pending.delete(vars.id);
      }
      // This mutation still counts as pending here. Refetch only after the last write, so the
      // server state never overwrites a queued optimistic move.
      if (queryClient.isMutating({ mutationKey }) <= 1) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });

  return useMemo(
    () => ({
      place: (id, date, startMinute) => mutate({ kind: 'place', id, date, startMinute }),
      unplace: (id) => mutate({ kind: 'unplace', id }),
    }),
    [mutate],
  );
}

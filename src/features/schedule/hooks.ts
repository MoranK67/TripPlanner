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
//
// The queue outlives the component (mutation callbacks run after unmount), so its bookkeeping
// lives at module level, per QueryClient and trip (`TripQueue`). While a trip's queue is not
// empty, a refetch this hook did not start (window focus, another feature's invalidation) would
// show stale server rows; a query cache listener re-applies the queue's values on top of it.

import { hashKey, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
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

/**
 * Per activity, while the trip's queue drains: the last server-confirmed value, the number of
 * writes not yet settled and the newest write (whose optimistic value is shown while `pending > 0`).
 * An entry stays after its writes settle (`pending === 0`, shows `base`) until the whole queue is
 * empty, so a stale refetch cannot undo a confirmed write either. The flip side, accepted: a
 * server-side move by another feature meanwhile (DEC-022 `returnedToBank`, `update_trip_window`)
 * stays hidden until the refetch after the queue drains.
 */
interface PendingEntry {
  base: Activity;
  pending: number;
  latest: PlacementVariables;
}

/**
 * Bookkeeping of one trip's placement queue; exists only while the queue is not empty and the
 * trip's query is in the cache (`queryClient.clear()` on sign-out releases it).
 */
interface TripQueue {
  entries: Map<string, PendingEntry>;
  /** Toast messages already shown while this queue drains (one toast per error kind). */
  toasted: Set<string>;
  stopListening: () => void;
}

const queues = new WeakMap<QueryClient, Map<string, TripQueue>>();

function replaceActivity(data: TripWithActivities, next: Activity): TripWithActivities {
  return {
    ...data,
    activities: data.activities.map((a) => (a.id === next.id ? next : a)),
  };
}

/** The activity as the server will return it, computed locally (mirrors the RPCs). */
function applyOptimistic(data: TripWithActivities, vars: PlacementVariables): Activity | null {
  const current = data.activities.find((a) => a.id === vars.id);
  if (!current) return null;
  if (vars.kind === 'place') {
    return { ...current, placement: { date: vars.date, startMinute: vars.startMinute } };
  }
  // unplace_activity is a no-op for a bank activity; otherwise bank_position = max + 1 over all
  // of the trip's activities.
  if (!current.placement) return current;
  const max = data.activities.reduce((m, a) => Math.max(m, a.bankPosition), 0);
  return { ...current, placement: null, bankPosition: max + 1 };
}

/**
 * Overlay the queue's positions on refetched trip data. Only placement and bank position are
 * taken from the queue; other fields (e.g. a rename saved meanwhile) come from the fetch.
 */
function applyQueue(data: TripWithActivities, queue: TripQueue): TripWithActivities {
  let next = data;
  for (const [id, entry] of queue.entries) {
    let value: Activity | null;
    if (entry.pending > 0) {
      value = applyOptimistic(next, entry.latest);
    } else {
      const fetched = next.activities.find((a) => a.id === id);
      value = fetched
        ? { ...fetched, placement: entry.base.placement, bankPosition: entry.base.bankPosition }
        : null;
    }
    if (value) next = replaceActivity(next, value);
  }
  return next;
}

function getQueue(queryClient: QueryClient, tripId: string): TripQueue {
  let byTrip = queues.get(queryClient);
  if (!byTrip) {
    byTrip = new Map();
    queues.set(queryClient, byTrip);
  }
  const existing = byTrip.get(tripId);
  if (existing) return existing;

  const key = tripKeys.detail(tripId);
  const hash = hashKey(key);
  const queue: TripQueue = { entries: new Map(), toasted: new Set(), stopListening: () => {} };
  queue.stopListening = queryClient.getQueryCache().subscribe((event) => {
    if (event.query.queryHash !== hash) return;
    if (event.type === 'removed') {
      releaseQueue(queryClient, tripId, queue);
      return;
    }
    // Only fetch results; our own `setQueryData` writes are `manual` (and would loop).
    if (event.type !== 'updated') return;
    if (event.action.type !== 'success' || event.action.manual) return;
    queryClient.setQueryData<TripWithActivities>(key, (old) =>
      old ? applyQueue(old, queue) : old,
    );
  });
  byTrip.set(tripId, queue);
  return queue;
}

/** Whether `queue` is still the trip's live queue (not drained, not removed by a cache clear). */
function isLive(queryClient: QueryClient, tripId: string, queue: TripQueue | undefined): boolean {
  return !!queue && queues.get(queryClient)?.get(tripId) === queue;
}

function releaseQueue(queryClient: QueryClient, tripId: string, queue: TripQueue): void {
  if (!isLive(queryClient, tripId, queue)) return;
  queue.stopListening();
  queues.get(queryClient)?.delete(tripId);
}

/**
 * Place / move / unplace for one trip, ready to pass to `TimetableDragRoot`. Optimistic, with
 * rollback and a toast on failure (FR-5.7). See the file header for the concurrency rules.
 */
export function usePlacementActions(tripId: string): PlacementActions {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();

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
      // Read the cache and bump the counter before any await, so a second drop in the same tick
      // sees this one's optimistic value and the counter.
      const queue = getQueue(queryClient, tripId);
      const data = queryClient.getQueryData<TripWithActivities>(key);
      const current = data?.activities.find((a) => a.id === vars.id);
      const next = data ? applyOptimistic(data, vars) : null;
      if (current) {
        const entry = queue.entries.get(vars.id);
        if (entry) {
          entry.pending += 1;
          entry.latest = vars;
        } else {
          queue.entries.set(vars.id, { base: current, pending: 1, latest: vars });
        }
      }
      // Stop a refetch that started before the drop. Write only after cancelling: the cancel
      // reverts the in-flight fetch's state, which would undo an earlier write.
      await queryClient.cancelQueries({ queryKey: key });
      if (next) write(next);
      // The callbacks below use this queue, so a mutation that outlives a cache clear cannot
      // touch the queue of a later session.
      return { queue };
    },
    onSuccess: (activity, vars, context) => {
      const queue = context?.queue;
      // The trip's cache was cleared (sign-out): do not write into a later session's cache.
      if (!queue || !isLive(queryClient, tripId, queue)) return;
      const entry = queue.entries.get(vars.id);
      if (entry) entry.base = activity;
      // A later write of the same block is queued: keep showing its optimistic value.
      if (!entry || entry.pending <= 1) write(activity);
    },
    onError: (error, vars, context) => {
      const queue = context?.queue;
      // The trip's cache was cleared (sign-out): nothing to roll back, nobody to tell.
      if (!queue || !isLive(queryClient, tripId, queue)) return;
      const entry = queue.entries.get(vars.id);
      // Only the last queued write rolls back; earlier failures are superseded by it.
      if (entry && entry.pending <= 1) write(entry.base);
      if (isAbortedError(error)) return;
      const message = errorMessage(error, t);
      // Offline, every queued write fails the same way: one toast is enough.
      if (queue.toasted.has(message)) return;
      queue.toasted.add(message);
      toast.show(message, { tone: 'error' });
    },
    onSettled: (_data, _error, vars, context) => {
      const queue = context?.queue;
      if (!queue || !isLive(queryClient, tripId, queue)) return;
      const entry = queue.entries.get(vars.id);
      if (entry) entry.pending -= 1;
      // This mutation still counts as pending here. Refetch only after the last write, so the
      // server state never overwrites a queued optimistic move.
      if (queryClient.isMutating({ mutationKey }) <= 1) {
        releaseQueue(queryClient, tripId, queue);
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

// Placement mutations (FR-5.1, FR-3.7). They update the shared trip detail cache
// (`tripKeys.detail`) that the bank and the timetable both render from.
// M5.4 adds the optimistic update and rollback (FR-5.7); for now the block moves when the server
// confirms.

import { useMutation, useQueryClient } from '@tanstack/react-query';
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

/**
 * Place / move / unplace for one trip, ready to pass to `TimetableDragRoot`. A server rejection
 * (e.g. someone else filled the slot) is shown as a toast with the `AppError` kind's message.
 */
export function usePlacementActions(tripId: string): PlacementActions {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();

  const key = tripKeys.detail(tripId);
  const handlers = {
    onSuccess: (activity: Activity) => {
      queryClient.setQueryData<TripWithActivities>(key, (old) =>
        old
          ? {
              ...old,
              activities: old.activities.map((a) => (a.id === activity.id ? activity : a)),
            }
          : old,
      );
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error: unknown) => {
      if (isAbortedError(error)) return;
      toast.show(errorMessage(error, t), { tone: 'error' });
      void queryClient.invalidateQueries({ queryKey: key });
    },
  };

  const { mutate: place } = useMutation({
    mutationFn: ({ id, date, startMinute }: { id: string; date: IsoDate; startMinute: Minute }) =>
      activitiesRepo.place(id, date, startMinute),
    ...handlers,
  });
  const { mutate: unplace } = useMutation({
    mutationFn: (id: string) => activitiesRepo.unplace(id),
    ...handlers,
  });

  return useMemo(
    () => ({
      place: (id, date, startMinute) => place({ id, date, startMinute }),
      unplace: (id) => unplace(id),
    }),
    [place, unplace],
  );
}

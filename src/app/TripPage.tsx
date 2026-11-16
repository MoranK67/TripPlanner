import { useEffect, useId, useMemo, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { Button, Card, LoadingState } from '@/components/ui';
import { isAppError } from '@/data';
import { isInBank, type Activity, type Trip } from '@/domain';
import { BankPanel, useActivityDialogs, type ActivityDialogsOptions } from '@/features/bank';
import { ExportButton } from '@/features/export';
import {
  findPlacedActivityButton,
  PlannerLayout,
  Timetable,
  TimetableDragRoot,
  usePlacementActions,
} from '@/features/schedule';
import { TripHeaderControls, useTripQuery } from '@/features/trips';
import { errorMessage } from '@/i18n/errors';

/**
 * The planner page for one trip: header controls (trips feature), the activity bank in the side
 * panel (bank feature) and the timetable in the main area (schedule feature). It lives in
 * src/app because it composes several features, which must not import each other's pages.
 */
export function TripPage() {
  const { t } = useTranslation();
  const { tripId = '' } = useParams();
  const query = useTripQuery(tripId);

  if (query.isPending) return <LoadingState />;
  // A malformed id in the URL fails validation; for the user that is simply "no such trip".
  const notFound =
    isAppError(query.error) &&
    (query.error.kind === 'not_found' || query.error.kind === 'validation');
  // Any other failed refetch keeps the (cached) trip on screen, e.g. offline (M7.3).
  if (query.data === undefined || notFound) {
    return (
      <div className="grid place-items-center p-6">
        <Card className="max-w-md text-center">
          <h2 className="mt-0 mb-2 text-xl font-bold">
            {notFound ? t('planner.notFound') : t('errors.title')}
          </h2>
          {!notFound && (
            <p role="alert" className="mt-0 mb-4 leading-relaxed text-ink-soft">
              {errorMessage(query.error, t)}
            </p>
          )}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {!notFound && (
              <Button variant="primary" onClick={() => void query.refetch()}>
                {t('common.retry')}
              </Button>
            )}
            <Link
              to="/trips"
              className="inline-flex min-h-10 items-center rounded-full bg-accent-soft px-4 py-2 text-sm font-medium text-accent-ink no-underline hover:bg-accent-soft-hover"
            >
              {t('notFound.back')}
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return <TripPlanner trip={query.data.trip} activities={query.data.activities} />;
}

/** The loaded trip: header controls, bank and timetable sharing one set of activity dialogs. */
function TripPlanner({ trip, activities }: { trip: Trip; activities: Activity[] }) {
  const { t } = useTranslation();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusAfterDelete = useFocusAfterTimetableDelete(activities, headingRef);
  // Placed blocks open the same edit / delete dialogs as the bank (FR-3.4, FR-3.5).
  const timetableDialogs = useActivityDialogs(trip, focusAfterDelete);
  const placement = usePlacementActions(trip.id);
  const bankCount = useMemo(() => activities.filter(isInBank).length, [activities]);
  return (
    <>
      <h2 className="sr-only">{trip.name}</h2>
      <TripHeaderControls
        trip={trip}
        exportAction={<ExportButton trip={trip} activities={activities} />}
      />
      {/* Drag between bank and timetable (FR-5.1–5.4): both must render inside the drag root. */}
      <TimetableDragRoot
        trip={trip}
        activities={activities}
        onPlace={placement.place}
        onUnplace={placement.unplace}
      >
        {/* Side panel + multi-day grid; on phones a bank bottom sheet + one-day view (M7.1). */}
        <PlannerLayout
          bankLabel={t('bank.title')}
          bankCount={bankCount}
          bank={<BankPanel trip={trip} activities={activities} />}
        >
          {/* Outline: h1 app title > h2 trip / bank / timetable > h3 day headers (in Timetable).
              The timetable region is named by this heading, so it is announced once (UX-2). */}
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="sr-only">
            {t('planner.timetable')}
          </h2>
          <Timetable
            trip={trip}
            activities={activities}
            labelledBy={headingId}
            onOpenActivity={timetableDialogs.openEdit}
            onDeleteActivity={timetableDialogs.openDelete}
          />
        </PlannerLayout>
      </TimetableDragRoot>
      {timetableDialogs.dialogs}
    </>
  );
}

/**
 * The placed activity to focus after `deleted` is gone: the next one on the same day (by start
 * time), else the previous one; `null` if the day has no other block.
 */
function neighborOnSameDay(activities: readonly Activity[], deleted: Activity): Activity | null {
  const date = deleted.placement?.date;
  if (!date) return null;
  const sameDay = activities
    .filter((a) => a.id !== deleted.id && a.placement?.date === date)
    .sort((a, b) => (a.placement?.startMinute ?? 0) - (b.placement?.startMinute ?? 0));
  const start = deleted.placement?.startMinute ?? 0;
  return sameDay.find((a) => (a.placement?.startMinute ?? 0) > start) ?? sameDay.at(-1) ?? null;
}

/** What to focus once a deleted block has left the timetable. */
interface PendingDelete {
  deletedId: string;
  /** Next (else previous) block of the same day; `null` = no other block that day. */
  targetId: string | null;
}

/**
 * A confirmed delete removes the block at once (optimistic), taking its × button (where the
 * confirm dialog returned focus) with it, so keyboard focus would fall to <body>. When that
 * happens, focus moves to the next block of the same day (else the previous one); if none is
 * drawn (no other block that day, or another day on the phone), to the timetable region; else to
 * the timetable heading (UX-2). Focus the user already moved elsewhere is left alone. If the
 * server then refuses the delete, the block comes back and focus stays where it was moved; a
 * failure before the block was removed just clears the pending delete. Returns the delete
 * callbacks for useActivityDialogs.
 */
function useFocusAfterTimetableDelete(
  activities: readonly Activity[],
  headingRef: RefObject<HTMLHeadingElement | null>,
): ActivityDialogsOptions {
  const pendingRef = useRef<PendingDelete | null>(null);
  useEffect(() => {
    const pending = pendingRef.current;
    if (pending === null || activities.some((a) => a.id === pending.deletedId)) return;
    pendingRef.current = null;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const heading = headingRef.current;
    const block = pending.targetId === null ? null : findPlacedActivityButton(pending.targetId);
    // The region is the element labelled by the heading (Timetable's `labelledBy`).
    const region = heading?.id
      ? document.querySelector<HTMLElement>(`[aria-labelledby="${heading.id}"]`)
      : null;
    (block ?? region ?? heading)?.focus();
  }, [activities, headingRef]);
  return {
    onDeleteStart: (activity) => {
      pendingRef.current = {
        deletedId: activity.id,
        targetId: neighborOnSameDay(activities, activity)?.id ?? null,
      };
    },
    onDeleteError: () => {
      pendingRef.current = null;
    },
  };
}

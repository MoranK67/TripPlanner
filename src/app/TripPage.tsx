import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { Button, Card, LoadingState, SidebarLayout } from '@/components/ui';
import { isAppError } from '@/data';
import type { Activity, Trip } from '@/domain';
import { BankPanel, useActivityDialogs } from '@/features/bank';
import { Timetable, TimetableDragRoot, usePlacementActions } from '@/features/schedule';
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
  if (query.isError) {
    // A malformed id in the URL fails validation; for the user that is simply "no such trip".
    const notFound =
      isAppError(query.error) &&
      (query.error.kind === 'not_found' || query.error.kind === 'validation');
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
  // Placed blocks open the same edit / delete dialogs as the bank (FR-3.4, FR-3.5).
  const timetableDialogs = useActivityDialogs(trip);
  const placement = usePlacementActions(trip.id);
  return (
    <>
      <h2 className="sr-only">{trip.name}</h2>
      <TripHeaderControls trip={trip} />
      {/* Drag between bank and timetable (FR-5.1–5.4): both must render inside the drag root. */}
      <TimetableDragRoot
        trip={trip}
        activities={activities}
        onPlace={placement.place}
        onUnplace={placement.unplace}
      >
        <SidebarLayout
          sidebarLabel={t('bank.title')}
          sidebar={<BankPanel trip={trip} activities={activities} />}
        >
          {/* Outline: h1 app title > h2 trip / bank / timetable > h3 day headers (in Timetable). */}
          <h2 className="sr-only">{t('planner.timetable')}</h2>
          <Timetable
            trip={trip}
            activities={activities}
            onOpenActivity={timetableDialogs.openEdit}
            onDeleteActivity={timetableDialogs.openDelete}
          />
        </SidebarLayout>
      </TimetableDragRoot>
      {timetableDialogs.dialogs}
    </>
  );
}

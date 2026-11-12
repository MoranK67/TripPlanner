import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { Button, Card, LoadingState, SidebarLayout } from '@/components/ui';
import { isAppError } from '@/data';
import { BankPanel } from '@/features/bank';
import { TripHeaderControls, useTripQuery } from '@/features/trips';
import { errorMessage } from '@/i18n/errors';

/**
 * The planner page for one trip: header controls (trips feature), the activity bank in the side
 * panel (bank feature) and the timetable in the main area (schedule feature, M5). It lives in
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

  const { trip, activities } = query.data;
  return (
    <>
      <h2 className="sr-only">{trip.name}</h2>
      <TripHeaderControls trip={trip} />
      <SidebarLayout
        sidebarLabel={t('bank.title')}
        sidebar={<BankPanel trip={trip} activities={activities} />}
      >
        {/* M5 (scheduler-engineer) replaces this placeholder with the timetable. */}
        <section
          aria-label={t('planner.timetable')}
          className="grid min-h-0 flex-1 place-items-center rounded-[var(--radius-card)] border border-line bg-panel p-6 text-center shadow-[var(--shadow-card)]"
        >
          <p className="m-0 max-w-sm leading-relaxed text-ink-soft">{t('planner.placeholder')}</p>
        </section>
      </SidebarLayout>
    </>
  );
}

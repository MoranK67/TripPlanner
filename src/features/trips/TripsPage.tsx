import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, Card, HeaderActions, LoadingState } from '@/components/ui';
import { paletteColorAt, type TripSummary } from '@/domain';
import { errorMessage } from '@/i18n/errors';
import { useTripsQuery } from './hooks';
import { TripDialog } from './TripDialog';
import { tripDaysLabel, tripRangeLabel } from './tripLabels';

export interface TripsPageProps {
  /**
   * Extra header controls after "+ טיול חדש" (the backup buttons, FR-8). Passed in by the app
   * route, so the trips feature does not depend on the backup feature.
   */
  headerActions?: ReactNode;
}

/** Trips list (FR-2.1, FR-2.8): one card per trip, sorted by start; empty state for none. */
export function TripsPage({ headerActions }: TripsPageProps = {}) {
  const { t } = useTranslation();
  const trips = useTripsQuery();
  const [creating, setCreating] = useState(false);
  const openCreate = () => setCreating(true);

  let body;
  if (trips.isPending) {
    body = <LoadingState />;
  } else if (trips.isError) {
    body = (
      <Card className="mx-auto max-w-md text-center">
        <p role="alert" className="mt-0 mb-4 leading-relaxed">
          {t('trips.loadError', { reason: errorMessage(trips.error, t) })}
        </p>
        <Button variant="primary" onClick={() => void trips.refetch()}>
          {t('common.retry')}
        </Button>
      </Card>
    );
  } else if (trips.data.length === 0) {
    body = <EmptyTrips onCreate={openCreate} />;
  } else {
    body = (
      <ul className="m-0 grid list-none gap-3 p-0 tablet:grid-cols-2 tablet:gap-4 desktop:grid-cols-3">
        {trips.data.map((trip, i) => (
          <li key={trip.id} className="min-w-0">
            <TripCard trip={trip} accent={paletteColorAt(i)} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <HeaderActions>
        <Button variant="primary" size="sm" onClick={openCreate}>
          {t('trips.new')}
        </Button>
        {headerActions}
      </HeaderActions>
      <h2 className="mt-1 mb-4 text-xl font-bold tablet:text-[22px]">{t('trips.title')}</h2>
      {body}
      <TripDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function TripCard({ trip, accent }: { trip: TripSummary; accent: string }) {
  const { t } = useTranslation();
  return (
    <Link
      to={`/trips/${trip.id}`}
      className="group block h-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel text-ink no-underline shadow-[var(--shadow-card)] transition hover:border-line-strong hover:shadow-[var(--shadow-block-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink"
    >
      <span aria-hidden="true" className="block h-2" style={{ backgroundColor: accent }} />
      <span className="block p-4 tablet:p-5">
        <span className="mb-1.5 block text-[17px] font-semibold [overflow-wrap:anywhere] group-hover:text-accent-ink">
          {trip.name}
        </span>
        <span className="mb-3 block text-[13.5px] leading-relaxed text-ink-soft">
          {tripRangeLabel(trip.window, t, 'long')}
        </span>
        <span className="inline-block rounded-full bg-accent-soft px-2.5 py-0.5 text-[12.5px] font-medium text-accent-ink">
          {tripDaysLabel(trip.window, t)}
        </span>
      </span>
    </Link>
  );
}

/** Prototype empty state: pastel blocks, a short explanation and one clear action. */
function EmptyTrips({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation();
  const bars = [34, 52, 24, 42];
  return (
    <div className="grid place-items-center py-6">
      <Card className="max-w-[420px] px-8 py-10 text-center">
        <div aria-hidden="true" className="mb-[18px] flex items-end justify-center gap-2">
          {bars.map((height, i) => (
            <span
              key={height}
              className="w-11 rounded-[10px]"
              style={{ height, backgroundColor: paletteColorAt([0, 5, 3, 6][i] ?? 0) }}
            />
          ))}
        </div>
        <h3 className="mt-0 mb-2 text-[22px] font-bold">{t('trips.empty.title')}</h3>
        <p className="mt-0 mb-[22px] leading-relaxed text-ink-soft">{t('trips.empty.body')}</p>
        <Button variant="primary" onClick={onCreate}>
          {t('trips.empty.create')}
        </Button>
      </Card>
    </div>
  );
}

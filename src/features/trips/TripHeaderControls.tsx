import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, ConfirmDialog, HeaderActions, useToast } from '@/components/ui';
import type { Trip } from '@/domain';
import { errorMessage } from '@/i18n/errors';
import { useDeleteTrip, useTripsQuery } from './hooks';
import { TripDialog } from './TripDialog';
import { tripDaysLabel, tripRangeLabel } from './tripLabels';

/**
 * The trip page's header bar (prototype `.trip-bar`): switch trip (FR-2.1), the trip's range and
 * length, edit (FR-2.6), delete with confirmation (FR-2.7) and new trip. Rendered into the app
 * header through <HeaderActions>. `exportAction` (the export button, FR-7) is passed in by the
 * trip page, so the trips feature does not depend on the export feature.
 */
export function TripHeaderControls({
  trip,
  exportAction,
}: {
  trip: Trip;
  exportAction?: ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const trips = useTripsQuery();
  const deleteTrip = useDeleteTrip();
  const [dialog, setDialog] = useState<'edit' | 'new' | 'delete' | null>(null);
  const selectId = useId();

  // The current trip is always an option, even before the list has loaded.
  const options = trips.data?.some((x) => x.id === trip.id)
    ? trips.data
    : [{ id: trip.id, name: trip.name }, ...(trips.data ?? [])];

  function confirmDelete() {
    deleteTrip.mutate(trip.id, {
      onSuccess: () => {
        setDialog(null);
        navigate('/trips', { replace: true });
        toast.show(t('trips.deleted', { name: trip.name }));
      },
      onError: (error) => {
        setDialog(null);
        toast.show(errorMessage(error, t), { tone: 'error' });
      },
    });
  }

  return (
    <HeaderActions>
      <label htmlFor={selectId} className="sr-only">
        {t('trips.switch')}
      </label>
      {/* Native select: switching trips navigates; styled like the prototype's `.trip-sel`. */}
      <select
        id={selectId}
        value={trip.id}
        onChange={(e) => navigate(`/trips/${e.target.value}`)}
        className="min-h-9 min-w-0 flex-1 cursor-pointer truncate rounded-[var(--radius-field)] border border-line-strong bg-bg px-3 py-1.5 font-medium text-ink outline-none focus-visible:border-accent-ink focus-visible:ring-2 focus-visible:ring-accent-soft tablet:max-w-60 tablet:min-w-40 tablet:flex-none pointer-coarse:min-h-10"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
      <span className="order-last w-full text-[13px] text-ink-soft tablet:order-none tablet:w-auto tablet:px-1">
        {tripRangeLabel(trip.window, t, 'short')} · {tripDaysLabel(trip.window, t)}
      </span>
      {exportAction}
      <Button size="sm" onClick={() => setDialog('edit')}>
        {t('trips.edit')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setDialog('delete')}>
        {t('common.delete')}
      </Button>
      <Button size="sm" variant="primary" onClick={() => setDialog('new')}>
        {t('trips.new')}
      </Button>

      <TripDialog open={dialog === 'edit'} trip={trip} onClose={() => setDialog(null)} />
      <TripDialog open={dialog === 'new'} onClose={() => setDialog(null)} />
      <ConfirmDialog
        open={dialog === 'delete'}
        title={t('trips.deleteConfirm.title')}
        message={t('trips.deleteConfirm.message', { name: trip.name })}
        loading={deleteTrip.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDialog(null)}
      />
    </HeaderActions>
  );
}

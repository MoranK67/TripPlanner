import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, ConfirmDialog, HeaderActions, useCanEdit, useToast } from '@/components/ui';
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
  // Offline the trip stays readable from the cache, but every change is disabled (M7.3).
  const { canEdit, reason } = useCanEdit();
  const [dialog, setDialog] = useState<'edit' | 'new' | 'delete' | null>(null);
  const selectId = useId();

  // The current trip is always an option, even before the list has loaded.
  const options = trips.data?.some((x) => x.id === trip.id)
    ? trips.data
    : [{ id: trip.id, name: trip.name }, ...(trips.data ?? [])];

  function confirmDelete() {
    if (!canEdit) return;
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
      {/* Native select: switching trips navigates; styled like the prototype's `.trip-sel`.
          Phones (UX-6): the selector takes a full row, then the trip's range, then the actions, so
          the trip name is not squeezed by the buttons. From tablet up everything sits in one row. */}
      <select
        id={selectId}
        value={trip.id}
        onChange={(e) => navigate(`/trips/${e.target.value}`)}
        className="min-h-9 w-full min-w-0 cursor-pointer truncate rounded-[var(--radius-field)] border border-line-strong bg-bg px-3 py-1.5 font-medium text-ink outline-none focus-visible:border-accent-ink focus-visible:ring-2 focus-visible:ring-accent-soft tablet:w-auto tablet:max-w-60 tablet:min-w-40 tablet:flex-none pointer-coarse:min-h-10"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
      <span className="w-full text-[13px] text-ink-soft tablet:w-auto tablet:px-1">
        {tripRangeLabel(trip.window, t, 'short')} · {tripDaysLabel(trip.window, t)}
      </span>
      {exportAction}
      <Button size="sm" disabled={!canEdit} title={reason} onClick={() => setDialog('edit')}>
        {t('trips.edit')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={!canEdit}
        title={reason}
        onClick={() => setDialog('delete')}
      >
        {t('common.delete')}
      </Button>
      <Button
        size="sm"
        variant="primary"
        disabled={!canEdit}
        title={reason}
        onClick={() => setDialog('new')}
      >
        {t('trips.new')}
      </Button>

      <TripDialog open={dialog === 'edit'} trip={trip} onClose={() => setDialog(null)} />
      <TripDialog open={dialog === 'new'} onClose={() => setDialog(null)} />
      <ConfirmDialog
        open={dialog === 'delete'}
        title={t('trips.deleteConfirm.title')}
        message={t('trips.deleteConfirm.message', { name: trip.name })}
        loading={deleteTrip.isPending}
        disabledReason={reason}
        onConfirm={confirmDelete}
        onCancel={() => setDialog(null)}
      />
    </HeaderActions>
  );
}

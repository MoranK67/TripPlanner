import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog, useCanEdit, useToast } from '@/components/ui';
import type { Activity, Trip } from '@/domain';
import { errorMessage, isAbortedError } from '@/i18n/errors';
import { ActivityDialog } from './ActivityDialog';
import { useDeleteActivity } from './hooks';

export interface ActivityDialogsOptions {
  /** Called right before a confirmed delete starts (e.g. to plan where focus goes next). */
  onDeleteStart?: (activity: Activity) => void;
  /** Called when the delete failed (the activity is back in the list). */
  onDeleteError?: (activity: Activity) => void;
}

export interface ActivityDialogsController {
  openAdd: () => void;
  /** Edit dialog for any activity, placed or in the bank (FR-3.5). */
  openEdit: (activity: Activity) => void;
  /** "Are you sure?" before deleting (FR-3.4); deletes optimistically after confirmation. */
  openDelete: (activity: Activity) => void;
  /** Render this once; it holds the add / edit dialog and the delete confirmation. */
  dialogs: ReactNode;
}

type DialogKind = 'add' | 'edit' | 'delete';

/**
 * The activity add / edit / delete dialogs, usable from the bank and from the timetable (the trip
 * page wires the timetable's blocks to it). The dialog kind and the item are kept separately, so a
 * closing dialog keeps showing the item it was opened for.
 */
export function useActivityDialogs(
  trip: Trip,
  /** All of the trip's activities (placement checks and tag suggestions in the dialog). */
  activities: readonly Activity[],
  { onDeleteStart, onDeleteError }: ActivityDialogsOptions = {},
): ActivityDialogsController {
  const { t } = useTranslation();
  const toast = useToast();
  const deleteActivity = useDeleteActivity(trip.id);
  const { canEdit, reason } = useCanEdit();
  const [open, setOpen] = useState<DialogKind | null>(null);
  const [item, setItem] = useState<Activity | null>(null);

  function show(kind: DialogKind, activity: Activity | null) {
    setItem(activity);
    setOpen(kind);
  }

  function confirmDelete(activity: Activity) {
    // Offline the confirm button is disabled (M7.3); never start a delete that can't reach the server.
    if (!canEdit) return;
    setOpen(null);
    onDeleteStart?.(activity);
    deleteActivity.mutate(activity.id, {
      onError: (error) => {
        onDeleteError?.(activity);
        if (!isAbortedError(error)) {
          toast.show(t('bank.deleteFailed', { reason: errorMessage(error, t) }), {
            tone: 'error',
          });
        }
      },
    });
  }

  const close = () => setOpen(null);

  const dialogs = (
    <>
      <ActivityDialog
        open={open === 'add' || open === 'edit'}
        onClose={close}
        trip={trip}
        activities={activities}
        activity={open === 'add' ? undefined : (item ?? undefined)}
      />
      <ConfirmDialog
        open={open === 'delete'}
        title={t('bank.deleteConfirm.title')}
        message={item ? t('bank.deleteConfirm.message', { name: item.name }) : ''}
        onConfirm={() => {
          if (item) confirmDelete(item);
        }}
        onCancel={close}
        disabledReason={reason}
      />
    </>
  );

  return {
    openAdd: () => show('add', null),
    openEdit: (activity) => show('edit', activity),
    openDelete: (activity) => show('delete', activity),
    dialogs,
  };
}

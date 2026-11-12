import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  /** Short question-like title, e.g. "מחיקת אטרקציה". Also the dialog's accessible name. */
  title: ReactNode;
  /** The question itself; becomes the dialog's accessible description. */
  message: ReactNode;
  /** Label of the confirming button. Defaults to "כן, למחוק" when `destructive`, else "אישור". */
  confirmLabel?: ReactNode;
  /** Label of the cancel button. Defaults to "ביטול". */
  cancelLabel?: ReactNode;
  onConfirm: () => void;
  /** Called on Cancel, Esc and backdrop click. Not called while `loading`. */
  onCancel: () => void;
  /** Danger styling for the confirm button (deletes). Default true. */
  destructive?: boolean;
  /**
   * The confirmed action is running: the confirm button shows a spinner, both buttons are
   * disabled and Esc / backdrop do nothing, so the user cannot cancel half-way.
   */
  loading?: boolean;
}

/**
 * "Are you sure?" dialog used before every delete (FR-2.7, FR-3.4).
 * **Cancel is focused when it opens**, so an accidental Enter / Space never destroys data
 * (DEVELOPMENT_GUIDELINES §7). Rendered as an `alertdialog` on top of the Modal primitive,
 * so it also works when opened from another dialog (e.g. delete from the edit dialog).
 * The caller closes it: set `open` to false in `onConfirm` (or once the mutation settles).
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  destructive = true,
  loading = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);

  // While loading, both buttons are disabled; a focused disabled button drops focus to <body>.
  // Park focus on the dialog itself instead, and give it back to Cancel when loading ends
  // (e.g. the delete failed and the dialog stays open).
  const wasLoading = useRef(loading);
  useEffect(() => {
    const cancel = cancelRef.current;
    if (open && cancel && loading !== wasLoading.current) {
      if (loading) {
        cancel.closest<HTMLElement>('[role="alertdialog"]')?.focus();
      } else {
        cancel.focus();
      }
    }
    wasLoading.current = loading;
  }, [open, loading]);

  function handleClose() {
    if (!loading) onCancel();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      description={message}
      role="alertdialog"
      showCloseButton={false}
      closeOnBackdrop={!loading}
      initialFocusRef={cancelRef}
      // Same order as the prototype: the action first (start side in RTL), Cancel after it.
      footer={
        <>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            loading={loading}
            onClick={onConfirm}
          >
            {confirmLabel ?? (destructive ? t('common.confirmDelete') : t('common.confirm'))}
          </Button>
          <Button ref={cancelRef} variant="ghost" disabled={loading} onClick={onCancel}>
            {cancelLabel ?? t('common.cancel')}
          </Button>
        </>
      }
    />
  );
}

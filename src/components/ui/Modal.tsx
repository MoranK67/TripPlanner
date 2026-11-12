import {
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { cx } from './cx';
import {
  getFocusable,
  ModalParentContext,
  pushModal,
  removeModal,
  type ModalEntry,
} from './modalStack';

export type ModalSize = 'md' | 'wide';

export interface ModalProps {
  open: boolean;
  /** Called on Esc, backdrop click and the close (×) button. */
  onClose: () => void;
  /** Dialog title; also the dialog's accessible name. */
  title: ReactNode;
  /** Optional lead text under the title; becomes the dialog's accessible description. */
  description?: ReactNode;
  children?: ReactNode;
  /** Action row (buttons) shown at the bottom. */
  footer?: ReactNode;
  /** `md` ≈ 440 px (forms), `wide` ≈ 560 px (import / export). */
  size?: ModalSize;
  /** Element to focus when the dialog opens. Defaults to the first focusable element in the body. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Close when the backdrop is clicked. Default true. */
  closeOnBackdrop?: boolean;
  /** Show the × button in the header. Default true. */
  showCloseButton?: boolean;
  /**
   * ARIA role. Use `alertdialog` for confirmations that interrupt the user (ConfirmDialog).
   * Default `dialog`.
   */
  role?: 'dialog' | 'alertdialog';
  className?: string;
}

/**
 * Accessible dialog (NFR-7): role="dialog" + aria-modal, focus moves in on open, Tab / Shift+Tab
 * are trapped, Esc closes, and focus returns to the element that opened it.
 * Rendered in a portal on <body>. Esc / Tab / focus containment are handled at document level for
 * the top-most modal only (see modalStack.ts), so they keep working even if focus falls to <body>.
 * Background content is not made `inert`, so the toast live region outside stays announced.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  initialFocusRef,
  closeOnBackdrop = true,
  showCloseButton = true,
  role = 'dialog',
  className,
}: ModalProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  const parent = useContext(ModalParentContext);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const focusInitialRef = useRef(() => {});
  useEffect(() => {
    focusInitialRef.current = () => {
      const dialog = dialogRef.current;
      const target =
        initialFocusRef?.current ??
        (bodyRef.current && getFocusable(bodyRef.current)[0]) ??
        (dialog && getFocusable(dialog)[0]) ??
        dialog;
      target?.focus();
    };
  });

  // One stable stack entry per Modal instance; it reads the latest values through refs.
  const [entry] = useState<ModalEntry>(() => ({
    parent,
    getDialog: () => dialogRef.current,
    close: () => onCloseRef.current(),
    restoreTo: null,
    focusInitial: () => focusInitialRef.current(),
  }));

  useEffect(() => {
    if (!open) return;
    // Only the top-most modal takes focus (matters when a parent and child open together).
    if (pushModal(entry)) entry.focusInitial();
    return () => removeModal(entry);
  }, [open, entry]);

  // Close on backdrop only when both the press and the click happened on the backdrop itself,
  // so a press that starts inside the dialog (text selection) or a touch "ghost click" never closes.
  const pressedOnBackdrop = useRef(false);

  if (!open) return null;

  function handleBackdropMouseDown(e: MouseEvent<HTMLDivElement>) {
    pressedOnBackdrop.current = e.target === e.currentTarget;
  }

  function handleBackdropClick(e: MouseEvent<HTMLDivElement>) {
    const pressed = pressedOnBackdrop.current;
    pressedOnBackdrop.current = false;
    if (closeOnBackdrop && pressed && e.target === e.currentTarget) onClose();
  }

  return createPortal(
    <ModalParentContext.Provider value={entry}>
      <div
        className="fixed inset-0 z-[2000] flex items-center justify-center bg-overlay p-4 backdrop-blur-[3px] motion-safe:animate-fade-in"
        onMouseDown={handleBackdropMouseDown}
        onClick={handleBackdropClick}
        data-testid="modal-backdrop"
      >
        <div
          ref={dialogRef}
          role={role}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className={cx(
            'max-h-[calc(100dvh-32px)] w-full overflow-auto rounded-[var(--radius-modal)] bg-panel p-6 text-ink shadow-[var(--shadow-pop)] outline-none',
            'motion-safe:animate-pop-in',
            size === 'wide' ? 'max-w-[560px]' : 'max-w-[440px]',
            className,
          )}
        >
          <div className="mb-4 flex items-start gap-3">
            <h2 id={titleId} className="m-0 flex-1 text-[19px] font-bold leading-snug">
              {title}
            </h2>
            {showCloseButton && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('common.close')}
                onClick={onClose}
                className="-me-2 -mt-1.5"
              >
                <span aria-hidden="true">×</span>
              </Button>
            )}
          </div>
          {description && (
            <p id={descriptionId} className="mt-0 mb-5 leading-relaxed text-ink-soft">
              {description}
            </p>
          )}
          <div ref={bodyRef}>{children}</div>
          {footer && <div className="mt-5 flex flex-wrap items-center gap-2">{footer}</div>}
        </div>
      </div>
    </ModalParentContext.Provider>,
    document.body,
  );
}

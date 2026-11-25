import {
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { cx } from './cx';
import { useBreakpoint } from './useBreakpoint';
import { ModalLayoutContext } from './modalLayout';
import {
  getFocusable,
  ModalParentContext,
  pushModal,
  removeModal,
  type ModalEntry,
} from './modalStack';

export type ModalSize = 'md' | 'wide';

/** How the dialog looks on phones (< 601 px). Tablet / desktop always show the centred card. */
export type ModalPhoneLayout = 'fullscreen' | 'card';

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
  /**
   * Phones (PHONE-1): `fullscreen` fills the screen with a fixed title bar, a scrolling body and
   * the action row (`footer` or a <ModalActions> inside the body) kept at the bottom; `card` keeps
   * the centred card. Default: `card` for `alertdialog` (short confirmations), else `fullscreen`.
   */
  phoneLayout?: ModalPhoneLayout;
  className?: string;
}

/**
 * Accessible dialog (NFR-7): role="dialog" + aria-modal, focus moves in on open, Tab / Shift+Tab
 * are trapped, Esc closes, and focus returns to the element that opened it.
 * Rendered in a portal on <body>. Esc / Tab / focus containment are handled at document level for
 * the top-most modal only (see modalStack.ts), so they keep working even if focus falls to <body>.
 * Background content is not made `inert`, so the toast live region outside stays announced.
 * On phones (PHONE-1) it fills the screen by default (see `phoneLayout`). The phone styles use the
 * `max-tablet:` variant only, so tablet / desktop render the card exactly as before.
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
  phoneLayout = role === 'alertdialog' ? 'card' : 'fullscreen',
  className,
}: ModalProps) {
  const { t } = useTranslation();
  const fs = phoneLayout === 'fullscreen';
  const phone = useBreakpoint() === 'phone';
  const viewportBox = useVisualViewportBox(open && fs && phone);
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

  // Phone full-screen layout (only `max-tablet:` classes, so tablet / desktop are unchanged): the
  // title bar stays at the top, the middle scrolls, and the action row sticks to the bottom.
  return createPortal(
    <ModalParentContext.Provider value={entry}>
      <ModalLayoutContext.Provider value={fs}>
        <div
          className={cx(
            'fixed inset-0 z-[2000] flex items-center justify-center bg-overlay p-4 backdrop-blur-[3px] motion-safe:animate-fade-in',
            fs && 'max-tablet:p-0',
          )}
          style={viewportBox}
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
            data-phone-layout={phoneLayout}
            className={cx(
              'max-h-[calc(100dvh-32px)] w-full overflow-auto rounded-[var(--radius-modal)] bg-panel p-6 text-ink shadow-[var(--shadow-pop)] outline-none',
              'motion-safe:animate-pop-in',
              size === 'wide' ? 'max-w-[560px]' : 'max-w-[440px]',
              fs &&
                'max-tablet:flex max-tablet:h-full max-tablet:max-h-none max-tablet:max-w-none max-tablet:flex-col max-tablet:overflow-hidden max-tablet:rounded-none max-tablet:p-0 max-tablet:shadow-none',
              className,
            )}
          >
            <div
              className={cx(
                'mb-4 flex items-start gap-3',
                fs &&
                  'max-tablet:mb-0 max-tablet:shrink-0 max-tablet:items-center max-tablet:border-b max-tablet:border-line max-tablet:px-4 max-tablet:pt-[max(10px,env(safe-area-inset-top))] max-tablet:pb-2.5',
              )}
            >
              <h2 id={titleId} className="m-0 flex-1 text-[19px] font-bold leading-snug">
                {title}
              </h2>
              {showCloseButton && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('common.close')}
                  onClick={onClose}
                  className={cx('-me-2 -mt-1.5', fs && 'max-tablet:mt-0')}
                >
                  <span aria-hidden="true">×</span>
                </Button>
              )}
            </div>
            {/* A plain wrapper on tablet / desktop: margins collapse through it as before. On phones
                it scrolls; scroll padding keeps a focused field clear of the sticky action row. */}
            <div
              className={cx(
                fs &&
                  'max-tablet:flex max-tablet:min-h-0 max-tablet:flex-1 max-tablet:flex-col max-tablet:scroll-pb-24 max-tablet:overflow-y-auto max-tablet:overscroll-contain max-tablet:p-4',
              )}
            >
              {description && (
                <p id={descriptionId} className="mt-0 mb-5 leading-relaxed text-ink-soft">
                  {description}
                </p>
              )}
              <div
                ref={bodyRef}
                className={cx(
                  fs && 'max-tablet:flex max-tablet:shrink-0 max-tablet:grow max-tablet:flex-col',
                )}
              >
                {children}
              </div>
              {footer && <ModalActions className="mt-5">{footer}</ModalActions>}
            </div>
          </div>
        </div>
      </ModalLayoutContext.Provider>
    </ModalParentContext.Provider>,
    document.body,
  );
}

/**
 * The action row of a dialog (save / cancel ...). Use it for buttons rendered inside the dialog's
 * body (forms, whose submit button must stay inside the <form>); `footer` uses it too. In a
 * full-screen phone dialog (PHONE-1) the row sits at the bottom and sticks there while the body
 * scrolls, so the buttons stay visible. Put it last; a <form> around it should carry
 * `MODAL_FORM_CLASS`, so the row can reach the bottom. Elsewhere it is a plain flex row.
 */
export function ModalActions({ children, className }: { children: ReactNode; className?: string }) {
  const fullScreen = useContext(ModalLayoutContext);
  return (
    <div
      data-modal-actions=""
      className={cx(
        'flex flex-wrap items-center gap-2',
        className,
        // Sticky offsets count from inside the scrolling body's 16 px padding: `-bottom-4` puts
        // the row on the screen's bottom edge, so content no longer shows through below it.
        fullScreen &&
          'max-tablet:sticky max-tablet:-bottom-4 max-tablet:z-[1] max-tablet:-mx-4 max-tablet:-mb-4 max-tablet:mt-auto max-tablet:border-t max-tablet:border-line max-tablet:bg-panel max-tablet:px-4 max-tablet:pt-3 max-tablet:pb-[max(12px,env(safe-area-inset-bottom))]',
      )}
    >
      {children}
    </div>
  );
}

/**
 * Keeps a full-screen phone dialog inside the visible part of the screen while the on-screen
 * keyboard is open. iOS shrinks only the visual viewport, so a `fixed; inset: 0` box would sit
 * partly under the keyboard and hide the action row. Returns the backdrop's top / height, or
 * nothing when not needed or not supported.
 */
function useVisualViewportBox(enabled: boolean): CSSProperties | undefined {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const vv = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!enabled || !vv) return;
    const viewport = vv;
    function update() {
      // Only when the keyboard (or zoom) shrinks the view; otherwise inset: 0 is right.
      const shrunk = window.innerHeight - viewport.height > 1;
      setBox(shrunk ? { top: viewport.offsetTop, height: viewport.height } : null);
    }
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      setBox(null);
    };
  }, [enabled]);
  return box ? { top: box.top, height: box.height, bottom: 'auto' } : undefined;
}

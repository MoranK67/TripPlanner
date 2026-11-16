import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from './cx';
import { ToastContext, type ToastApi, type ToastOptions, type ToastTone } from './toastContext';

export const TOAST_MS = 2800;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

interface ToastState {
  id: number;
  message: string;
  tone: ToastTone;
}

const toneClass: Record<ToastTone, string> = {
  info: 'bg-ink text-white',
  error: 'bg-danger-ink text-white',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nextId = useRef(0);

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setVisible(false);
  }, []);

  const show = useCallback(
    (message: string, { tone = 'info', durationMs = TOAST_MS }: ToastOptions = {}) => {
      nextId.current += 1;
      setToast({ id: nextId.current, message, tone });
      setVisible(true);
      clearTimeout(timer.current);
      // setTimeout overflows above 2^31-1 ms and would fire at once; treat that (and Infinity)
      // as "stay until dismiss()".
      if (Number.isFinite(durationMs) && durationMs <= MAX_TIMEOUT_MS) {
        timer.current = setTimeout(() => setVisible(false), durationMs);
      }
    },
    [],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* The live region is always mounted so screen readers announce new messages. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={cx(
          // inset-x-4 + mx-auto + w-fit centers without physical left/right (RTL-safe).
          'pointer-events-none fixed inset-x-4 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-[3000] mx-auto w-fit max-w-[min(480px,100%)] rounded-full px-[18px] py-2.5 text-center text-sm transition duration-200 motion-reduce:transition-none',
          toast ? toneClass[toast.tone] : toneClass.info,
          visible ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0',
        )}
      >
        {/* The text stays while fading out, hidden from screen readers; the key forces a
            re-announcement when the same text is shown twice in a row. */}
        {toast && (
          <span key={toast.id} aria-hidden={visible ? undefined : true}>
            {toast.message}
          </span>
        )}
      </div>
    </ToastContext.Provider>
  );
}

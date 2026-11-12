import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ToastContext } from './toastContext';

const TOAST_MS = 2800;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((msg: string) => {
    setMessage(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), TOAST_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed bottom-6 left-1/2 z-[3000] max-w-[calc(100%-32px)] -translate-x-1/2 rounded-full bg-ink px-[18px] py-2.5 text-center text-sm text-white transition duration-200 ${
          message ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'
        }`}
      >
        {message}
      </div>
    </ToastContext.Provider>
  );
}

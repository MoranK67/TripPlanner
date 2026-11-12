import { createContext, useContext } from 'react';

export type ToastTone = 'info' | 'error';

export interface ToastOptions {
  /** `error` uses the danger colors. Default `info`. */
  tone?: ToastTone;
  /**
   * How long the toast stays visible. Default 2800 ms (prototype).
   * `Infinity` (or anything above 2^31-1) keeps it until `dismiss()`.
   */
  durationMs?: number;
}

export interface ToastApi {
  /** Show a short message at the bottom of the screen (replaces the current one). */
  show: (message: string, options?: ToastOptions) => void;
  /** Hide the current toast immediately. */
  dismiss: () => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

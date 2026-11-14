// The single place that decides which platform the app runs on.
import type { PlatformKind } from './types';

type ShellGlobals = {
  /** Injected by Tauri 2 into its WebView. */
  __TAURI_INTERNALS__?: unknown;
  /** Injected by the Capacitor native bridge. */
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
  };
};

export function detectPlatformKind(
  globals: ShellGlobals = (typeof window === 'undefined' ? {} : window) as ShellGlobals,
): PlatformKind {
  if (globals.__TAURI_INTERNALS__ !== undefined) return 'desktop';
  const cap = globals.Capacitor;
  if (cap?.isNativePlatform?.() === true) {
    const name = cap.getPlatform?.();
    if (name === 'android') return 'android';
    if (name === 'ios') return 'ios';
  }
  return 'web';
}

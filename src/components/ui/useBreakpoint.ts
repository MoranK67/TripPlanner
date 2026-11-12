import { useSyncExternalStore } from 'react';

export type Breakpoint = 'phone' | 'tablet' | 'desktop';

/**
 * Minimum widths in CSS px, mirroring `--breakpoint-tablet` / `--breakpoint-desktop` in
 * tokens.css (PROJECT_PLAN M3.4: desktop ≥ 900 px, phone ≤ 600 px, tablet in between).
 */
export const BREAKPOINTS = { tablet: 601, desktop: 900 } as const;

const QUERIES = {
  tablet: `(min-width: ${BREAKPOINTS.tablet}px)`,
  desktop: `(min-width: ${BREAKPOINTS.desktop}px)`,
} as const;

function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

function subscribe(onChange: () => void): () => void {
  if (!hasMatchMedia()) return () => {};
  const lists = Object.values(QUERIES).map((q) => window.matchMedia(q));
  for (const list of lists) list.addEventListener('change', onChange);
  return () => {
    for (const list of lists) list.removeEventListener('change', onChange);
  };
}

function getSnapshot(): Breakpoint {
  // Without matchMedia (very old WebViews, some test setups) assume the full desktop layout.
  if (!hasMatchMedia()) return 'desktop';
  if (window.matchMedia(QUERIES.desktop).matches) return 'desktop';
  if (window.matchMedia(QUERIES.tablet).matches) return 'tablet';
  return 'phone';
}

/**
 * Current layout breakpoint, updated live on resize / rotation. Prefer the CSS variants
 * (`tablet:`, `desktop:`); use this only when the component tree itself differs per size
 * (e.g. the phone planner view, M7).
 */
export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'desktop');
}

import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HeaderSlotContext } from './headerSlot';

/**
 * Renders page-specific controls into the app header bar (e.g. the trip picker and trip actions
 * of the planner, M4/M5). Renders nothing outside the app layout. On phones the slot takes a full
 * row under the title; lay the children out with `flex` + `gap` and let them wrap.
 */
export function HeaderActions({ children }: { children: ReactNode }) {
  const target = useContext(HeaderSlotContext);
  return target ? createPortal(children, target) : null;
}

/** Provides the header slot element to the page tree. Used by the app layout only. */
export function HeaderSlotProvider({
  target,
  children,
}: {
  target: HTMLElement | null;
  children: ReactNode;
}) {
  return <HeaderSlotContext.Provider value={target}>{children}</HeaderSlotContext.Provider>;
}

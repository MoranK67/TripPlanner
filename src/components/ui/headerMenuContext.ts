import { createContext, useContext, useEffect, useId } from 'react';
import type { MenuItem } from './MenuButton';

/** One action registered into the phone header's "⋯" menu. */
export interface HeaderMenuEntry extends Omit<MenuItem, 'id'> {
  /** Position in the menu, lowest first; ties keep registration order. */
  order: number;
}

export interface HeaderMenuApi {
  /**
   * True on phones (PHONE-1): header actions are collected into one "⋯" menu instead of being
   * shown as buttons. False on tablet / desktop and outside the app layout.
   */
  collapsed: boolean;
  /** Adds / replaces (entry) or removes (null) the action with this id. */
  setItem: (id: string, entry: HeaderMenuEntry | null) => void;
  /** Adds / removes a muted note shown at the top of the menu (e.g. the trip's dates). */
  setNote: (id: string, note: string | null) => void;
}

export const HeaderMenuContext = createContext<HeaderMenuApi>({
  collapsed: false,
  setItem: () => {},
  setNote: () => {},
});

/** Whether the header actions are collapsed into the phone "⋯" menu. */
export function useHeaderMenuCollapsed(): boolean {
  return useContext(HeaderMenuContext).collapsed;
}

export interface HeaderMenuState {
  items: ReadonlyArray<HeaderMenuEntry & { id: string }>;
  note: string | null;
}

/** The collected menu, read by <HeaderMenuButton>. */
export const HeaderMenuStateContext = createContext<HeaderMenuState>({ items: [], note: null });

/** Shows `note` at the top of the phone "⋯" menu while set (e.g. the trip's dates). */
export function useHeaderMenuNote(note: string | null): void {
  const { collapsed, setNote } = useContext(HeaderMenuContext);
  const id = useId();
  useEffect(() => {
    if (!collapsed || !note) return;
    setNote(id, note);
    return () => setNote(id, null);
  }, [collapsed, setNote, id, note]);
}

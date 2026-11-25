import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button, type ButtonVariant } from './Button';
import {
  HeaderMenuContext,
  HeaderMenuStateContext,
  type HeaderMenuApi,
  type HeaderMenuEntry,
  type HeaderMenuState,
} from './headerMenuContext';
import { MenuButton } from './MenuButton';

/**
 * Collects the header actions of the app shell and the current page (PHONE-1). On phones
 * (`collapsed`) every <HeaderAction> registers itself here instead of rendering a button, and
 * <HeaderMenuButton> shows them all in one "⋯" menu. Used by the app layout only.
 */
export function HeaderMenuProvider({
  collapsed,
  children,
}: {
  collapsed: boolean;
  children: ReactNode;
}) {
  const [entries, setEntries] = useState<Record<string, HeaderMenuEntry & { seq: number }>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  // Registration order breaks ties between equal `order`s; kept per id across updates.
  const sequence = useRef(new Map<string, number>());

  const setItem = useCallback((id: string, entry: HeaderMenuEntry | null) => {
    let seq = sequence.current.get(id);
    if (seq === undefined) {
      seq = sequence.current.size;
      sequence.current.set(id, seq);
    }
    const value = entry && { ...entry, seq };
    setEntries((prev) => {
      const next = { ...prev };
      if (value) next[id] = value;
      else delete next[id];
      return next;
    });
  }, []);

  const setNote = useCallback((id: string, note: string | null) => {
    setNotes((prev) => {
      const next = { ...prev };
      if (note) next[id] = note;
      else delete next[id];
      return next;
    });
  }, []);

  const api = useMemo<HeaderMenuApi>(
    () => ({ collapsed, setItem, setNote }),
    [collapsed, setItem, setNote],
  );

  const state = useMemo<HeaderMenuState>(() => {
    const items = Object.entries(entries)
      .sort(([, a], [, b]) => a.order - b.order || a.seq - b.seq)
      .map(([id, entry]) => ({ ...entry, id }));
    const note = Object.values(notes).join(' · ') || null;
    return { items, note };
  }, [entries, notes]);

  return (
    <HeaderMenuContext.Provider value={api}>
      <HeaderMenuStateContext.Provider value={state}>{children}</HeaderMenuStateContext.Provider>
    </HeaderMenuContext.Provider>
  );
}

/** The phone header's "⋯" menu with every registered action. Renders nothing when empty. */
export function HeaderMenuButton({ label, className }: { label: string; className?: string }) {
  const { items, note } = useContext(HeaderMenuStateContext);
  if (items.length === 0) return null;
  return <MenuButton label={label} items={items} note={note} className={className} />;
}

export interface HeaderActionProps {
  /** Button text and menu item label. */
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /**
   * Tooltip of the button. When the action is disabled this is the reason, so the phone menu
   * shows it under the item (there is no hover on a phone).
   */
  title?: string;
  /** Button style on tablet / desktop. Default `soft`. */
  variant?: ButtonVariant;
  /** A running action: spinner on the button, a disabled item in the menu. */
  loading?: boolean;
  /** The action opens a dialog (`aria-haspopup="dialog"` on the button). */
  opensDialog?: boolean;
  /** `danger` colors the phone menu item (destructive actions). */
  tone?: 'default' | 'danger';
  /** Position in the phone menu, lowest first. Default 0. */
  order?: number;
}

/**
 * A header action (PHONE-1): a small button on tablet / desktop, an item of the "⋯" menu on
 * phones. Put it inside <HeaderActions> (page actions) or the app header.
 */
export function HeaderAction({
  label,
  onSelect,
  disabled = false,
  title,
  variant = 'soft',
  loading = false,
  opensDialog = false,
  tone = 'default',
  order = 0,
}: HeaderActionProps) {
  const { collapsed, setItem } = useContext(HeaderMenuContext);
  const id = useId();
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  const inactive = disabled || loading;
  useEffect(() => {
    if (!collapsed) return;
    setItem(id, {
      label,
      order,
      tone,
      disabled: inactive,
      disabledReason: disabled ? title : undefined,
      onSelect: () => onSelectRef.current(),
    });
    return () => setItem(id, null);
  }, [collapsed, setItem, id, label, order, tone, inactive, disabled, title]);

  if (collapsed) return null;
  return (
    <Button
      size="sm"
      variant={variant}
      loading={loading}
      disabled={disabled}
      title={title}
      aria-haspopup={opensDialog ? 'dialog' : undefined}
      onClick={onSelect}
    >
      {label}
    </Button>
  );
}

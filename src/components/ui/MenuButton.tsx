import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';

export interface MenuItem {
  /** Stable key. */
  id: string;
  /** Visible text; also the item's accessible name. */
  label: string;
  onSelect: () => void;
  /**
   * Shown but not selectable (`aria-disabled`, still reachable with the arrows, as the ARIA
   * menu pattern recommends, so screen-reader users learn that the action exists).
   */
  disabled?: boolean;
  /** Why the item is disabled (e.g. offline); shown under the label and used as its description. */
  disabledReason?: string;
  /** `danger` for destructive actions (delete). */
  tone?: 'default' | 'danger';
}

export interface MenuButtonProps {
  /** Accessible name of the trigger, e.g. "פעולות נוספות". */
  label: string;
  items: readonly MenuItem[];
  /** Visible trigger content. Default: a "⋯" symbol (then `label` names it). */
  trigger?: ReactNode;
  /** Optional muted text at the top of the popover (e.g. the trip's dates); describes the menu. */
  note?: ReactNode;
  className?: string;
}

/**
 * Menu button (ARIA APG "menu button" pattern, PHONE-1): a trigger with `aria-haspopup="menu"`
 * opens a popover `role="menu"` of `role="menuitem"` buttons.
 * Keyboard: Enter / Space / ↓ on the trigger open it on the first item, ↑ on the last; inside,
 * ↑ / ↓ move (wrapping), Home / End jump, Enter / Space choose, Esc and Tab close (Tab does not
 * move on to the next element; focus lands on the trigger). Focus returns
 * to the trigger whenever the menu closes from inside it (choosing an item included, so a dialog
 * opened by the item gives focus back to the trigger). A press outside closes it in place.
 * The popover opens below the trigger, aligned to its inline end, so it works in RTL and LTR.
 */
export function MenuButton({ label, items, trigger, note, className }: MenuButtonProps) {
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const menuId = `${baseId}-menu`;
  const noteId = `${baseId}-note`;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  // Which item to focus once the menu has rendered (set when it opens).
  const pendingFocus = useRef<'first' | 'last' | null>(null);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!open || target === null) return;
    pendingFocus.current = null;
    const items = itemRefs.current.filter((el): el is HTMLButtonElement => el !== null);
    (target === 'last' ? items.at(-1) : items[0])?.focus();
  }, [open]);

  // A press anywhere outside closes the menu without moving focus (the user is pointing elsewhere).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent | MouseEvent) {
      if (e.target instanceof Node && wrapperRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('mousedown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('mousedown', onPointerDown, true);
    };
  }, [open]);

  function openAt(focus: 'first' | 'last') {
    pendingFocus.current = focus;
    setOpen(true);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function choose(item: MenuItem) {
    if (item.disabled) return;
    // Focus goes back to the trigger first, so a dialog opened by the item restores it there.
    close(true);
    item.onSelect();
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openAt('first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openAt('last');
    }
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const count = items.length;
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    const move = (index: number) => itemRefs.current[(index + count) % count]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(current + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(current < 0 ? count - 1 : current - 1);
        break;
      case 'Home':
        e.preventDefault();
        move(0);
        break;
      case 'End':
        e.preventDefault();
        move(count - 1);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close(true);
        break;
      case 'Tab':
        // Tab / Shift+Tab leave the menu: it closes and focus goes back to the trigger (rather
        // than to the element after the item, which is unmounted with the menu), so the next Tab
        // continues from the trigger in the page's normal order.
        e.preventDefault();
        close(true);
        break;
      default:
    }
  }

  return (
    <div ref={wrapperRef} className={cx('relative', className)}>
      <Button
        ref={triggerRef}
        id={triggerId}
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onKeyDown={onTriggerKeyDown}
        // Mouse / touch toggle. Keyboard Enter / Space are handled on key down (which cancels the
        // button's own click), so the menu opens on its first item.
        onClick={() => (open ? close(false) : openAt('first'))}
        className={cx(open && 'bg-line text-ink')}
      >
        {trigger ?? (
          <span aria-hidden="true" className="text-xl font-bold">
            ⋯
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute end-0 top-full z-[1500] mt-1.5 w-max max-w-[calc(100vw-24px)] min-w-52 rounded-[var(--radius-field)] border border-line bg-panel py-1.5 text-ink shadow-[var(--shadow-pop)] motion-safe:animate-fade-in">
          {note && (
            <p
              id={noteId}
              className="m-0 border-b border-line px-4 pt-1.5 pb-2.5 text-[13px] text-ink-soft"
            >
              {note}
            </p>
          )}
          <div
            id={menuId}
            role="menu"
            aria-labelledby={triggerId}
            aria-describedby={note ? noteId : undefined}
            onKeyDown={onMenuKeyDown}
          >
            {items.map((item, i) => {
              const labelId = `${baseId}-item-${i}`;
              const reasonId = `${baseId}-reason-${i}`;
              const showReason = item.disabled && item.disabledReason;
              return (
                <button
                  key={item.id}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  aria-disabled={item.disabled || undefined}
                  aria-labelledby={labelId}
                  aria-describedby={showReason ? reasonId : undefined}
                  onClick={() => choose(item)}
                  className={cx(
                    'flex min-h-10 w-full cursor-pointer flex-col items-start justify-center border-0 bg-transparent px-4 py-2 text-start text-sm font-medium outline-none pointer-coarse:min-h-11',
                    'focus-visible:bg-accent-soft hover:bg-line',
                    item.tone === 'danger' ? 'text-danger-ink' : 'text-ink',
                    item.disabled && 'cursor-not-allowed opacity-55',
                  )}
                >
                  <span id={labelId}>{item.label}</span>
                  {showReason && (
                    <span
                      id={reasonId}
                      className="text-xs leading-snug font-normal whitespace-normal text-ink-soft"
                    >
                      {item.disabledReason}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

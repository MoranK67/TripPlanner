import { useId, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from '@/components/ui';
import {
  DragRootContext,
  useDragRoot,
  useIsDragging,
  type DragRootContextValue,
} from '../drag/dragContext';
import { usePlacing } from '../place/placingContext';

export interface BankSheetProps {
  /** Accessible name of the sheet and the handle's text, e.g. "מאגר אטרקציות". */
  label: string;
  /** Number of activities in the bank, shown on the collapsed handle. */
  count: number;
  /** The bank panel. */
  children: ReactNode;
}

/** Vertical travel (px) on the handle that opens / closes the sheet. */
const HANDLE_SWIPE_PX = 24;

const noRef = () => {};

/**
 * The bank as a bottom sheet on phones (M7.1). Collapsed it is a handle with the bank's name and
 * count; open it shows the bank panel under the timetable (in flow, so nothing is covered).
 *
 * Drag and drop: the whole sheet — handle included — is the "back to the bank" drop zone, so a
 * placed block can be returned while the sheet is collapsed. While any drag is in progress the
 * panel shrinks to zero height, so the timetable gets the room; the panel stays mounted (a removed
 * element would lose the finger's touch events mid-drag) and comes back after the drop.
 *
 * Tap-to-place (M7.2): while an activity waits for a slot the panel is hidden, so the day is in
 * full view; it comes back when the mode ends. The handle then leaves the mode and opens the bank.
 */
export function BankSheet({ label, count, children }: BankSheetProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const drag = useDragRoot();
  const dragging = useIsDragging();
  const placingMode = usePlacing();
  const placing = !!placingMode?.activity;
  const shown = open && !placing;

  // The sheet registers itself as the bank drop zone; the panel inside must not replace it.
  const inner = useMemo<DragRootContextValue | null>(
    () => (drag ? { ...drag, bankRef: noRef } : null),
    [drag],
  );

  // Swipe up / down on the handle opens / closes the sheet; the click that may follow is ignored.
  const swipe = useRef<{ id: number; y: number } | null>(null);
  const swiped = useRef(false);
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    swipe.current = { id: e.pointerId, y: e.clientY };
    swiped.current = false;
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dy = e.clientY - s.y;
    if (Math.abs(dy) < HANDLE_SWIPE_PX) return;
    swiped.current = true;
    if (dy < 0 && placing) placingMode?.cancel();
    setOpen(dy < 0);
  };
  const onClick = () => {
    if (swiped.current) {
      swiped.current = false;
      return;
    }
    if (placing) {
      placingMode?.cancel();
      setOpen(true);
      return;
    }
    setOpen((o) => !o);
  };

  return (
    <aside
      ref={drag?.bankRef}
      aria-label={label}
      data-testid="bank-sheet"
      data-open={shown || undefined}
      className="flex shrink-0 flex-col rounded-t-[var(--radius-card)] border border-b-0 border-line bg-panel pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-card)]"
    >
      <button
        type="button"
        aria-expanded={shown}
        aria-controls={panelId}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipe.current = null)}
        onPointerLeave={() => (swipe.current = null)}
        className={cx(
          'relative flex min-h-12 w-full touch-none flex-col items-center justify-center gap-1 rounded-t-[var(--radius-card)] px-4 pt-2 pb-2 select-none',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-ink',
        )}
      >
        <span aria-hidden="true" className="h-1 w-10 rounded-full bg-line-strong" />
        <span className="text-sm font-semibold text-ink">
          {label}{' '}
          <span className="text-xs font-normal text-ink-soft">
            {t('schedule.sheet.count', { count })}
          </span>
        </span>
      </button>
      <div
        id={panelId}
        hidden={!shown}
        data-testid="bank-sheet-panel"
        className={cx(
          'flex min-h-0 flex-col px-2',
          dragging ? 'h-0 overflow-hidden' : 'h-[45dvh] pb-2',
        )}
      >
        <DragRootContext.Provider value={inner}>{children}</DragRootContext.Provider>
        <p className="m-0 px-2 pt-1.5 text-center text-xs leading-normal text-ink-soft">
          {t('schedule.sheet.hintPlace')}
        </p>
      </div>
    </aside>
  );
}

// Tap-to-place (FR-5.5) and keyboard placement (FR-5.6, NFR-7 "all actions without drag"):
// pick an activity up (tap it on a phone, or press M on a focused block), then choose a start slot
// — valid ones are tinted — on any day. Used by TimetableDragRoot, which owns the data and the
// placement callbacks; this hook adds the mode, its DOM wiring and its focus management.
//
// What picks an activity up:
//   - a tap/click on a block's body in the phone's single-day view, or a touch tap on any layout
//     (a mouse click on the desktop grid still opens the edit dialog, FR-3.5);
//   - Enter/Space on a block in the phone view (same click), or M on a focused block anywhere;
//   - while the mode is on, any block activation picks that block up instead (the same one again
//     cancels). The bar's "edit" button opens the dialog that a tap used to open.
// A long press is a drag (usePointerDrag, 280 ms), a short tap is a click: the two never mix,
// because the click that follows a drag is swallowed by the engine.
//
// Phone single-day view (PHONE-2): a tapped slot is not placed at once. It is previewed (a ghost
// in green or red with half-hour earlier / later buttons, confirm and cancel) and only the confirm
// button saves. Keyboard choices (Enter / Space on a slot) and every other layout place at once.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { ToastApi } from '@/components/ui';
import {
  canPlace,
  formatShortDate,
  formatWeekday,
  SLOT_MINUTES,
  SLOTS_PER_DAY,
  type Activity,
  type IsoDate,
  type Minute,
  type Placement,
  type TripWindow,
} from '@/domain';
import type { DayView } from '../drag/dragContext';
import { readDirection } from '../drag/direction';
import { slotAtScrollTop, timeRangeLabel, type TimetableMetrics } from '../timetableLayout';
import type { PlacingContextValue } from './placingContext';
import { PlacingLayer, type ChooseVia, type FocusRequest } from './PlacingLayer';
import {
  dayChecks,
  firstValidSlot,
  moveCursor,
  placedByDate,
  placingReducer,
  type CursorKey,
  type PlacingVia,
  type SlotCursor,
} from './placingModel';

export interface TapToPlaceOptions {
  tripWindow: TripWindow;
  activities: readonly Activity[];
  /** All trip days (stable). */
  days: readonly IsoDate[];
  byId: ReadonlyMap<string, Activity>;
  /** Delegation root (bank + timetable). */
  rootRef: RefObject<HTMLElement>;
  scrollerRef: RefObject<HTMLElement>;
  columnsRef: RefObject<HTMLElement | null>;
  /** The days the timetable shows (phone: one day), `null` = all. */
  view: DayView | null;
  /** The day-columns layer to portal the slot layer into. */
  columnsEl: HTMLElement | null;
  /** The timetable's vertical scale (PHONE-2: denser on phones). */
  metrics: TimetableMetrics;
  /** `useCanEdit()` (M7.3): offline no placement can start or finish; `readOnlyReason` says why. */
  canEdit: boolean;
  readOnlyReason: string | undefined;
  onPlace: (activityId: string, date: IsoDate, startMinute: Minute) => void;
  onUnplace: (activityId: string) => void;
  toast: ToastApi;
}

export interface TapToPlace {
  /** For the PlacingContext provider (bar, bank sheet). */
  context: PlacingContextValue;
  /** The slot layer (portalled into the day columns) and the polite status region. */
  nodes: ReactNode;
  /** Leave the mode quietly (a drag started). */
  end: () => void;
}

/** Where focus goes once the data shows the result of an action. */
type PendingFocus =
  | { kind: 'placed'; id: string; target: Placement; until: number }
  | { kind: 'bank'; id: string; until: number }
  | { kind: 'element'; element: HTMLElement | null };

const PENDING_FOCUS_MS = 5000;

/**
 * After "שבץ" a quick second tap (a double tap) lands on whatever is now under the finger — often
 * a block, which a tap would pick up again. Taps on blocks are ignored for this long.
 */
export const CONFIRM_TAP_GUARD_MS = 400;

/** The block element(s) of an activity: one in the bank or in the grid. */
function findBlock(root: HTMLElement, id: string, inside?: HTMLElement | null): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>('[data-drag-id]')) {
    if (el.dataset.dragId !== id) continue;
    const inGrid = !!inside?.contains(el);
    if (inside === undefined || inGrid) return el;
  }
  return null;
}

function bankBlock(root: HTMLElement, id: string, columns: HTMLElement | null): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>('[data-drag-id]')) {
    if (el.dataset.dragId === id && !columns?.contains(el)) return el;
  }
  return null;
}

/** The block's focus target: its open button (ActivityBlock), else nothing. */
function openButton(block: HTMLElement | null): HTMLButtonElement | null {
  return block?.querySelector<HTMLButtonElement>('button:not([data-no-drag])') ?? null;
}

function isShown(el: Element): boolean {
  return el.isConnected && !el.closest('[hidden]');
}

export function useTapToPlace(options: TapToPlaceOptions): TapToPlace {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(placingReducer, null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  // Each preview made by a tap asks once for focus on its confirm button.
  const [previewFocus, setPreviewFocus] = useState<object | null>(null);
  const [placedCount, setPlacedCount] = useState(0);
  // A counter makes a repeated message (e.g. "cancelled" twice) a new text, so it is read again.
  const [announcement, setAnnouncementState] = useState({ text: '', n: 0 });
  const setAnnouncement = useCallback(
    (text: string) => setAnnouncementState((a) => ({ text, n: a.n + 1 })),
    [],
  );

  // Latest values for the DOM listeners and stable callbacks.
  const latest = useRef({ options, state });
  useLayoutEffect(() => {
    latest.current = { options, state };
  });
  const originRef = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef<PendingFocus | null>(null);
  const bypassClick = useRef(false);
  const confirmedAt = useRef(-Infinity);

  const { view, days, byId, columnsEl, tripWindow, activities, canEdit, metrics } = options;
  const subject = state ? (byId.get(state.id) ?? null) : null;

  const dayLabel = useCallback(
    (dayIndex: number) => {
      const date = days[dayIndex];
      if (!date) return '';
      return t('schedule.day.option', {
        weekday: formatWeekday(date),
        date: formatShortDate(date),
        n: dayIndex + 1,
      });
    },
    [days, t],
  );

  const showOffline = useCallback(() => {
    const { readOnlyReason, toast } = latest.current.options;
    if (readOnlyReason) toast.show(readOnlyReason, { tone: 'error' });
  }, []);

  /** Start slot for a freshly picked-up activity: its own slot, else the first valid one in view. */
  const initialCursor = useCallback((activity: Activity): SlotCursor => {
    const o = latest.current.options;
    const scroller = o.scrollerRef.current;
    let dayIndex: number;
    if (o.view) {
      dayIndex = o.view.start;
    } else if (activity.placement) {
      dayIndex = Math.max(0, o.days.indexOf(activity.placement.date));
    } else {
      // The first day column in view (RTL scrollLeft runs from 0 towards negative).
      const width = o.columnsRef.current?.getBoundingClientRect().width ?? 0;
      const column = o.days.length > 0 ? width / o.days.length : 0;
      const scrolled = scroller ? Math.abs(scroller.scrollLeft) : 0;
      dayIndex = column > 0 ? Math.min(o.days.length - 1, Math.floor(scrolled / column)) : 0;
    }
    const date = o.days[dayIndex];
    if (date && activity.placement?.date === date) {
      return { dayIndex, slot: activity.placement.startMinute / SLOT_MINUTES };
    }
    const from = scroller ? slotAtScrollTop(scroller.scrollTop, o.metrics.slotHeight) : 0;
    if (!date) return { dayIndex, slot: from };
    const checks = dayChecks(
      o.tripWindow,
      placedByDate(o.activities).get(date) ?? [],
      activity,
      date,
    );
    return { dayIndex, slot: firstValidSlot(checks, from) };
  }, []);

  const end = useCallback(() => {
    if (latest.current.state) dispatch({ type: 'end' });
  }, []);

  const cancel = useCallback(() => {
    if (!latest.current.state) return;
    dispatch({ type: 'end' });
    pendingFocus.current = { kind: 'element', element: originRef.current };
    setAnnouncement(t('schedule.place.cancelled'));
  }, [setAnnouncement, t]);

  const select = useCallback(
    (id: string, via: PlacingVia, block: HTMLElement) => {
      const o = latest.current.options;
      const activity = o.byId.get(id);
      if (!activity) return;
      if (latest.current.state?.id === id) {
        cancel();
        return;
      }
      if (!o.canEdit) {
        showOffline();
        return;
      }
      originRef.current = openButton(block) ?? block;
      pendingFocus.current = null;
      const cursor = initialCursor(activity);
      dispatch({ type: 'select', id, cursor, via });
      // A pointer tap must not scroll the view away from what the user is looking at.
      setFocusRequest({ preventScroll: via === 'pointer', dayIndex: cursor.dayIndex });
      setAnnouncement(t('schedule.place.started', { name: activity.name }));
    },
    [cancel, initialCursor, setAnnouncement, showOffline, t],
  );

  /** The `canPlace` result for the picked-up activity at a slot, or `null` if there is none. */
  const checkAt = useCallback((dayIndex: number, slot: number) => {
    const { options: o, state: s } = latest.current;
    const activity = s && o.byId.get(s.id);
    const date = o.days[dayIndex];
    if (!activity || !date) return null;
    const startMinute = slot * SLOT_MINUTES;
    const check = canPlace({ window: o.tripWindow, activities: o.activities }, activity, {
      date,
      startMinute,
    });
    return { activity, date, startMinute, check };
  }, []);

  /** Saves the picked-up activity at a slot (optimistic, through the drag root's `onPlace`). */
  const placeAt = useCallback(
    (dayIndex: number, slot: number) => {
      const o = latest.current.options;
      const at = checkAt(dayIndex, slot);
      if (!at) return;
      const { activity, date, startMinute, check } = at;
      if (!o.canEdit) {
        showOffline();
        dispatch({ type: 'end' });
        return;
      }
      if (!check.ok) {
        // Same message per kind as a drop or a server rejection (DEC-014); the mode stays on.
        o.toast.show(t(`errors.kinds.${check.reason}`), { tone: 'error' });
        return;
      }
      dispatch({ type: 'end' });
      setPlacedCount((n) => n + 1);
      const target = { date, startMinute };
      pendingFocus.current = {
        kind: 'placed',
        id: activity.id,
        target,
        until: Date.now() + PENDING_FOCUS_MS,
      };
      const { placement } = activity;
      if (placement?.date !== date || placement.startMinute !== startMinute) {
        o.onPlace(activity.id, date, startMinute);
      }
      setAnnouncement(
        t('schedule.place.placed', {
          name: activity.name,
          day: dayLabel(dayIndex),
          time: timeRangeLabel(startMinute, activity.durationMinutes),
        }),
      );
    },
    [checkAt, dayLabel, setAnnouncement, showOffline, t],
  );

  /** Announces the previewed slot: its time and, if it cannot be used, why (PHONE-2). */
  const announcePreview = useCallback(
    (dayIndex: number, slot: number) => {
      const at = checkAt(dayIndex, slot);
      if (!at) return;
      const time = timeRangeLabel(at.startMinute, at.activity.durationMinutes);
      setAnnouncement(
        at.check.ok
          ? t('schedule.preview.status', { name: at.activity.name, time })
          : t('schedule.preview.statusInvalid', {
              name: at.activity.name,
              time,
              reason: t(`errors.kinds.${at.check.reason}`),
            }),
      );
    },
    [checkAt, setAnnouncement, t],
  );

  const choose = useCallback(
    (dayIndex: number, slot: number, via: ChooseVia) => {
      const { options: o, state: s } = latest.current;
      if (!s || !o.days[dayIndex]) return;
      // Phone, finger or mouse: show where it would go first; only the confirm button saves.
      if (o.view && via === 'pointer') {
        dispatch({ type: 'preview', cursor: { dayIndex, slot } });
        setPreviewFocus({});
        announcePreview(dayIndex, slot);
        return;
      }
      placeAt(dayIndex, slot);
    },
    [announcePreview, placeAt],
  );

  const nudge = useCallback(
    (delta: -1 | 1) => {
      const preview = latest.current.state?.preview;
      if (!preview) return;
      const slot = Math.max(0, Math.min(SLOTS_PER_DAY - 1, preview.slot + delta));
      if (slot === preview.slot) return;
      dispatch({ type: 'nudge', delta });
      announcePreview(preview.dayIndex, slot);
    },
    [announcePreview],
  );

  const confirm = useCallback(() => {
    const preview = latest.current.state?.preview;
    if (!preview) return;
    confirmedAt.current = performance.now();
    placeAt(preview.dayIndex, preview.slot);
  }, [placeAt]);

  const unplace = useCallback(() => {
    const { options: o, state: s } = latest.current;
    const activity = s && o.byId.get(s.id);
    if (!activity?.placement) return;
    if (!o.canEdit) {
      showOffline();
      return;
    }
    dispatch({ type: 'end' });
    o.onUnplace(activity.id);
    pendingFocus.current = { kind: 'bank', id: activity.id, until: Date.now() + PENDING_FOCUS_MS };
    setAnnouncement(t('schedule.place.unplaced', { name: activity.name }));
  }, [setAnnouncement, showOffline, t]);

  const edit = useCallback((openPlaced?: (activity: Activity) => void) => {
    const { options: o, state: s } = latest.current;
    const activity = s && o.byId.get(s.id);
    const root = o.rootRef.current;
    if (!activity || !root) return;
    // Leave the mode first, so the bank sheet shows the block again and the dialog returns focus
    // to a visible element.
    flushSync(() => dispatch({ type: 'end' }));
    pendingFocus.current = null;
    if (activity.placement && openPlaced) {
      openButton(findBlock(root, activity.id, o.columnsRef.current))?.focus();
      openPlaced(activity);
      return;
    }
    // A bank block: let its own click handler (the bank feature's edit dialog) run once.
    const button = openButton(bankBlock(root, activity.id, o.columnsRef.current));
    if (!button) return;
    // The phone's sheet may be collapsed: then the dialog returns focus to the timetable.
    if (isShown(button)) button.focus();
    else o.scrollerRef.current?.focus({ preventScroll: true });
    bypassClick.current = true;
    try {
      button.click();
    } finally {
      bypassClick.current = false;
    }
  }, []);

  const onCursorKey = useCallback((key: CursorKey) => {
    const { options: o, state: s } = latest.current;
    if (!s) return;
    const v = o.view;
    const current = v ? { dayIndex: v.start, slot: s.cursor.slot } : s.cursor;
    const next = moveCursor(current, key, readDirection(o.scrollerRef.current), o.days.length);
    if (v && next.dayIndex !== current.dayIndex) v.shift(next.dayIndex > current.dayIndex ? 1 : -1);
    dispatch({ type: 'move', cursor: next });
    setFocusRequest({ preventScroll: false, dayIndex: next.dayIndex });
  }, []);

  // ---- DOM wiring: picking blocks up --------------------------------------------------------

  useEffect(() => {
    const root = options.rootRef.current;
    if (!root) return;
    let lastPointer = '';
    const onPointerDown = (e: PointerEvent) => {
      lastPointer = e.pointerType;
    };
    const blockOf = (target: EventTarget | null): HTMLElement | null => {
      const el = target instanceof Element ? target.closest<HTMLElement>('[data-drag-id]') : null;
      return el && root.contains(el) ? el : null;
    };
    const onClick = (e: MouseEvent) => {
      if (bypassClick.current) return;
      const block = blockOf(e.target);
      if (!block) return;
      const { options: o, state: s } = latest.current;
      // The second tap of a double tap on "שבץ": not a new pick-up (nor an edit).
      if (e.detail > 0 && performance.now() - confirmedAt.current < CONFIRM_TAP_GUARD_MS) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // The × (delete) keeps working; it ends the mode so its dialog is not mixed with it.
      if (e.target instanceof Element && e.target.closest('[data-no-drag]')) {
        if (s) dispatch({ type: 'end' });
        return;
      }
      const tap = o.view !== null || (e.detail > 0 && lastPointer === 'touch');
      if (!s && !tap) return; // a mouse click on the desktop grid opens the editor
      // Offline: nothing can be placed, so a tap opens the activity as before (M7.3).
      if (!s && !o.canEdit) return;
      e.preventDefault();
      e.stopPropagation();
      select(block.dataset.dragId ?? '', e.detail === 0 ? 'keyboard' : 'pointer', block);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'KeyM' || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
      const block = blockOf(e.target);
      if (!block || (e.target instanceof Element && e.target.closest('[data-no-drag]'))) return;
      e.preventDefault();
      select(block.dataset.dragId ?? '', 'keyboard', block);
    };
    root.addEventListener('pointerdown', onPointerDown, true);
    root.addEventListener('click', onClick, true);
    root.addEventListener('keydown', onKeyDown);
    return () => {
      root.removeEventListener('pointerdown', onPointerDown, true);
      root.removeEventListener('click', onClick, true);
      root.removeEventListener('keydown', onKeyDown);
    };
    // The root element is fixed for the page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [select]);

  // Escape cancels (not inside a dialog: there Escape closes the dialog).
  const placing = state !== null;
  useEffect(() => {
    if (!placing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return;
      e.preventDefault();
      cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placing, cancel]);

  // A preview belongs to the day it was made on: any day change (swipe, day switcher, keys) drops
  // it, so coming back to that day starts from a plain slot choice again.
  const viewStart = view?.start;
  const previewDay = state?.preview?.dayIndex;
  useEffect(() => {
    if (previewDay !== undefined && viewStart !== undefined && previewDay !== viewStart) {
      dispatch({ type: 'clearPreview' });
    }
  }, [previewDay, viewStart]);

  // The mode ends when it can no longer finish: offline, or the activity was deleted.
  useEffect(() => {
    if (!state) return;
    if (!canEdit) {
      dispatch({ type: 'end' });
      showOffline();
    } else if (!subject) {
      dispatch({ type: 'end' });
    }
  }, [state, canEdit, subject, showOffline]);

  // Mark the picked-up block (styled through DRAG_SOURCE_CLASS) and move focus once the data
  // shows the result of an action. Runs after every commit of the drag root, which happens only
  // on data or mode changes — never per pointer move.
  useEffect(() => {
    const o = latest.current.options;
    const root = o.rootRef.current;
    if (!root) return;
    const id = state?.id;
    for (const el of root.querySelectorAll<HTMLElement>('[data-drag-id]')) {
      if (el.dataset.dragId === id) el.dataset.picked = 'true';
      else if (el.dataset.picked) delete el.dataset.picked;
    }

    const pending = pendingFocus.current;
    if (!pending) return;
    const columns = o.columnsRef.current;
    const scroller = o.scrollerRef.current;
    if (pending.kind === 'element') {
      pendingFocus.current = null;
      const el = pending.element;
      if (el && isShown(el)) el.focus();
      else scroller?.focus({ preventScroll: true });
      return;
    }
    if (Date.now() > pending.until) {
      pendingFocus.current = null;
      return;
    }
    const activity = o.byId.get(pending.id);
    if (pending.kind === 'placed') {
      const p = activity?.placement;
      if (p?.date !== pending.target.date || p.startMinute !== pending.target.startMinute) return;
      const button = openButton(findBlock(root, pending.id, columns));
      if (!button) return;
      pendingFocus.current = null;
      button.focus();
      return;
    }
    if (activity?.placement !== null) return;
    const button = openButton(bankBlock(root, pending.id, columns));
    pendingFocus.current = null;
    if (button && isShown(button)) button.focus();
    else scroller?.focus({ preventScroll: true });
  });

  const context = useMemo<PlacingContextValue>(
    () => ({ activity: subject, cancel, unplace, edit, placedCount }),
    [subject, cancel, unplace, edit, placedCount],
  );

  const cursor: SlotCursor | null =
    state && (view ? { dayIndex: view.start, slot: state.cursor.slot } : state.cursor);
  // The preview belongs to the day it was made on; another shown day hides it (phone only).
  const preview = view && state?.preview?.dayIndex === view.start ? state.preview : null;

  const nodes = (
    <>
      {columnsEl &&
        subject &&
        cursor &&
        createPortal(
          <PlacingLayer
            days={days}
            firstDay={view?.start ?? 0}
            dayCount={view?.count ?? days.length}
            tripWindow={tripWindow}
            activities={activities}
            subject={subject}
            cursor={cursor}
            focusRequest={focusRequest}
            onChoose={choose}
            onCursorKey={onCursorKey}
            metrics={metrics}
            preview={preview}
            previewFocus={previewFocus}
            onNudge={nudge}
            onConfirm={confirm}
            onCancel={cancel}
          />,
          columnsEl,
        )}
      <p role="status" aria-live="polite" className="sr-only" data-testid="placing-status">
        {announcement.text}
        {/* Invisible, alternating: identical messages still change the region's text. */}
        {announcement.n % 2 === 1 ? ' ' : ''}
      </p>
    </>
  );

  return { context, nodes, end };
}

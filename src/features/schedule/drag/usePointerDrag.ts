// Pointer drag engine for the timetable (ADR-002): a React port of the prototype's engine
// (prototype/index.html, "Drag & drop (mouse + touch)") with these fixes:
//   - touch starts a drag only after a long press, so the bank list and the grid stay scrollable;
//   - one requestAnimationFrame loop does all reads (hit test, auto-scroll) then all writes (ghost);
//   - no React re-render per pointer move: the ghost is moved through a ref and the drop target is
//     published through a tiny external store only when it changes (slot/day/zone);
//   - the source block is dimmed with a data attribute, not React state;
//   - Escape cancels; the click that follows a mouse drag is swallowed (no accidental edit dialog).
// Draggables are found by event delegation: any element with `data-drag-id` inside `rootRef`.
// No role/tabIndex is added to the draggable, so ActivityBlock's own buttons are never nested.

import { useEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from 'react';
import type { Point } from './geometry';

export interface DragSource {
  id: string;
  pointerType: string;
  /** Pointer position minus the block's top-left corner at grab time. */
  grabOffset: Point;
  width: number;
  /** Pointer position when the drag started (for the ghost's first frame). */
  startPointer: Point;
}

export interface DragState<T> {
  source: DragSource | null;
  target: T | null;
}

export interface PointerDragConfig<T> {
  /** Delegation root: drags start from `[data-drag-id]` elements inside it. */
  rootRef: RefObject<HTMLElement>;
  /** Scroll container to auto-scroll; `getAutoScroll` decides the step. */
  scrollerRef: RefObject<HTMLElement>;
  getAutoScroll: (pointer: Point) => { dx: number; dy: number };
  /** Drop target under the pointer, or null. Called once per animation frame while dragging. */
  resolveTarget: (source: DragSource, pointer: Point) => T | null;
  /** Targets are compared with this to avoid publishing identical states. */
  sameTarget: (a: T | null, b: T | null) => boolean;
  onDrop: (source: DragSource, target: T | null) => void;
  onDragStart?: (source: DragSource) => void;
  /**
   * Asked when a drag would start (threshold passed / long press done). `false` drops the press
   * silently (no ghost, no drop); the caller explains why (e.g. offline, M7.3).
   */
  canStart?: (source: DragSource) => boolean;
  /** Mouse/pen: pixels to move before a drag starts (prototype: 6). */
  moveThreshold?: number;
  /** Touch: hold time before a drag starts. Moving earlier lets the page scroll instead. */
  longPressMs?: number;
  /** Touch: finger movement allowed during the long press. */
  touchTolerance?: number;
}

interface Session {
  pointerId: number;
  element: HTMLElement;
  source: DragSource;
  pointer: Point;
  started: boolean;
  /** `canStart` said no: ignore the rest of this press and swallow its click. */
  refused: boolean;
  timer: number | undefined;
  raf: number | undefined;
}

export interface DragStore<T> {
  get: () => DragState<T>;
  set: (next: DragState<T>) => void;
  subscribe: (listener: () => void) => () => void;
}

function createDragStore<T>(): DragStore<T> {
  let state: DragState<T> = { source: null, target: null };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next) => {
      state = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export interface PointerDrag<T> {
  store: DragStore<T>;
  /** Attach to the floating ghost element; the engine moves it with `transform`. */
  ghostRef: RefObject<HTMLDivElement>;
}

export function usePointerDrag<T>(config: PointerDragConfig<T>): PointerDrag<T> {
  const store = useMemo(() => createDragStore<T>(), []);
  const ghostRef = useRef<HTMLDivElement>(null);
  // Latest config without re-binding listeners on every render.
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  });

  useEffect(() => {
    const root = config.rootRef.current;
    if (!root) return;
    let session: Session | null = null;
    let releaseClickGuard = () => {};

    const moveGhost = (s: Session) => {
      const ghost = ghostRef.current;
      if (!ghost) return;
      const { x, y } = s.pointer;
      ghost.style.transform = `translate3d(${x - s.source.grabOffset.x}px, ${y - s.source.grabOffset.y}px, 0)`;
    };

    const frame = () => {
      const s = session;
      if (!s?.started) return;
      const cfg = configRef.current;
      // Reads first …
      const scroller = cfg.scrollerRef.current;
      const step = cfg.getAutoScroll(s.pointer);
      if (scroller && (step.dx || step.dy)) scroller.scrollBy(step.dx, step.dy);
      const target = cfg.resolveTarget(s.source, s.pointer);
      // … then writes.
      const current = store.get();
      if (!cfg.sameTarget(current.target, target)) store.set({ source: s.source, target });
      moveGhost(s);
      s.raf = requestAnimationFrame(frame);
    };

    const start = (s: Session) => {
      const allowed = configRef.current.canStart?.(s.source) ?? true;
      if (!allowed) {
        // Keep the session until the pointer is released, so its click does not open the block.
        s.refused = true;
        return;
      }
      s.started = true;
      s.element.dataset.dragging = 'true';
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
      store.set({ source: s.source, target: null });
      configRef.current.onDragStart?.(s.source);
      s.raf = requestAnimationFrame(frame);
    };

    const finish = (drop: boolean) => {
      const s = session;
      if (!s) return;
      session = null;
      window.clearTimeout(s.timer);
      if (s.raf !== undefined) cancelAnimationFrame(s.raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      if (!s.started) {
        // A refused drag still ends in a click on the block: it must not open the edit dialog.
        if (s.refused && drop) releaseClickGuard = swallowNextClick();
        return;
      }
      delete s.element.dataset.dragging;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      const cfg = configRef.current;
      const target = drop ? cfg.resolveTarget(s.source, s.pointer) : null;
      store.set({ source: null, target: null });
      if (drop) {
        releaseClickGuard = swallowNextClick();
        cfg.onDrop(s.source, target);
      }
    };

    function onMove(e: PointerEvent) {
      const s = session;
      if (!s || e.pointerId !== s.pointerId) return;
      s.pointer = { x: e.clientX, y: e.clientY };
      if (s.refused) return;
      if (s.started) {
        e.preventDefault();
        return; // the frame loop picks up the new position
      }
      const cfg = configRef.current;
      const moved = Math.hypot(
        e.clientX - s.source.startPointer.x,
        e.clientY - s.source.startPointer.y,
      );
      if (s.source.pointerType === 'touch') {
        // Finger moved before the long press completed: the user is scrolling, let the browser have it.
        if (moved > (cfg.touchTolerance ?? 8)) finish(false);
      } else if (moved >= (cfg.moveThreshold ?? 6)) {
        start(s);
      }
    }
    function onUp() {
      // A press without a drag falls through to the normal click (opens the edit dialog, FR-3.5).
      finish(true);
    }
    function onCancel() {
      finish(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && session?.started) {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      if (session) return;
      releaseClickGuard();
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const target = e.target instanceof Element ? e.target : null;
      const element = target?.closest<HTMLElement>('[data-drag-id]');
      if (!element || !root.contains(element) || target?.closest('[data-no-drag]')) return;
      const rect = element.getBoundingClientRect();
      const pointer = { x: e.clientX, y: e.clientY };
      const s: Session = {
        pointerId: e.pointerId,
        element,
        pointer,
        started: false,
        refused: false,
        timer: undefined,
        raf: undefined,
        source: {
          id: element.dataset.dragId ?? '',
          pointerType: e.pointerType,
          grabOffset: { x: pointer.x - rect.left, y: pointer.y - rect.top },
          width: rect.width,
          startPointer: pointer,
        },
      };
      session = s;
      if (e.pointerType === 'touch') {
        s.timer = window.setTimeout(() => {
          if (session === s) {
            navigator.vibrate?.(10);
            start(s);
          }
        }, configRef.current.longPressMs ?? 280);
      }
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKey, true);
    };

    // Once a touch drag is active, cancel the browser's panning. This listener must be non-passive
    // and registered before the gesture; otherwise Chrome/Safari fire pointercancel and scroll.
    // It is scoped to the root (touches that start on a draggable bubble through it), so scrolling
    // elsewhere on the page never runs through a non-passive listener.
    const onTouchMove = (e: TouchEvent) => {
      if (session?.started && e.cancelable) e.preventDefault();
    };
    // Android shows a context menu / iOS a callout on long press.
    const onContextMenu = (e: Event) => {
      if (session) e.preventDefault();
    };

    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('touchmove', onTouchMove, { passive: false });
    root.addEventListener('contextmenu', onContextMenu);
    return () => {
      finish(false);
      releaseClickGuard();
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('touchmove', onTouchMove);
      root.removeEventListener('contextmenu', onContextMenu);
    };
    // The root element is fixed for the page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  return { store, ghostRef };
}

/** Subscribe a small component (preview, ghost, bank highlight) to the drag state. */
export function useDragState<T>(store: DragStore<T>): DragState<T> {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/**
 * Only the dragged source: re-renders when a drag starts or ends, not when the target changes.
 * (The engine publishes the same `source` object for the whole drag.)
 */
export function useDragSource<T>(store: DragStore<T>): DragSource | null {
  const getSource = () => store.get().source;
  return useSyncExternalStore(store.subscribe, getSource, getSource);
}

/**
 * The click event that follows a mouse drag must not open the block's edit dialog. Browsers
 * dispatch it in the same task as pointerup, so the guard is released on the next task (or on the
 * next pointerdown / unmount, whichever comes first). Returns the release function.
 */
function swallowNextClick(): () => void {
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const release = () => {
    window.clearTimeout(timer);
    window.removeEventListener('click', swallow, true);
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  const timer = window.setTimeout(release, 0);
  return release;
}

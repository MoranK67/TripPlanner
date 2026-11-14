import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Profiler } from 'react';
import { ActivityBlock, ToastProvider } from '@/components/ui';
import { PALETTE, type Activity, type Trip } from '@/domain';
import { Timetable } from '../Timetable';
import { dragSourceProps, useBankDropZone } from './dragContext';
import { TimetableDragRoot } from './TimetableDragRoot';

// jsdom has no layout, so the test supplies the rectangles the engine measures. Geometry (RTL):
// scroller 800×600 at the origin, 56 px header, 64 px time column, 7 columns of 150 px scrolled
// so that slot s starts at y = s × 28 − 344. The bank sits to the right of the timetable.
const COLUMNS = { left: 736 - 1050, top: -344, right: 736, bottom: -344 + 48 * 28 };
const BANK = { left: 820, top: 0, right: 1100, bottom: 600 };
/** Every draggable block is measured here, so the grab point (950, 110) is 10 px below its top. */
const BLOCK = { left: 900, top: 100, right: 1080, bottom: 155 };
/** Pointer y whose block top (grab offset 10) snaps to `slot`. */
const yForSlot = (slot: number) => slot * 28 - 344 + 10;
/** Pointer x in the middle of day column `dayIndex` (0 = right-most in RTL). */
const xForDay = (dayIndex: number) => 736 - 150 * dayIndex - 75;

function rect(r: { left: number; top: number; right: number; bottom: number }): DOMRect {
  return {
    ...r,
    x: r.left,
    y: r.top,
    width: r.right - r.left,
    height: r.bottom - r.top,
    toJSON: () => r,
  };
}

const trip: Trip = {
  id: 'trip-1',
  name: 'טיול',
  colorCursor: 0,
  window: {
    startDate: '2026-12-01',
    startMinute: 14 * 60,
    endDate: '2026-12-07',
    endMinute: 11 * 60,
  },
};

const market: Activity = {
  id: 'bank-1',
  tripId: 'trip-1',
  name: 'שוק',
  durationMinutes: 60,
  color: PALETTE[0],
  placement: null,
  bankPosition: 1,
};
const museum: Activity = {
  id: 'placed-1',
  tripId: 'trip-1',
  name: 'מוזיאון',
  durationMinutes: 90,
  color: PALETTE[1],
  placement: { date: '2026-12-02', startMinute: 9 * 60 },
  bankPosition: 0,
};
const activities = [market, museum];

/** Stand-in for BankPanel: the same two contract calls the real bank makes. */
function FakeBank({ items }: { items: Activity[] }) {
  const setDropZone = useBankDropZone();
  return (
    <div ref={setDropZone} data-testid="bank">
      {items.map((a) => (
        <ActivityBlock
          key={a.id}
          {...dragSourceProps(a.id)}
          name={a.name}
          durationMinutes={a.durationMinutes}
          color={a.color}
        />
      ))}
    </div>
  );
}

let frames: FrameRequestCallback[] = [];
/** Runs the engine's pending animation frame (hit test, auto-scroll, preview). */
function runFrame() {
  const pending = frames;
  frames = [];
  act(() => pending.forEach((cb) => cb(performance.now())));
}

beforeEach(() => {
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (el.dataset.testid === 'timetable-columns') return rect(COLUMNS);
    if (el.dataset.testid === 'timetable-scroller')
      return rect({ left: 0, top: 0, right: 800, bottom: 600 });
    if (el.dataset.testid === 'bank') return rect(BANK);
    if (el.dataset.dragId) return rect(BLOCK);
    return rect({ left: 0, top: 0, right: 0, bottom: 0 });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderRoot({ onRender }: { onRender?: () => void } = {}) {
  const onPlace = vi.fn();
  const onUnplace = vi.fn();
  const onOpen = vi.fn();
  const timetable = <Timetable trip={trip} activities={activities} onOpenActivity={onOpen} />;
  render(
    <ToastProvider>
      <TimetableDragRoot
        trip={trip}
        activities={activities}
        onPlace={onPlace}
        onUnplace={onUnplace}
      >
        <FakeBank items={activities.filter((a) => !a.placement)} />
        {onRender ? (
          <Profiler id="timetable" onRender={onRender}>
            {timetable}
          </Profiler>
        ) : (
          timetable
        )}
      </TimetableDragRoot>
    </ToastProvider>,
  );
  const scroller = screen.getByTestId('timetable-scroller');
  Object.defineProperty(scroller, 'clientWidth', { value: 800 });
  Object.defineProperty(scroller, 'clientHeight', { value: 600 });
  // jsdom does not inherit `direction` from <html dir="rtl">; a browser computes it.
  scroller.style.direction = 'rtl';
  const scrollBy = vi.fn();
  scroller.scrollBy = scrollBy as unknown as typeof scroller.scrollBy;
  return { onPlace, onUnplace, onOpen, scrollBy };
}

function blockOf(id: string): HTMLElement {
  const block = document.querySelector<HTMLElement>(`[data-drag-id="${id}"]`);
  if (!block) throw new Error(`no block ${id}`);
  return block;
}

/** Mouse press on a block and a move past the start threshold. */
function startMouseDrag(id: string) {
  fireEvent.pointerDown(blockOf(id), {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    clientX: 950,
    clientY: 110,
  });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 940, clientY: 120 });
}
function moveTo(x: number, y: number) {
  fireEvent.pointerMove(document, { pointerId: 1, clientX: x, clientY: y });
}
function release(x: number, y: number) {
  fireEvent.pointerUp(document, { pointerId: 1, clientX: x, clientY: y });
}
function dragTo(id: string, x: number, y: number) {
  startMouseDrag(id);
  moveTo(x, y);
  release(x, y);
}

describe('TimetableDragRoot', () => {
  it('places a bank block in the RTL column under the pointer, snapped to the half hour', () => {
    const { onPlace } = renderRoot();
    // Day 2 (second column from the right); +9 px still snaps to 11:00 (slot 22).
    dragTo('bank-1', xForDay(1), yForSlot(22) + 9);
    expect(onPlace).toHaveBeenCalledWith('bank-1', '2026-12-02', 11 * 60);
  });

  it('moves a placed block to another day and time', () => {
    const { onPlace } = renderRoot();
    dragTo('placed-1', xForDay(3), yForSlot(30));
    expect(onPlace).toHaveBeenCalledWith('placed-1', '2026-12-04', 15 * 60);
  });

  it('does nothing when a placed block is dropped on its own slot', () => {
    const { onPlace } = renderRoot();
    dragTo('placed-1', xForDay(1), yForSlot(18));
    expect(onPlace).not.toHaveBeenCalled();
  });

  it('returns a placed block to the bank, but not a bank block', () => {
    const { onUnplace } = renderRoot();
    dragTo('placed-1', 950, 300);
    expect(onUnplace).toHaveBeenCalledWith('placed-1');
    dragTo('bank-1', 1000, 400);
    expect(onUnplace).toHaveBeenCalledTimes(1);
  });

  it('rejects a drop before the trip start with the out_of_range message', () => {
    const { onPlace, onUnplace } = renderRoot();
    dragTo('bank-1', xForDay(0), yForSlot(20)); // day 1 starts at 14:00
    expect(screen.getByText('הזמן הזה מחוץ לתאריכים ולשעות של הטיול.')).toBeInTheDocument();
    expect(onPlace).not.toHaveBeenCalled();
    expect(onUnplace).not.toHaveBeenCalled();
  });

  it('rejects an overlapping drop with the conflict_overlap message', () => {
    const { onPlace } = renderRoot();
    dragTo('bank-1', xForDay(1), yForSlot(20)); // 10:00 overlaps 09:00–10:30
    expect(screen.getByText('יש כבר אטרקציה אחרת בזמן הזה.')).toBeInTheDocument();
    expect(onPlace).not.toHaveBeenCalled();
  });

  it('ignores a drop outside the timetable and the bank', () => {
    const { onPlace, onUnplace } = renderRoot();
    dragTo('placed-1', 790, 2000);
    expect(onPlace).not.toHaveBeenCalled();
    expect(onUnplace).not.toHaveBeenCalled();
  });

  it('shows a green preview for a valid slot and a red one for an invalid slot', () => {
    renderRoot();
    startMouseDrag('bank-1');
    moveTo(xForDay(1), yForSlot(22));
    runFrame();
    const preview = screen.getByTestId('drop-preview');
    expect(preview).toHaveAttribute('data-valid', 'true');
    expect(preview.style.top).toBe(`${22 * 28 + 1}px`);
    // Day index 1 of 7 (jsdom simplifies the calc).
    expect(preview.style.insetInlineStart).toBe('calc(14.2857% + 4px)');
    moveTo(xForDay(1), yForSlot(20));
    runFrame();
    expect(screen.getByTestId('drop-preview')).toHaveAttribute('data-valid', 'false');
    release(xForDay(1), yForSlot(20));
    expect(screen.queryByTestId('drop-preview')).not.toBeInTheDocument();
  });

  it('never previews a slot under the sticky day header or time column', () => {
    renderRoot();
    startMouseDrag('bank-1');
    moveTo(xForDay(1), 30); // header row
    runFrame();
    expect(screen.queryByTestId('drop-preview')).not.toBeInTheDocument();
    moveTo(770, 300); // time column (right side in RTL)
    runFrame();
    expect(screen.queryByTestId('drop-preview')).not.toBeInTheDocument();
  });

  it('highlights the bank while a placed block is over it', () => {
    renderRoot();
    const bank = screen.getByTestId('bank');
    startMouseDrag('placed-1');
    moveTo(950, 300);
    runFrame();
    expect(bank).toHaveAttribute('data-drop-over');
    expect(bank).toHaveClass('ring-2');
    moveTo(xForDay(2), yForSlot(30));
    runFrame();
    expect(bank).not.toHaveAttribute('data-drop-over');
    expect(bank).not.toHaveClass('ring-2');
  });

  it('auto-scrolls towards later days near the left edge in RTL, and up near the header', () => {
    const { scrollBy } = renderRoot();
    startMouseDrag('bank-1');
    moveTo(5, 300);
    runFrame();
    expect(scrollBy).toHaveBeenLastCalledWith(expect.any(Number), 0);
    expect(scrollBy.mock.lastCall?.[0]).toBeLessThan(0);
    moveTo(400, 60);
    runFrame();
    expect(scrollBy.mock.lastCall?.[1]).toBeLessThan(0);
  });

  it('cancels on Escape: no drop, no ghost, no preview', () => {
    const { onPlace } = renderRoot();
    startMouseDrag('bank-1');
    moveTo(xForDay(1), yForSlot(22));
    runFrame();
    expect(screen.getByTestId('drag-ghost')).toBeInTheDocument();
    expect(blockOf('bank-1')).toHaveAttribute('data-dragging', 'true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('drag-ghost')).not.toBeInTheDocument();
    expect(screen.queryByTestId('drop-preview')).not.toBeInTheDocument();
    expect(blockOf('bank-1')).not.toHaveAttribute('data-dragging');
    release(xForDay(1), yForSlot(22));
    expect(onPlace).not.toHaveBeenCalled();
  });

  it('treats a press without movement as a click (opens the editor)', () => {
    const { onOpen, onPlace } = renderRoot();
    const block = blockOf('placed-1');
    fireEvent.pointerDown(block, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 950,
      clientY: 110,
    });
    release(950, 110);
    fireEvent.click(within(block).getByRole('button'));
    expect(onOpen).toHaveBeenCalledWith(museum);
    expect(onPlace).not.toHaveBeenCalled();
  });

  it('does not re-render the timetable while dragging (NFR-3)', () => {
    const onRender = vi.fn();
    renderRoot({ onRender });
    onRender.mockClear();
    startMouseDrag('bank-1');
    for (const slot of [22, 24, 20, 30]) {
      moveTo(xForDay(1), yForSlot(slot));
      runFrame();
    }
    release(xForDay(1), yForSlot(30));
    expect(onRender).not.toHaveBeenCalled();
  });

  describe('touch', () => {
    function touchDown() {
      fireEvent.pointerDown(blockOf('bank-1'), {
        pointerId: 2,
        pointerType: 'touch',
        clientX: 950,
        clientY: 110,
      });
    }

    it('starts a drag after a long press and drops where the finger lifts', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { onPlace } = renderRoot();
      touchDown();
      act(() => vi.advanceTimersByTime(300));
      expect(screen.getByTestId('drag-ghost')).toBeInTheDocument();
      fireEvent.pointerMove(document, { pointerId: 2, clientX: xForDay(2), clientY: yForSlot(26) });
      fireEvent.pointerUp(document, { pointerId: 2, clientX: xForDay(2), clientY: yForSlot(26) });
      expect(onPlace).toHaveBeenCalledWith('bank-1', '2026-12-03', 13 * 60);
    });

    it('leaves a quick swipe to the browser (scrolling), without dragging', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { onPlace } = renderRoot();
      touchDown();
      fireEvent.pointerMove(document, { pointerId: 2, clientX: 950, clientY: 160 });
      act(() => vi.advanceTimersByTime(300));
      expect(screen.queryByTestId('drag-ghost')).not.toBeInTheDocument();
      fireEvent.pointerUp(document, { pointerId: 2, clientX: xForDay(1), clientY: yForSlot(22) });
      expect(onPlace).not.toHaveBeenCalled();
    });
  });
});

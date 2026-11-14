import { fireEvent, render, screen, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui';
import { SpikePlanner } from './DndSpikePage';

// jsdom has no layout, so the test supplies the rectangles the engine measures. Geometry (RTL):
// scroller 800×600 at the origin, 56 px header, 64 px time column, 7 columns of 150 px scrolled
// so that slot s starts at y = s × 28 − 344.
const COLUMNS = { left: 736 - 1050, top: -344, right: 736, bottom: -344 + 48 * 28 };
const BANK = { left: 820, top: 0, right: 1100, bottom: 600 };

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

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (el.dataset.testid === 'timetable-columns') return rect(COLUMNS);
    if (el.dataset.testid === 'timetable-scroller')
      return rect({ left: 0, top: 0, right: 800, bottom: 600 });
    if (el.dataset.testid === 'spike-bank') return rect(BANK);
    if (el.dataset.dragId) return rect({ left: 900, top: 100, right: 1080, bottom: 155 });
    return rect({ left: 0, top: 0, right: 0, bottom: 0 });
  });
});

afterEach(() => vi.restoreAllMocks());

function renderPlanner() {
  const utils = render(
    <ToastProvider>
      <SpikePlanner dayCount={7} />
    </ToastProvider>,
  );
  const scroller = screen.getByTestId('timetable-scroller');
  Object.defineProperty(scroller, 'clientWidth', { value: 800 });
  Object.defineProperty(scroller, 'clientHeight', { value: 600 });
  // jsdom does not inherit `direction` from <html dir="rtl">; a browser computes it.
  scroller.style.direction = 'rtl';
  return utils;
}

/** Mouse drag from a block to a point (grab point is 10 px below the block top). */
function drag(block: HTMLElement, to: { x: number; y: number }) {
  fireEvent.pointerDown(block, {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    clientX: 950,
    clientY: 110,
  });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 900, clientY: 120 });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(document, { pointerId: 1, clientX: to.x, clientY: to.y });
}

function bankBlock(name: string) {
  return within(screen.getByTestId('spike-bank'))
    .getAllByRole('button')
    .find((b) => b.textContent?.includes(name))
    ?.closest<HTMLElement>('[data-drag-id]');
}

describe('drag spike', () => {
  it('renders one header per trip day and the bank', () => {
    renderPlanner();
    expect(screen.getAllByText(/יום \d+$/)).toHaveLength(7);
    expect(within(screen.getByTestId('spike-bank')).getAllByRole('button').length).toBe(10);
  });

  it('places a bank block in the RTL column under the pointer, snapped to the slot', () => {
    renderPlanner();
    const block = bankBlock('שוק האיכרים'); // 60 minutes
    expect(block).toBeTruthy();
    // Second column from the right (day 2), block top at 11:00 (slot 22 → y = 22 × 28 − 344 + 10).
    drag(block!, { x: 736 - 225, y: 282 });
    const day2 = document.querySelector('[data-day="2026-12-02"]') as HTMLElement;
    expect(within(day2).getByText('11:00–12:00')).toBeInTheDocument();
    expect(bankBlock('שוק האיכרים')).toBeUndefined();
  });

  it('rejects a drop before the trip start with a notice and keeps the block in the bank', () => {
    renderPlanner();
    drag(bankBlock('שוק האיכרים')!, { x: 736 - 75, y: 226 }); // day 1 starts at 14:00
    expect(screen.getByText('המיקום מחוץ לזמני הטיול')).toBeInTheDocument();
    expect(bankBlock('שוק האיכרים')).toBeTruthy();
  });

  it('rejects an overlapping drop and does not re-render the grid while dragging', () => {
    renderPlanner();
    drag(bankBlock('שוק האיכרים')!, { x: 736 - 225, y: 226 }); // day 2 10:00 overlaps 09:00–10:30
    expect(screen.getByText('אין מקום פנוי שם, האטרקציה נשארה במקומה')).toBeInTheDocument();
    expect(screen.getByTestId('spike-stats')).toHaveTextContent('הלוח רונדר 0 פעמים');
  });

  describe('grid render counter (ADR-002 evidence)', () => {
    /** Start a mouse drag over day 2 at 10:00 (overlaps 09:00–10:30, so the drop is rejected). */
    function startDrag() {
      fireEvent.pointerDown(bankBlock('שוק האיכרים')!, {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: 950,
        clientY: 110,
      });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 900, clientY: 120 });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 736 - 225, clientY: 226 });
    }
    function endDrag() {
      fireEvent.pointerUp(document, { pointerId: 1, clientX: 736 - 225, clientY: 226 });
    }

    it('stays at 0 when the planner re-renders mid-drag but the grid props are unchanged', () => {
      const { rerender } = renderPlanner();
      startDrag();
      // Forces SpikePlanner (the grid's parent) to render again during the drag.
      rerender(
        <ToastProvider>
          <SpikePlanner dayCount={7} />
        </ToastProvider>,
      );
      endDrag();
      expect(screen.getByTestId('spike-stats')).toHaveTextContent('הלוח רונדר 0 פעמים');
    });

    it('counts a real grid re-render during a drag', () => {
      const { rerender } = renderPlanner();
      startDrag();
      // Changes the grid's props (trip length) mid-drag, so TimetableGrid must render.
      rerender(
        <ToastProvider>
          <SpikePlanner dayCount={8} />
        </ToastProvider>,
      );
      endDrag();
      expect(screen.getByTestId('spike-stats')).toHaveTextContent(/הלוח רונדר [1-9]\d* פעמים/);
    });
  });

  it('returns a placed block to the bank', () => {
    renderPlanner();
    const day2 = document.querySelector('[data-day="2026-12-02"]') as HTMLElement;
    const placed = within(day2).getByText('09:00–10:30').closest<HTMLElement>('[data-drag-id]')!;
    drag(placed, { x: 950, y: 300 });
    expect(within(day2).queryByText('09:00–10:30')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('spike-bank')).getAllByRole('button').length).toBe(11);
  });

  it('treats a press without movement as a click (opens the editor)', () => {
    renderPlanner();
    const block = bankBlock('שוק האיכרים')!;
    fireEvent.pointerDown(block, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 950,
      clientY: 110,
    });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 950, clientY: 110 });
    fireEvent.click(within(block).getAllByRole('button')[0]!);
    expect(screen.getByText('נפתחה עריכה של "שוק האיכרים"')).toBeInTheDocument();
  });
});

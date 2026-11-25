import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ActivityBlock, ToastProvider } from '@/components/ui';
import { PALETTE, type Activity, type Trip } from '@/domain';
import { tripKeys } from '@/features/trips';
import { dragSourceProps, useBankDropZone } from '../drag/dragContext';
import { EDGE_SWITCH_MS, TimetableDragRoot } from '../drag/TimetableDragRoot';
import { usePlacementActions } from '../hooks';
import { Timetable } from '../Timetable';
import { PHONE_HEADER_PX, PHONE_SLOT_HEIGHT_PX } from '../timetableLayout';
import { PlannerLayout } from './PlannerLayout';

const repo = vi.hoisted(() => ({ place: vi.fn(), unplace: vi.fn() }));
vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return { ...actual, activitiesRepo: repo };
});

// ---- viewport (matchMedia) -------------------------------------------------------------------

type Listener = () => void;
let width = 360;
const mediaListeners = new Set<Listener>();
function installMatchMedia(initial: number) {
  width = initial;
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
      return {
        get matches() {
          return width >= min;
        },
        media: query,
        addEventListener: (_: string, l: Listener) => mediaListeners.add(l),
        removeEventListener: (_: string, l: Listener) => mediaListeners.delete(l),
      };
    }),
  );
}
function resize(next: number) {
  width = next;
  act(() => mediaListeners.forEach((l) => l()));
}

// ---- layout rectangles (jsdom has no layout) ---------------------------------------------------
// Phone, RTL: timetable scroller 360×600 at the origin (40 px day-switcher row, 64 px time column
// on the right), one day column 296 px wide scrolled so that slot s starts at y = s × 22 − 344
// (the phone's denser rows, PHONE-2). The bank sheet lies below the timetable. Every draggable
// block is measured at BLOCK; the grab point (30, 660) is 10 px below its top.
const SH = PHONE_SLOT_HEIGHT_PX;
const SCROLLER = { left: 0, top: 0, right: 360, bottom: 600 };
const COLUMNS = { left: 0, top: -344, right: 296, bottom: -344 + 48 * SH };
const SHEET = { left: 0, top: 600, right: 360, bottom: 740 };
const BLOCK = { left: 20, top: 650, right: 170, bottom: 705 };
const yForSlot = (slot: number) => slot * SH - 344 + 10;

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

// ---- data ---------------------------------------------------------------------------------------

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
function FakeBank() {
  const setDropZone = useBankDropZone();
  return (
    <div ref={setDropZone} data-testid="fake-bank">
      <ActivityBlock
        {...dragSourceProps(market.id)}
        name={market.name}
        durationMinutes={market.durationMinutes}
        color={market.color}
      />
    </div>
  );
}

/** The planner as TripPage composes it, with the real placement mutations. */
function Planner() {
  const placement = usePlacementActions(trip.id);
  return (
    <TimetableDragRoot
      trip={trip}
      activities={activities}
      onPlace={placement.place}
      onUnplace={placement.unplace}
    >
      <PlannerLayout bank={<FakeBank />} bankLabel="מאגר אטרקציות" bankCount={1}>
        <Timetable trip={trip} activities={activities} onOpenActivity={vi.fn()} />
      </PlannerLayout>
    </TimetableDragRoot>
  );
}

let frames: FrameRequestCallback[] = [];
function runFrame() {
  const pending = frames;
  frames = [];
  act(() => pending.forEach((cb) => cb(0)));
}

beforeEach(() => {
  installMatchMedia(360);
  frames = [];
  repo.place
    .mockReset()
    .mockImplementation(async (id: string, date: string, startMinute: number) => ({
      ...market,
      id,
      placement: { date, startMinute },
    }));
  repo.unplace
    .mockReset()
    .mockImplementation(async (id: string) => ({ ...museum, id, placement: null }));
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (el.dataset.testid === 'timetable-columns') return rect(COLUMNS);
    if (el.dataset.testid === 'timetable-scroller') return rect(SCROLLER);
    if (el.dataset.testid === 'bank-sheet') return rect(SHEET);
    if (el.dataset.dragId) return rect(BLOCK);
    return rect({ left: 0, top: 0, right: 0, bottom: 0 });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mediaListeners.clear();
});

function renderPlanner() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(tripKeys.detail(trip.id), { trip, activities });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Planner />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...utils, scroller: setUpScroller() };
}

/** The scroller is replaced when the layout switches, so measure the current one. */
function setUpScroller() {
  const scroller = screen.getByTestId('timetable-scroller');
  Object.defineProperty(scroller, 'clientWidth', { value: 360, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true });
  // jsdom does not inherit `direction` from <html dir="rtl">; a browser computes it.
  scroller.style.direction = 'rtl';
  scroller.scrollBy = vi.fn() as unknown as typeof scroller.scrollBy;
  return scroller;
}

const dayHeading = () => screen.getByRole('heading', { level: 3 }).textContent;
const nextDay = () => screen.getByRole('button', { name: 'היום הבא' });
const previousDay = () => screen.getByRole('button', { name: 'היום הקודם' });
const handle = () => screen.getByRole('button', { name: /^מאגר אטרקציות/ });

function blockOf(id: string): HTMLElement {
  const block = document.querySelector<HTMLElement>(`[data-drag-id="${id}"]`);
  if (!block) throw new Error(`no block ${id}`);
  return block;
}

function touch(target: Element, type: 'down' | 'up' | 'cancel', x: number, y: number) {
  const init = { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y };
  if (type === 'down') fireEvent.pointerDown(target, init);
  else if (type === 'up') fireEvent.pointerUp(target, init);
  else fireEvent.pointerCancel(target, init);
}

function mouseDrag(id: string, x: number, y: number, { drop = true } = {}) {
  fireEvent.pointerDown(blockOf(id), {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    clientX: 30,
    clientY: 660,
  });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 40, clientY: 650 });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: x, clientY: y });
  if (drop) fireEvent.pointerUp(document, { pointerId: 1, clientX: x, clientY: y });
}

describe('PlannerLayout: phone vs tablet/desktop', () => {
  it('shows the side panel and every day on a desktop-width screen', () => {
    installMatchMedia(1200);
    renderPlanner();
    expect(screen.queryByTestId('planner-phone')).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'מאגר אטרקציות' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(7);
    expect(screen.queryByRole('button', { name: 'היום הבא' })).not.toBeInTheDocument();
  });

  it('keeps the multi-day grid on a tablet (601 px)', () => {
    installMatchMedia(601);
    renderPlanner();
    expect(screen.queryByTestId('planner-phone')).not.toBeInTheDocument();
    expect(screen.getAllByRole('group')).toHaveLength(7);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(7);
  });

  it('shows one day and the bank sheet on a phone (360 px), and switches live', () => {
    renderPlanner();
    expect(screen.getByTestId('planner-phone')).toBeInTheDocument();
    expect(screen.getAllByRole('group')).toHaveLength(1);
    expect(dayHeading()).toBe('יום שלישי 1.12 · יום 1');
    expect(screen.getByRole('complementary', { name: 'מאגר אטרקציות' })).toBe(
      screen.getByTestId('bank-sheet'),
    );
    resize(1000);
    expect(screen.queryByTestId('planner-phone')).not.toBeInTheDocument();
    expect(screen.getAllByRole('group')).toHaveLength(7);
    resize(500);
    expect(screen.getAllByRole('group')).toHaveLength(1);
  });
});

describe('Phone scale (PHONE-2)', () => {
  /** The grid's two rows: the sticky header and the 48 half-hour rows. */
  const gridRows = () =>
    (screen.getByTestId('timetable-scroller').firstElementChild as HTMLElement).style
      .gridTemplateRows;

  it('draws denser rows, a slim header, and blocks on the same scale in grid and sheet', () => {
    renderPlanner();
    expect(gridRows()).toBe(`${PHONE_HEADER_PX}px ${48 * SH}px`);
    fireEvent.click(nextDay()); // the museum: 09:00, 90 minutes
    const museumBlock = blockOf('placed-1');
    expect(museumBlock.style.top).toBe(`${18 * SH + 1}px`);
    expect(museumBlock.style.height).toBe(`${3 * SH - 3}px`);
    // Hour labels follow the rows.
    const timeColumn = screen.getByTestId('timetable-columns').previousElementSibling!;
    expect((timeColumn.firstElementChild as HTMLElement).style.height).toBe(`${2 * SH}px`);
    // The bank in the sheet uses the same scale (FR-3.3); a one-hour block keeps name and
    // duration on one row, so both stay readable.
    const bankBlock = within(screen.getByTestId('fake-bank')).getByTitle('שוק');
    expect(bankBlock.style.height).toBe(`${2 * SH - 3}px`);
    expect(bankBlock).toHaveAttribute('data-short', 'true');
    expect(within(bankBlock).getByText('שעה')).toBeInTheDocument();
    // The last day is hatched from the trip end (11:00) at the phone scale.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '6' } });
    const hatch = document.querySelector<HTMLElement>('[data-disabled-slots]')!;
    expect(hatch.style.top).toBe(`${22 * SH}px`);
  });

  it('tablet and desktop keep the 28 px rows and the 56 px header', () => {
    installMatchMedia(1200);
    renderPlanner();
    expect(gridRows()).toBe(`56px ${48 * 28}px`);
    expect(blockOf('placed-1').style.top).toBe(`${18 * 28 + 1}px`);
    expect(within(screen.getByTestId('fake-bank')).getByTitle('שוק').style.height).toBe('53px');
  });

  it('snaps a drop and draws its preview at the phone scale', () => {
    renderPlanner();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } }); // day 3
    fireEvent.click(handle());
    mouseDrag('bank-1', 150, yForSlot(20), { drop: false });
    runFrame();
    const preview = screen.getByTestId('drop-preview');
    expect(preview.style.top).toBe(`${20 * SH + 1}px`);
    expect(preview.style.height).toBe(`${2 * SH - 3}px`);
    // The ghost under the finger is a copy at the same scale.
    expect(within(screen.getByTestId('drag-ghost')).getByTitle('שוק').style.height).toBe(
      `${2 * SH - 3}px`,
    );
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 150, clientY: yForSlot(20) });
    return waitFor(() => expect(repo.place).toHaveBeenCalledWith('bank-1', '2026-12-03', 600));
  });

  it('a long press still drags a placed block, and drops on the half hour under it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    renderPlanner();
    fireEvent.click(nextDay()); // the museum's day
    touch(blockOf('placed-1'), 'down', 30, 660);
    act(() => vi.advanceTimersByTime(300)); // long press: the drag starts
    fireEvent.pointerMove(document, { pointerId: 7, clientX: 150, clientY: yForSlot(26) });
    runFrame();
    expect(screen.getByTestId('drop-preview').style.top).toBe(`${26 * SH + 1}px`);
    fireEvent.pointerUp(document, { pointerId: 7, clientX: 150, clientY: yForSlot(26) });
    vi.useRealTimers();
    await waitFor(() => expect(repo.place).toHaveBeenCalledWith('placed-1', '2026-12-02', 13 * 60));
  });

  it('a header-row pointer is not a drop target (slim header)', () => {
    renderPlanner();
    fireEvent.click(handle());
    mouseDrag('bank-1', 150, PHONE_HEADER_PX - 5, { drop: false });
    runFrame();
    expect(screen.queryByTestId('drop-preview')).not.toBeInTheDocument();
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 150, clientY: PHONE_HEADER_PX + 5 });
    runFrame();
    expect(screen.getByTestId('drop-preview')).toBeInTheDocument();
    fireEvent.pointerCancel(document, { pointerId: 1 });
  });
});

describe('Day switcher', () => {
  it('steps through the days with labelled buttons and announces the day', () => {
    renderPlanner();
    expect(previousDay()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(previousDay());
    expect(dayHeading()).toBe('יום שלישי 1.12 · יום 1');

    fireEvent.click(nextDay());
    expect(dayHeading()).toBe('יום רביעי 2.12 · יום 2');
    expect(screen.getByText('יום 2 מתוך 7: יום רביעי 2.12')).toHaveAttribute('role', 'status');
    // The column is labelled by the day and shows that day's blocks.
    const column = screen.getByRole('group', { name: 'יום רביעי 2.12 · יום 2' });
    expect(column).toHaveAttribute('data-day', '2026-12-02');
    expect(within(column).getByRole('button', { name: /מוזיאון/ })).toBeInTheDocument();
    expect(previousDay()).not.toHaveAttribute('aria-disabled');
    // Focus stays on the button (the header is not re-created on a day change).
    nextDay().focus();
    fireEvent.click(nextDay());
    expect(nextDay()).toHaveFocus();
  });

  it('jumps to any day with the day picker and stops at the last day', () => {
    renderPlanner();
    const picker = screen.getByRole('combobox', { name: 'בחירת יום' });
    expect(within(picker).getAllByRole('option')).toHaveLength(7);
    fireEvent.change(picker, { target: { value: '6' } });
    expect(dayHeading()).toBe('יום שני 7.12 · יום 7');
    expect(nextDay()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(nextDay());
    expect(dayHeading()).toBe('יום שני 7.12 · יום 7');
    // The last day is hatched after the trip end (11:00).
    expect(screen.getByRole('group').querySelectorAll('[data-disabled-slots]')).toHaveLength(1);
  });

  it('keeps the vertical scroll position when the day changes', () => {
    const { scroller } = renderPlanner();
    expect(scroller.scrollTop).toBe(27 * SH); // trip start, as on desktop (FR-4.4)
    scroller.scrollTop = 500;
    fireEvent.click(nextDay());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '4' } });
    expect(screen.getByTestId('timetable-scroller')).toBe(scroller);
    expect(scroller.scrollTop).toBe(500);
  });
});

describe('Day swipe', () => {
  it('a quick horizontal swipe changes the day (RTL: right = next, left = previous)', () => {
    const { scroller } = renderPlanner();
    touch(scroller, 'down', 100, 300);
    touch(scroller, 'up', 200, 310);
    expect(dayHeading()).toMatch(/יום 2$/);
    touch(scroller, 'down', 250, 300);
    touch(scroller, 'up', 150, 290);
    expect(dayHeading()).toMatch(/יום 1$/);
  });

  it('ignores vertical swipes, short moves, slow pans, cancelled touches and the mouse', () => {
    const { scroller } = renderPlanner();
    touch(scroller, 'down', 100, 300);
    touch(scroller, 'up', 160, 400); // mostly vertical
    touch(scroller, 'down', 100, 300);
    touch(scroller, 'up', 130, 300); // too short
    touch(scroller, 'down', 100, 300);
    touch(scroller, 'cancel', 100, 300); // the browser took it (scrolling)
    touch(scroller, 'up', 200, 300);
    fireEvent.pointerDown(scroller, { pointerId: 2, pointerType: 'mouse', clientX: 100 });
    fireEvent.pointerUp(scroller, { pointerId: 2, pointerType: 'mouse', clientX: 250 });
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    touch(scroller, 'down', 100, 300);
    now.mockReturnValue(2000);
    touch(scroller, 'up', 200, 300); // 1 s: a slow pan
    expect(dayHeading()).toMatch(/יום 1$/);
  });

  it('does not switch the day when the long press turned into a drag', () => {
    vi.useFakeTimers();
    renderPlanner();
    fireEvent.click(nextDay());
    const block = blockOf('placed-1');
    touch(block, 'down', 30, 660);
    act(() => vi.advanceTimersByTime(300)); // long press: the drag starts
    fireEvent.pointerMove(document, { pointerId: 7, clientX: 150, clientY: 660 });
    touch(block, 'up', 150, 660);
    expect(dayHeading()).toMatch(/יום 2$/);
  });
});

describe('Bank sheet', () => {
  it('opens and closes from the handle, which shows the count', () => {
    renderPlanner();
    const panel = screen.getByTestId('bank-sheet-panel');
    expect(handle()).toHaveAccessibleName('מאגר אטרקציות (1)');
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
    expect(handle()).toHaveAttribute('aria-controls', panel.id);
    expect(panel).not.toBeVisible();
    fireEvent.click(handle());
    expect(handle()).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toBeVisible();
    expect(within(panel).getByText('שוק')).toBeInTheDocument();
    fireEvent.click(handle());
    expect(panel).not.toBeVisible();
  });

  it('opens with a swipe up and closes with a swipe down on the handle', () => {
    renderPlanner();
    touch(handle(), 'down', 180, 620);
    touch(handle(), 'up', 180, 560);
    fireEvent.click(handle()); // the click that may follow a swipe is ignored
    expect(handle()).toHaveAttribute('aria-expanded', 'true');
    touch(handle(), 'down', 180, 560);
    touch(handle(), 'up', 180, 640);
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('is the bank drop zone (not the panel inside it)', async () => {
    renderPlanner();
    fireEvent.click(nextDay()); // the museum's day
    mouseDrag('placed-1', 180, 620, { drop: false });
    runFrame();
    expect(screen.getByTestId('bank-sheet')).toHaveAttribute('data-drop-over');
    expect(screen.getByTestId('fake-bank')).not.toHaveAttribute('data-drop-over');
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 180, clientY: 620 });
    await waitFor(() => expect(repo.unplace).toHaveBeenCalledWith('placed-1'));
  });
});

describe('Drag from the sheet onto the visible day', () => {
  it('shrinks the sheet during the drag and places on the day shown, via usePlacementActions', async () => {
    renderPlanner();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } }); // day 3
    fireEvent.click(handle());
    const panel = screen.getByTestId('bank-sheet-panel');
    expect(panel).toHaveClass('h-[40dvh]');

    mouseDrag('bank-1', 150, yForSlot(20), { drop: false });
    expect(panel).toHaveClass('h-0');
    runFrame();
    const preview = screen.getByTestId('drop-preview');
    expect(preview).toHaveAttribute('data-valid', 'true');
    // The one visible column: no offset by the trip day index (2).
    expect(preview.style.insetInlineStart).toBe('calc(0% + 4px)');
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 150, clientY: yForSlot(20) });

    await waitFor(() => expect(repo.place).toHaveBeenCalledWith('bank-1', '2026-12-03', 600));
    // The sheet comes back as it was.
    expect(panel).toHaveClass('h-[40dvh]');
    expect(handle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('switches to the next day while a block is held at the left edge (RTL)', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    renderPlanner();
    fireEvent.click(handle());
    mouseDrag('bank-1', 10, yForSlot(30), { drop: false });
    runFrame();
    now.mockReturnValue(EDGE_SWITCH_MS - 50);
    runFrame();
    expect(dayHeading()).toMatch(/יום 1$/);
    now.mockReturnValue(EDGE_SWITCH_MS + 10);
    runFrame();
    expect(dayHeading()).toMatch(/יום 2$/);
    // Over the time column on the right: back to the previous day after another hold.
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 350, clientY: yForSlot(30) });
    runFrame();
    now.mockReturnValue(2 * EDGE_SWITCH_MS + 100);
    runFrame();
    expect(dayHeading()).toMatch(/יום 1$/);
    // Dropped in the middle: lands on the day shown.
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 150, clientY: yForSlot(30) });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 150, clientY: yForSlot(30) });
    return waitFor(() => expect(repo.place).toHaveBeenCalledWith('bank-1', '2026-12-01', 15 * 60));
  });

  it('drops on the switched-to day after one edge switch (non-zero view offset)', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    renderPlanner();
    fireEvent.click(handle());
    mouseDrag('bank-1', 10, yForSlot(30), { drop: false });
    runFrame();
    now.mockReturnValue(EDGE_SWITCH_MS + 10);
    runFrame();
    expect(dayHeading()).toMatch(/יום 2$/);
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 150, clientY: yForSlot(30) });
    runFrame();
    expect(screen.getByTestId('drop-preview').style.insetInlineStart).toBe('calc(0% + 4px)');
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 150, clientY: yForSlot(30) });
    await waitFor(() => expect(repo.place).toHaveBeenCalledWith('bank-1', '2026-12-02', 15 * 60));
  });

  it('never switches the day for a placed block dragged by touch', () => {
    // Only the long-press timer is faked; the test drives animation frames and the clock itself.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    renderPlanner();
    fireEvent.click(nextDay()); // the museum's day
    const block = blockOf('placed-1');
    touch(block, 'down', 30, 660);
    act(() => vi.advanceTimersByTime(300)); // long press: the drag starts
    fireEvent.pointerMove(document, { pointerId: 7, clientX: 10, clientY: yForSlot(30) });
    runFrame();
    now.mockReturnValue(3 * EDGE_SWITCH_MS);
    runFrame();
    now.mockReturnValue(6 * EDGE_SWITCH_MS);
    runFrame();
    expect(dayHeading()).toMatch(/יום 2$/);
    // The block is still in the DOM (its column did not unmount) while the finger holds it.
    expect(blockOf('placed-1')).toHaveAttribute('data-dragging', 'true');
    fireEvent.pointerCancel(document, { pointerId: 7 });
  });
});

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ActivityBlock, ToastProvider } from '@/components/ui';
import { AppError } from '@/data';
import { PALETTE, type Activity, type Trip, type TripWithActivities } from '@/domain';
import { tripKeys } from '@/features/trips';
import { dragSourceProps, useBankDropZone } from '../drag/dragContext';
import { TimetableDragRoot } from '../drag/TimetableDragRoot';
import { usePlacementActions } from '../hooks';
import { PlannerLayout } from '../phone/PlannerLayout';
import { Timetable } from '../Timetable';

const repo = vi.hoisted(() => ({ place: vi.fn(), unplace: vi.fn() }));
vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return { ...actual, activitiesRepo: repo };
});

// Connectivity the test can switch while the planner is mounted (M7.3).
const net = vi.hoisted(() => {
  let online = true;
  const listeners = new Set<() => void>();
  return {
    get: () => online,
    set: (next: boolean) => {
      online = next;
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
});
vi.mock('@/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform')>();
  const { useSyncExternalStore } = await import('react');
  return {
    ...actual,
    useOnlineStatus: () => useSyncExternalStore(net.subscribe, net.get, net.get),
  };
});

// ---- viewport (matchMedia) ---------------------------------------------------------------------

type Listener = () => void;
let width = 360;
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
        addEventListener: (_: string, _l: Listener) => {},
        removeEventListener: (_: string, _l: Listener) => {},
      };
    }),
  );
}

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
const cafe: Activity = {
  id: 'placed-2',
  tripId: 'trip-1',
  name: 'קפה',
  durationMinutes: 30,
  color: PALETTE[2],
  placement: { date: '2026-12-03', startMinute: 10 * 60 },
  bankPosition: 0,
};
const initial: TripWithActivities = { trip, activities: [market, museum, cafe] };

const DAY1 = 'יום שלישי 1.12 · יום 1';
const DAY2 = 'יום רביעי 2.12 · יום 2';
const DAY3 = 'יום חמישי 3.12 · יום 3';
const STATUS = {
  cancelled: 'השיבוץ בוטל',
  // The shared read-only reason (useCanEdit, M7.3).
  offline: 'אין חיבור לאינטרנט, אז אי אפשר לשמור שינויים כרגע. העריכה תחזור כשהחיבור יחזור.',
  overlap: 'יש כבר אטרקציה אחרת בזמן הזה.',
  network: 'אין חיבור לשרת. כדאי לבדוק את החיבור לאינטרנט ולנסות שוב.',
};

const onOpenBank = vi.fn();
const onOpenPlaced = vi.fn();

/** Stand-in for BankPanel: the contract calls the real bank makes, plus its edit opener. */
function FakeBank({ items }: { items: Activity[] }) {
  const setDropZone = useBankDropZone();
  return (
    <div ref={setDropZone} data-testid="fake-bank">
      {items.map((a) => (
        <ActivityBlock
          key={a.id}
          {...dragSourceProps(a.id)}
          name={a.name}
          durationMinutes={a.durationMinutes}
          color={a.color}
          onOpen={() => onOpenBank(a)}
          onDelete={() => {}}
        />
      ))}
    </div>
  );
}

/** The planner as TripPage composes it, rendering from the trip cache like the real page. */
function Planner() {
  const { data } = useQuery<TripWithActivities>({
    queryKey: tripKeys.detail(trip.id),
    queryFn: () => new Promise(() => {}),
    staleTime: Infinity,
  });
  const placement = usePlacementActions(trip.id);
  const activities = data?.activities ?? [];
  return (
    <TimetableDragRoot
      trip={trip}
      activities={activities}
      onPlace={placement.place}
      onUnplace={placement.unplace}
    >
      <PlannerLayout
        bank={<FakeBank items={activities.filter((a) => !a.placement)} />}
        bankLabel="מאגר אטרקציות"
        bankCount={1}
      >
        <Timetable trip={trip} activities={activities} onOpenActivity={onOpenPlaced} />
      </PlannerLayout>
    </TimetableDragRoot>
  );
}

let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  net.set(true);
  frames = [];
  onOpenBank.mockReset();
  onOpenPlaced.mockReset();
  repo.place
    .mockReset()
    .mockImplementation(async (id: string, date: string, startMinute: number) => ({
      ...initial.activities.find((a) => a.id === id)!,
      placement: { date, startMinute },
    }));
  repo.unplace.mockReset().mockImplementation(async (id: string) => ({
    ...initial.activities.find((a) => a.id === id)!,
    placement: null,
    bankPosition: 9,
  }));
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  // Phone or desktop scroller at the origin; every block measured at the same place.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (el.dataset.testid === 'timetable-scroller')
      return rect({ left: 0, top: 0, right: width < 601 ? 360 : 800, bottom: 600 });
    if (el.dataset.testid === 'timetable-columns')
      return rect({ left: -314, top: -344, right: 736, bottom: 1000 });
    if (el.dataset.dragId) return rect({ left: 900, top: 100, right: 1080, bottom: 155 });
    return rect({ left: 0, top: 0, right: 0, bottom: 0 });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPlanner(viewport: 'phone' | 'desktop' = 'phone') {
  installMatchMedia(viewport === 'phone' ? 360 : 1200);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(tripKeys.detail(trip.id), initial);
  // No server behind the cache: keep it as the placement hook leaves it.
  vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Planner />
      </ToastProvider>
    </QueryClientProvider>,
  );
  const scroller = screen.getByTestId('timetable-scroller');
  // jsdom does not inherit `direction` from <html dir="rtl">; a browser computes it.
  scroller.style.direction = 'rtl';
  Object.defineProperty(scroller, 'clientWidth', { value: 360, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true });
  scroller.scrollBy = vi.fn() as unknown as typeof scroller.scrollBy;
  const cached = () => queryClient.getQueryData<TripWithActivities>(tripKeys.detail(trip.id));
  return { ...utils, scroller, cached };
}

// ---- helpers ------------------------------------------------------------------------------------

const bar = () => screen.queryByTestId('placing-bar');
const status = () => screen.getByTestId('placing-status');
const handle = () => screen.getByRole('button', { name: /^מאגר אטרקציות/ });
const nextDay = () => screen.getByRole('button', { name: 'היום הבא' });
const slot = (time: string, day: string, free = true) =>
  screen.getByRole('button', { name: `${time}, ${day}${free ? '' : ', לא פנוי'}` });

/** The open button of an activity's block (bank or grid). */
function blockButton(name: string, where: 'bank' | 'grid' = 'grid'): HTMLElement {
  const scope =
    where === 'bank' ? screen.getByTestId('fake-bank') : screen.getByTestId('timetable-columns');
  return within(scope).getByRole('button', { name: new RegExp(`^${name}`) });
}

/** A finger tap (pointer down/up, then the click the browser sends). */
function tap(el: Element) {
  const init = { pointerId: 3, pointerType: 'touch', isPrimary: true, clientX: 30, clientY: 30 };
  fireEvent.pointerDown(el, init);
  fireEvent.pointerUp(el, init);
  fireEvent.click(el, { detail: 1 });
}

function pressM(el: Element) {
  fireEvent.keyDown(el, { key: 'm', code: 'KeyM' });
}

// ---- phone --------------------------------------------------------------------------------------

describe('tap-to-place on a phone (FR-5.5)', () => {
  it('tap a bank item, then a highlighted slot: placed at once, focus on the placed block', async () => {
    const { cached } = renderPlanner();
    fireEvent.click(handle());
    tap(blockButton('שוק', 'bank'));

    expect(onOpenBank).not.toHaveBeenCalled(); // a tap picks it up instead of opening it
    expect(bar()).toHaveTextContent('שיבוץ: שוק');
    expect(status()).toHaveTextContent('מצב שיבוץ: שוק');
    // The sheet gets out of the way; the block shows that it is picked up.
    expect(screen.getByTestId('bank-sheet-panel')).not.toBeVisible();
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('[data-drag-id="bank-1"]')).toHaveAttribute('data-picked');

    // Day 1 starts at 14:00: one tinted run 14:00–23:00 (start slots 28..46).
    const runs = document.querySelectorAll<HTMLElement>('[data-valid-run]');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.style.top).toBe(`${28 * 28 + 1}px`);
    // One button per half hour of the visible day; the first free one in view has focus.
    expect(within(screen.getByTestId('placing-layer')).getAllByRole('button')).toHaveLength(48);
    expect(slot('14:00–15:00', DAY1)).toHaveFocus();
    expect(slot('13:30–14:30', DAY1, false)).toHaveAttribute('aria-disabled', 'true');

    tap(slot('16:00–17:00', DAY1));
    await waitFor(() => expect(repo.place).toHaveBeenCalledWith('bank-1', '2026-12-01', 16 * 60));
    expect(bar()).not.toBeInTheDocument();
    expect(screen.queryByTestId('placing-layer')).not.toBeInTheDocument();
    expect(status()).toHaveTextContent(`השיבוץ נשמר: שוק, ${DAY1}, 16:00–17:00`);
    await waitFor(() => expect(blockButton('שוק')).toHaveFocus());
    expect(cached()?.activities[0]?.placement).toEqual({ date: '2026-12-01', startMinute: 960 });
    expect(document.querySelector('[data-picked]')).toBeNull();
  });

  it('rolls back when saving fails, as a drag does (FR-5.7)', async () => {
    repo.place.mockRejectedValue(new AppError('network'));
    const { cached } = renderPlanner();
    fireEvent.click(handle());
    tap(blockButton('שוק', 'bank'));
    tap(slot('16:00–17:00', DAY1));
    expect(await screen.findByText(STATUS.network)).toBeInTheDocument();
    await waitFor(() => expect(cached()?.activities[0]?.placement).toBeNull());
  });

  it('moves a placed block to another day: pick it up, switch the day, tap a slot', async () => {
    renderPlanner();
    fireEvent.click(nextDay()); // the museum's day
    tap(blockButton('מוזיאון'));
    expect(bar()).toHaveTextContent('שיבוץ: מוזיאון');
    expect(slot('09:00–10:30', DAY2)).toHaveFocus(); // its own place

    fireEvent.click(nextDay()); // the day switcher keeps working while placing
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(DAY3);
    // The new day's slots: the café at 10:00 blocks 09:00–10:30.
    expect(slot('09:00–10:30', DAY3, false)).toHaveAttribute('aria-disabled', 'true');
    tap(slot('15:00–16:30', DAY3));
    await waitFor(() => expect(repo.place).toHaveBeenCalledWith('placed-1', '2026-12-03', 15 * 60));
    await waitFor(() => expect(blockButton('מוזיאון')).toHaveFocus());
  });

  it('arrow keys change the shown day on a phone too (RTL: left = next day)', () => {
    renderPlanner();
    fireEvent.click(nextDay());
    tap(blockButton('מוזיאון'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(DAY3);
    expect(slot('09:00–10:30', DAY3, false)).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(slot('09:00–10:30', DAY2)).toHaveFocus();
  });

  it('a tap on a slot that is not free explains why and keeps the mode', () => {
    renderPlanner();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } }); // day 3
    fireEvent.click(handle());
    tap(blockButton('שוק', 'bank'));
    tap(slot('09:30–10:30', DAY3, false));
    expect(repo.place).not.toHaveBeenCalled();
    expect(screen.getByText(STATUS.overlap)).toBeInTheDocument();
    expect(bar()).toBeInTheDocument();
  });

  it('returns a placed block to the bank from the bar', async () => {
    renderPlanner();
    fireEvent.click(nextDay());
    tap(blockButton('מוזיאון'));
    fireEvent.click(within(bar()!).getByRole('button', { name: 'החזרה למאגר' }));
    await waitFor(() => expect(repo.unplace).toHaveBeenCalledWith('placed-1'));
    expect(bar()).not.toBeInTheDocument();
    expect(status()).toHaveTextContent('הוחזר למאגר: מוזיאון');
    await waitFor(() =>
      expect(
        screen.getByTestId('fake-bank').querySelector('[data-drag-id="placed-1"]'),
      ).toBeInTheDocument(),
    );
    // The sheet is closed, so focus goes to the timetable instead of a hidden bank item.
    expect(screen.getByTestId('timetable-scroller')).toHaveFocus();
  });

  it('every announcement changes the status text, so a repeated message is read again', () => {
    renderPlanner();
    fireEvent.click(handle());
    const texts: (string | null)[] = [];
    for (let i = 0; i < 2; i += 1) {
      tap(blockButton('שוק', 'bank'));
      texts.push(status().textContent);
      fireEvent.click(within(bar()!).getByRole('button', { name: 'ביטול' }));
      texts.push(status().textContent);
      expect(status()).toHaveTextContent(STATUS.cancelled);
    }
    texts.slice(1).forEach((text, i) => expect(text).not.toBe(texts[i]));
    // An invisible no-break space alternates, so even the same message twice differs.
    expect(texts[1]?.trim()).toBe(texts[3]?.trim());
  });

  it('"edit" for a bank item with the sheet collapsed opens it and focuses the timetable', () => {
    renderPlanner();
    fireEvent.click(handle());
    tap(blockButton('שוק', 'bank'));
    // Swipe the handle down: the sheet is closed while the item still waits for a slot.
    const init = { pointerId: 5, pointerType: 'touch', isPrimary: true, clientX: 180 };
    fireEvent.pointerDown(handle(), { ...init, clientY: 560 });
    fireEvent.pointerUp(handle(), { ...init, clientY: 660 });
    expect(bar()).toBeInTheDocument();
    fireEvent.click(within(bar()!).getByRole('button', { name: 'עריכה' }));
    expect(onOpenBank).toHaveBeenCalledWith(expect.objectContaining({ id: 'bank-1' }));
    expect(screen.getByTestId('timetable-scroller')).toHaveFocus();
  });

  it('cancels with the bar button, Escape, the same item again or the bank handle', () => {
    renderPlanner();
    fireEvent.click(handle());
    const market = blockButton('שוק', 'bank');

    tap(market);
    fireEvent.click(within(bar()!).getByRole('button', { name: 'ביטול' }));
    expect(bar()).not.toBeInTheDocument();
    expect(status()).toHaveTextContent(STATUS.cancelled);
    // The sheet comes back and focus returns to the item.
    expect(screen.getByTestId('bank-sheet-panel')).toBeVisible();
    expect(market).toHaveFocus();
    expect(repo.place).not.toHaveBeenCalled();

    tap(market);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(bar()).not.toBeInTheDocument();

    tap(market);
    fireEvent.click(handle()); // "show me the bank": leaves the mode, opens the sheet
    expect(bar()).not.toBeInTheDocument();
    expect(handle()).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(nextDay());
    tap(blockButton('מוזיאון'));
    expect(bar()).toBeInTheDocument();
    tap(blockButton('מוזיאון')); // the same block again
    expect(bar()).not.toBeInTheDocument();
    expect(onOpenPlaced).not.toHaveBeenCalled();
  });

  it('picking up another block switches to it', () => {
    renderPlanner('desktop');
    pressM(blockButton('מוזיאון'));
    pressM(blockButton('שוק', 'bank'));
    expect(bar()).toHaveTextContent('שיבוץ: שוק');
    expect(document.querySelector('[data-drag-id="placed-1"]')).not.toHaveAttribute('data-picked');
    expect(document.querySelector('[data-drag-id="bank-1"]')).toHaveAttribute('data-picked');
  });

  it('"edit" in the bar opens the dialog a tap used to open', () => {
    renderPlanner();
    fireEvent.click(handle());
    tap(blockButton('שוק', 'bank'));
    fireEvent.click(within(bar()!).getByRole('button', { name: 'עריכה' }));
    expect(onOpenBank).toHaveBeenCalledWith(expect.objectContaining({ id: 'bank-1' }));
    expect(bar()).not.toBeInTheDocument();
    expect(blockButton('שוק', 'bank')).toHaveFocus(); // the dialog returns focus here

    fireEvent.click(nextDay());
    tap(blockButton('מוזיאון'));
    fireEvent.click(within(bar()!).getByRole('button', { name: 'עריכה' }));
    expect(onOpenPlaced).toHaveBeenCalledWith(expect.objectContaining({ id: 'placed-1' }));
  });

  it('a long press is still a drag (not a tap), and a drag ends the mode', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    renderPlanner();
    fireEvent.click(handle());
    tap(blockButton('שוק', 'bank'));
    expect(bar()).toBeInTheDocument();

    fireEvent.click(nextDay());
    const block = document.querySelector('[data-drag-id="placed-1"]')!;
    const init = { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: 30, clientY: 30 };
    fireEvent.pointerDown(block, init);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByTestId('drag-ghost')).toBeInTheDocument();
    expect(bar()).not.toBeInTheDocument();
    fireEvent.pointerCancel(document, init);
    expect(onOpenPlaced).not.toHaveBeenCalled();
  });
});

// ---- desktop & keyboard -------------------------------------------------------------------------

describe('keyboard placement and the desktop grid (FR-5.6)', () => {
  it('a mouse click on the desktop grid still opens the editor', () => {
    renderPlanner('desktop');
    fireEvent.click(blockButton('מוזיאון'), { detail: 1 });
    expect(onOpenPlaced).toHaveBeenCalledWith(expect.objectContaining({ id: 'placed-1' }));
    expect(bar()).not.toBeInTheDocument();
  });

  it('describes the keyboard path on the timetable region', () => {
    renderPlanner('desktop');
    expect(screen.getByRole('region', { name: 'לוח הזמנים' })).toHaveAccessibleDescription(
      /מקישים M/,
    );
  });

  it('M picks a block up; arrows move (RTL); Enter places; focus lands on the moved block', async () => {
    renderPlanner('desktop');
    const museumButton = blockButton('מוזיאון');
    museumButton.focus();
    pressM(museumButton);
    expect(bar()).toHaveTextContent('שיבוץ: מוזיאון');
    // Only the cursor's day has slot buttons, even with every day on screen.
    expect(within(screen.getByTestId('placing-layer')).getAllByRole('button')).toHaveLength(48);
    expect(slot('09:00–10:30', DAY2)).toHaveFocus();

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(slot('09:30–11:00', DAY2)).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' }); // RTL: the next day
    expect(slot('09:30–11:00', DAY3, false)).toHaveFocus(); // the café is at 10:00
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(slot('10:30–12:00', DAY3)).toHaveFocus();
    expect(screen.getAllByTestId('placing-cursor')[0]).toHaveAttribute('data-valid', 'true');

    // Enter / Space on a button is a click with detail 0.
    fireEvent.click(document.activeElement!);
    await waitFor(() =>
      expect(repo.place).toHaveBeenCalledWith('placed-1', '2026-12-03', 10 * 60 + 30),
    );
    await waitFor(() => expect(blockButton('מוזיאון')).toHaveFocus());
    expect(blockButton('מוזיאון').closest('[data-day]')).toHaveAttribute('data-day', '2026-12-03');
  });

  it('Escape returns focus to the block; M on the same block again also cancels', () => {
    renderPlanner('desktop');
    const museumButton = blockButton('מוזיאון');
    museumButton.focus();
    pressM(museumButton);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(bar()).not.toBeInTheDocument();
    expect(museumButton).toHaveFocus();
    pressM(museumButton);
    expect(bar()).toBeInTheDocument();
    pressM(museumButton);
    expect(bar()).not.toBeInTheDocument();
  });

  it('a bank block picked up with M can be placed with a click on any day column', async () => {
    renderPlanner('desktop');
    pressM(blockButton('שוק', 'bank'));
    expect(slot('14:00–15:00', DAY1)).toHaveFocus(); // first day in view, first free slot
    // Day 5 has no slot buttons; a tap there picks the slot under the pointer (column top = 0).
    const day5 = document.querySelector('[data-testid="placing-day"][data-day-index="4"]')!;
    fireEvent.click(day5, { clientY: 20 * 28 + 5, detail: 1 });
    await waitFor(() => expect(repo.place).toHaveBeenCalledWith('bank-1', '2026-12-05', 10 * 60));
  });

  it('a touch tap picks a block up on the desktop grid too', () => {
    renderPlanner('desktop');
    tap(blockButton('מוזיאון'));
    expect(onOpenPlaced).not.toHaveBeenCalled();
    expect(bar()).toBeInTheDocument();
  });

  it('a 90-day trip still gets one day of buttons and one tint per free run', () => {
    // Same harness, longer trip (render cost NFR-3).
    const long: Trip = {
      ...trip,
      window: { startDate: '2026-12-01', startMinute: 0, endDate: '2027-02-28', endMinute: 1440 },
    };
    renderPlannerWith(long);
    pressM(blockButton('שוק', 'bank'));
    expect(screen.getAllByTestId('placing-day')).toHaveLength(90);
    expect(within(screen.getByTestId('placing-layer')).getAllByRole('button')).toHaveLength(48);
    // Days without activities: one run each; the museum's and the café's days: two.
    expect(document.querySelectorAll('[data-valid-run]')).toHaveLength(92);
  });
});

/** Desktop planner for another trip window (the Planner reads the trip from the cache). */
function renderPlannerWith(other: Trip) {
  installMatchMedia(1200);
  const queryClient = new QueryClient();
  queryClient.setQueryData(tripKeys.detail(trip.id), {
    trip: other,
    activities: initial.activities,
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TimetableDragRoot
          trip={other}
          activities={initial.activities}
          onPlace={vi.fn()}
          onUnplace={vi.fn()}
        >
          <PlannerLayout
            bank={<FakeBank items={[market]} />}
            bankLabel="מאגר אטרקציות"
            bankCount={1}
          >
            <Timetable trip={other} activities={initial.activities} onOpenActivity={vi.fn()} />
          </PlannerLayout>
        </TimetableDragRoot>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// ---- offline (M7.3) -----------------------------------------------------------------------------

describe('offline: placement does not start', () => {
  it('M shows the reason instead of starting', () => {
    net.set(false);
    renderPlanner('desktop');
    pressM(blockButton('מוזיאון'));
    expect(bar()).not.toBeInTheDocument();
    expect(screen.getByText(STATUS.offline)).toBeInTheDocument();
  });

  it('a tap on a phone opens the activity as before', () => {
    net.set(false);
    renderPlanner();
    fireEvent.click(handle());
    tap(blockButton('שוק', 'bank'));
    expect(bar()).not.toBeInTheDocument();
    expect(onOpenBank).toHaveBeenCalled();
  });

  it('a drag does not start (mouse and long press) and says why', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    net.set(false);
    renderPlanner('desktop');
    const block = document.querySelector('[data-drag-id="placed-1"]')!;
    fireEvent.pointerDown(block, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 950,
      clientY: 110,
    });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 900, clientY: 200 });
    expect(screen.queryByTestId('drag-ghost')).not.toBeInTheDocument();
    expect(screen.getByText(STATUS.offline)).toBeInTheDocument();
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 850, clientY: 300 });
    expect(screen.queryByTestId('drag-ghost')).not.toBeInTheDocument();
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 900, clientY: 200 });
    // The click the browser sends after the refused drag must not open the editor.
    fireEvent.click(blockButton('מוזיאון'), { detail: 1 });
    expect(onOpenPlaced).not.toHaveBeenCalled();

    const touch = { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: 30, clientY: 30 };
    fireEvent.pointerDown(block, touch);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByTestId('drag-ghost')).not.toBeInTheDocument();
    fireEvent.pointerUp(document, touch);
    fireEvent.click(blockButton('מוזיאון'), { detail: 1 });
    expect(onOpenPlaced).not.toHaveBeenCalled();
    expect(repo.place).not.toHaveBeenCalled();
    expect(repo.unplace).not.toHaveBeenCalled();

    // A plain click (no drag attempted) still opens the activity for viewing.
    act(() => vi.advanceTimersByTime(1));
    const mouse = { pointerId: 2, pointerType: 'mouse', button: 0, clientX: 950, clientY: 110 };
    fireEvent.pointerDown(block, mouse);
    fireEvent.pointerUp(document, mouse);
    fireEvent.click(blockButton('מוזיאון'), { detail: 1 });
    expect(onOpenPlaced).toHaveBeenCalledTimes(1);
  });

  it('losing the connection while placing ends the mode', () => {
    renderPlanner('desktop');
    pressM(blockButton('מוזיאון'));
    expect(bar()).toBeInTheDocument();
    act(() => net.set(false));
    expect(bar()).not.toBeInTheDocument();
    expect(screen.getByText(STATUS.offline)).toBeInTheDocument();
  });
});

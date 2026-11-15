import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { addDays, PALETTE, type Activity, type Placement, type Trip } from '@/domain';
import { Timetable } from './Timetable';

// Connectivity the test can switch while the timetable is mounted (M7.3).
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

const OFFLINE_REASON =
  'אין חיבור לאינטרנט, אז אי אפשר לשמור שינויים כרגע. העריכה תחזור כשהחיבור יחזור.';

function makeTrip(overrides: Partial<Trip['window']> = {}, id = 'trip-1'): Trip {
  return {
    id,
    name: 'טיול',
    colorCursor: 0,
    window: {
      startDate: '2026-12-01',
      startMinute: 14 * 60,
      endDate: '2026-12-03',
      endMinute: 11 * 60,
      ...overrides,
    },
  };
}

let nextId = 0;
function makeActivity(
  name: string,
  durationMinutes: number,
  placement: Placement | null,
): Activity {
  nextId += 1;
  return {
    id: `a-${nextId}`,
    tripId: 'trip-1',
    name,
    durationMinutes,
    color: PALETTE[nextId % PALETTE.length] ?? PALETTE[0],
    placement,
    bankPosition: placement ? 0 : nextId,
  };
}

function renderTimetable(trip: Trip, activities: Activity[], onOpen = vi.fn()) {
  const utils = render(
    <div dir="rtl">
      <Timetable trip={trip} activities={activities} onOpenActivity={onOpen} />
    </div>,
  );
  return { ...utils, onOpen, scroller: screen.getByTestId('timetable-scroller') };
}

/** The ActivityBlock root (positioned element) of a block's open button. */
function blockOf(name: string): HTMLElement {
  const button = screen.getByRole('button', { name: new RegExp(name) });
  const block = button.closest<HTMLElement>('[data-drag-id]');
  if (!block) throw new Error(`no block for ${name}`);
  return block;
}

describe('Timetable', () => {
  it('is a labelled region with one day header per trip day, in trip order', () => {
    renderTimetable(makeTrip(), []);
    expect(screen.getByRole('region', { name: 'לוח הזמנים' })).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual([
      'יום שלישי1.12 · יום 1',
      'יום רביעי2.12 · יום 2',
      'יום חמישי3.12 · יום 3',
    ]);
  });

  it('lays day columns out from the inline start, so day 1 is on the right in RTL', () => {
    renderTimetable(makeTrip(), []);
    const groups = screen.getAllByRole('group');
    // DOM order = inline order; in a dir="rtl" grid the first column is the rightmost.
    expect(groups.map((g) => g.dataset.day)).toEqual(['2026-12-01', '2026-12-02', '2026-12-03']);
    expect(groups[0]?.closest('[dir]')).toHaveAttribute('dir', 'rtl');
    // Each column is announced with its day header.
    expect(screen.getByRole('group', { name: /יום 1$/ })).toBe(groups[0]);
    expect(screen.getByRole('group', { name: /יום 3$/ })).toBe(groups[2]);
  });

  it('hatches the slots before the trip start and after the trip end', () => {
    renderTimetable(makeTrip(), []);
    const [first, middle, last] = screen.getAllByRole('group');
    const spans = (el: HTMLElement | undefined) =>
      Array.from(el?.querySelectorAll<HTMLElement>('[data-disabled-slots]') ?? []).map((s) => [
        s.style.top,
        s.style.height,
      ]);
    expect(spans(first)).toEqual([['0px', `${28 * 28}px`]]); // 00:00–14:00
    expect(spans(middle)).toEqual([]);
    expect(spans(last)).toEqual([[`${22 * 28}px`, `${26 * 28}px`]]); // 11:00–24:00
  });

  it('positions placed blocks by start time with height from the duration', () => {
    renderTimetable(makeTrip(), [
      makeActivity('מוזיאון', 90, { date: '2026-12-02', startMinute: 9 * 60 }),
      makeActivity('קפה', 30, { date: '2026-12-01', startMinute: 14 * 60 }),
      makeActivity('במאגר', 60, null),
    ]);
    const museum = blockOf('מוזיאון');
    expect(museum.style.position).toBe('absolute');
    expect(museum.style.top).toBe(`${18 * 28 + 1}px`);
    expect(museum.style.height).toBe(`${3 * 28 - 3}px`);
    expect(within(museum).getByText('09:00–10:30')).toBeInTheDocument();
    expect(museum.closest('[data-day]')).toHaveAttribute('data-day', '2026-12-02');

    const coffee = blockOf('קפה');
    expect(coffee.style.top).toBe(`${28 * 28 + 1}px`);
    expect(coffee.style.height).toBe('25px');
    expect(coffee.closest('[data-day]')).toHaveAttribute('data-day', '2026-12-01');

    // Bank activities are not drawn in the grid.
    expect(screen.queryByText('במאגר')).not.toBeInTheDocument();
  });

  it('shows 24:00 for a block that ends at midnight, with no disabled tail on a full last day', () => {
    renderTimetable(makeTrip({ endDate: '2026-12-01', endMinute: 1440 }), [
      makeActivity('לילה', 60, { date: '2026-12-01', startMinute: 23 * 60 }),
    ]);
    const night = blockOf('לילה');
    expect(within(night).getByText('23:00–24:00')).toBeInTheDocument();
    expect(night.style.top).toBe(`${46 * 28 + 1}px`);
    const day = screen.getByRole('group');
    expect(
      Array.from(day.querySelectorAll<HTMLElement>('[data-disabled-slots]')).map(
        (s) => s.style.top,
      ),
    ).toEqual(['0px']);
  });

  it('opens an activity on click; focus order is the region, then blocks in time order', () => {
    const museum = makeActivity('מוזיאון', 90, { date: '2026-12-02', startMinute: 9 * 60 });
    const { onOpen, scroller } = renderTimetable(makeTrip(), [
      museum,
      makeActivity('קפה', 30, { date: '2026-12-02', startMinute: 7 * 60 }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: /מוזיאון/ }));
    expect(onOpen).toHaveBeenCalledWith(museum);

    // The region itself is focusable so keyboard users can scroll empty days (WCAG 2.1.1).
    expect(scroller).toHaveAttribute('tabindex', '0');
    const focusable = [
      scroller,
      ...Array.from(scroller.querySelectorAll<HTMLElement>('button, [tabindex], a, input')),
    ];
    // Whitespace-insensitive: ActivityBlock may put a space between name and time (a11y name).
    const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, '');
    expect(focusable.map((el) => (el === scroller ? 'region' : text(el)))).toEqual([
      'region',
      'קפה07:00–07:30', // time order within a day
      'מוזיאון09:00–10:30',
    ]);
  });

  it('opens scrolled to the trip start and keeps the scroll position while activities change', () => {
    const trip = makeTrip();
    const { scroller, rerender } = renderTimetable(trip, []);
    expect(scroller.scrollTop).toBe(27 * 28); // one slot above 14:00

    scroller.scrollTop = 100;
    scroller.scrollLeft = -300;
    const placed = makeActivity('קפה', 30, { date: '2026-12-02', startMinute: 600 });
    rerender(
      <div dir="rtl">
        <Timetable trip={trip} activities={[placed]} onOpenActivity={vi.fn()} />
      </div>,
    );
    expect(scroller.scrollTop).toBe(100);

    // Another trip opens at its own start (08:00 for a midnight start) on day 1.
    rerender(
      <div dir="rtl">
        <Timetable
          trip={makeTrip({ startMinute: 0 }, 'trip-2')}
          activities={[]}
          onOpenActivity={vi.fn()}
        />
      </div>,
    );
    expect(scroller.scrollTop).toBe(15 * 28);
    expect(scroller.scrollLeft).toBe(0);
  });

  it('renders a 1-day trip with a single column', () => {
    renderTimetable(makeTrip({ endDate: '2026-12-01', startMinute: 600, endMinute: 1200 }), []);
    expect(screen.getAllByRole('group')).toHaveLength(1);
    expect(screen.getByRole('group').querySelectorAll('[data-disabled-slots]')).toHaveLength(2);
  });

  it('renders a 90-day trip without per-slot cells (NFR-3)', () => {
    const trip = makeTrip({ endDate: addDays('2026-12-01', 89) });
    const activities: Activity[] = [];
    for (let d = 0; d < 90; d += 1) {
      const date = addDays('2026-12-01', d);
      activities.push(makeActivity(`בוקר ${d}`, 90, { date, startMinute: 15 * 60 }));
      activities.push(makeActivity(`ערב ${d}`, 60, { date, startMinute: 19 * 60 }));
    }
    const started = performance.now();
    const { scroller } = renderTimetable(trip, activities);
    const elapsed = performance.now() - started;

    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(90);
    expect(screen.getAllByRole('group')).toHaveLength(90);
    expect(scroller.querySelectorAll('[data-drag-id]')).toHaveLength(180);
    // Lines are backgrounds: far fewer elements than 90 days × 48 slots.
    expect(scroller.querySelectorAll('*').length).toBeLessThan(90 * 48);
    // No timing assertion (flaky on shared CI); jsdom is ~10x slower than a browser. The value is
    // printed so the M5.2 / M5.8 performance reports can quote it.
    console.info(
      `[M5.2] 90-day timetable (180 blocks) first render in jsdom: ${elapsed.toFixed(0)} ms, ` +
        `${scroller.querySelectorAll('*').length} elements`,
    );
  });

  describe('delete × and connectivity (SCHED-OFF-1)', () => {
    afterEach(() => {
      act(() => net.set(true));
    });

    function renderWithDelete(singleDay?: boolean) {
      const museum = makeActivity('מוזיאון', 90, { date: '2026-12-01', startMinute: 15 * 60 });
      const onDelete = vi.fn();
      render(
        <div dir="rtl">
          <Timetable
            trip={makeTrip()}
            activities={[museum]}
            onOpenActivity={vi.fn()}
            onDeleteActivity={onDelete}
            singleDay={singleDay}
          />
        </div>,
      );
      return {
        museum,
        onDelete,
        remove: () => screen.getByRole('button', { name: 'מחיקת מוזיאון' }),
      };
    }

    it('online: the × is enabled and asks the caller to delete', () => {
      const { museum, onDelete, remove } = renderWithDelete();
      expect(remove()).not.toHaveAttribute('aria-disabled');
      expect(remove()).not.toHaveAttribute('title');
      fireEvent.click(remove());
      expect(onDelete).toHaveBeenCalledExactlyOnceWith(museum);
    });

    it('offline: the × stays focusable but is aria-disabled with the reason, and opens no confirm', () => {
      net.set(false);
      const { onDelete, remove } = renderWithDelete();
      expect(remove()).toHaveAttribute('aria-disabled', 'true');
      expect(remove()).toHaveAttribute('title', OFFLINE_REASON);
      expect(remove()).toHaveAccessibleDescription(OFFLINE_REASON);
      remove().focus();
      expect(remove()).toHaveFocus();
      fireEvent.click(remove());
      expect(onDelete).not.toHaveBeenCalled();
    });

    it('follows the connection while mounted, keeping focus on the ×', () => {
      const { museum, onDelete, remove } = renderWithDelete();
      remove().focus();
      act(() => net.set(false));
      expect(remove()).toHaveAttribute('aria-disabled', 'true');
      expect(remove()).toHaveFocus();
      fireEvent.click(remove());
      expect(onDelete).not.toHaveBeenCalled();

      act(() => net.set(true));
      expect(remove()).not.toHaveAttribute('aria-disabled');
      expect(remove()).toHaveFocus();
      fireEvent.click(remove());
      expect(onDelete).toHaveBeenCalledExactlyOnceWith(museum);
    });

    it('disables the × in the phone single-day view too', () => {
      net.set(false);
      const { onDelete, remove } = renderWithDelete(true);
      expect(remove()).toHaveAttribute('aria-disabled', 'true');
      expect(remove()).toHaveAccessibleDescription(OFFLINE_REASON);
      fireEvent.click(remove());
      expect(onDelete).not.toHaveBeenCalled();
    });

    it('shows no × at all without a delete handler, online or offline', () => {
      net.set(false);
      renderTimetable(makeTrip(), [
        makeActivity('מוזיאון', 90, { date: '2026-12-01', startMinute: 15 * 60 }),
      ]);
      expect(screen.queryByRole('button', { name: 'מחיקת מוזיאון' })).not.toBeInTheDocument();
    });
  });
});

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { AppError } from '@/data';
import type { Trip } from '@/domain';
import { makeTrip, renderRoute } from './testUtils';
import { TripDialog } from './TripDialog';

const repo = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  create: vi.fn(),
  updateWindow: vi.fn(),
}));

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return { ...actual, tripsRepo: repo };
});

function Harness({ trip }: { trip?: Trip }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      {!open && <p>החלון נסגר</p>}
      <TripDialog open={open} trip={trip} onClose={() => setOpen(false)} />
    </>
  );
}

/** Renders the dialog and waits for the lazily loaded calendar. */
async function renderDialog(trip?: Trip) {
  const result = renderRoute(<Harness trip={trip} />, {
    path: '/trips',
    extraRoutes: [{ path: '/trips/:id', element: <p>דף הטיול החדש</p> }],
  });
  await screen.findByRole('grid');
  return result;
}

/** Clicks day `n` of the month shown in the calendar (not an outside day). */
function clickDay(n: number) {
  const day = within(screen.getByRole('grid'))
    .getAllByRole('button')
    .find((b) => b.textContent === String(n) && !b.closest('.rdp-outside'));
  if (!day) throw new Error(`day ${n} not found`);
  fireEvent.click(day);
}

function save(label = 'שמירה') {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

// The calendar is lazy-loaded; transform it once up front so no single test pays for it.
beforeAll(async () => {
  await import('./TripRangeCalendar');
}, 60_000);

beforeEach(() => {
  repo.create.mockReset();
  repo.updateWindow.mockReset();
});

describe('TripDialog — new trip (FR-2.2–2.5)', () => {
  it('starts with the name field focused and sensible defaults', async () => {
    await renderDialog();
    expect(screen.getByRole('dialog', { name: 'טיול חדש' })).toBeInTheDocument();
    expect(screen.getByLabelText('שם הטיול')).toHaveFocus();
    expect(screen.getByLabelText('שעת התחלה ביום הראשון')).toHaveValue('600');
    expect(screen.getByLabelText('שעת סיום ביום האחרון')).toHaveValue('1200');
    expect(screen.getByRole('group', { name: 'ימי הטיול' })).toBeInTheDocument();
    expect(screen.getByText(/4 ימים/)).toBeInTheDocument();
  });

  it('offers 48 start times 00:00–23:30 and 48 end times 00:30–24:00', async () => {
    await renderDialog();
    const start = within(screen.getByLabelText('שעת התחלה ביום הראשון')).getAllByRole('option');
    const end = within(screen.getByLabelText('שעת סיום ביום האחרון')).getAllByRole('option');
    expect(start).toHaveLength(48);
    expect(start[0]).toHaveTextContent('00:00');
    expect(start.at(-1)).toHaveTextContent('23:30');
    expect(end).toHaveLength(48);
    expect(end[0]).toHaveTextContent('00:30');
    expect(end.at(-1)).toHaveTextContent('24:00');
  });

  it('uses the default name "הטיול שלי" and opens the new trip', async () => {
    repo.create.mockImplementation(async (input) => ({ ...makeTrip({ id: 'new-1' }), ...input }));
    const { router } = await renderDialog();
    save('יצירת הטיול');
    expect(await screen.findByText('דף הטיול החדש')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/trips/new-1');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'הטיול שלי',
        window: expect.objectContaining({ startMinute: 600, endMinute: 1200 }),
      }),
    );
  });

  it('maps a server trip-window reason to the inline message', async () => {
    repo.create.mockRejectedValue(new AppError('validation', { reason: 'too_long' }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await renderDialog();
    save('יצירת הטיול');
    expect(await screen.findByText('אפשר לתכנן עד 90 ימים')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows other server errors above the form and keeps the input', async () => {
    repo.create.mockRejectedValue(new AppError('network', { retryable: true }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await renderDialog();
    fireEvent.change(screen.getByLabelText('שם הטיול'), { target: { value: 'יפן' } });
    save('יצירת הטיול');
    expect(await screen.findByRole('alert')).toHaveTextContent('אין חיבור לשרת');
    expect(screen.getByLabelText('שם הטיול')).toHaveValue('יפן');
  });
  it('cannot be closed while saving, so its result is not lost', async () => {
    let resolve: (trip: Trip) => void = () => {};
    repo.create.mockImplementation(() => new Promise<Trip>((r) => (resolve = r)));
    const { router } = await renderDialog();
    save('יצירת הטיול');
    const dialog = await screen.findByRole('dialog', { name: 'טיול חדש' });
    await waitFor(() =>
      expect(within(dialog).queryByRole('button', { name: 'סגירה' })).not.toBeInTheDocument(),
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    const backdrop = screen.getByTestId('modal-backdrop');
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(screen.getByRole('dialog', { name: 'טיול חדש' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'ביטול' })).toBeDisabled();

    resolve(makeTrip({ id: 'new-2' }));
    expect(await screen.findByText('דף הטיול החדש')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/trips/new-2');
  });
});

describe('TripDialog — calendar and validation', () => {
  const trip = makeTrip(); // 1–3 May 2026, 10:00–18:00

  it('selects the range with two clicks on one calendar (FR-2.3)', async () => {
    await renderDialog(trip);
    clickDay(10);
    expect(screen.getByText(/עכשיו בוחרים את יום הסיום/)).toBeInTheDocument();
    clickDay(12);
    expect(screen.getByText('מ־10 במאי 2026 עד 12 במאי 2026 · 3 ימים')).toBeInTheDocument();
  });

  it('asks for the end day when only the start was picked', async () => {
    await renderDialog(trip);
    clickDay(10);
    save();
    expect(screen.getByText(/צריך לבחור גם את יום הסיום/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'ימי הטיול' })).toHaveFocus();
    expect(repo.updateWindow).not.toHaveBeenCalled();
  });

  it('requires the end to be after the start on a one-day trip (FR-2.5)', async () => {
    await renderDialog(trip);
    clickDay(10);
    clickDay(10);
    fireEvent.change(screen.getByLabelText('שעת התחלה ביום הראשון'), { target: { value: '1080' } });
    fireEvent.change(screen.getByLabelText('שעת סיום ביום האחרון'), { target: { value: '600' } });
    save();
    const end = screen.getByLabelText('שעת סיום ביום האחרון');
    expect(end).toHaveFocus();
    expect(end).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('סוף הטיול צריך להיות אחרי ההתחלה')).toBeInTheDocument();
  });

  it('rejects trips longer than 90 days', async () => {
    await renderDialog(
      makeTrip({
        window: {
          startDate: '2026-01-01',
          startMinute: 600,
          endDate: '2026-04-01',
          endMinute: 600,
        },
      }),
    );
    save();
    expect(screen.getByText('אפשר לתכנן עד 90 ימים')).toBeInTheDocument();
    expect(repo.updateWindow).not.toHaveBeenCalled();
  });

  it('closes on Esc', async () => {
    await renderDialog(trip);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('TripDialog — edit (FR-2.6)', () => {
  const trip = makeTrip();

  it('starts from the trip values and saves name and window', async () => {
    repo.updateWindow.mockResolvedValue({ trip, movedCount: 0 });
    await renderDialog(trip);
    expect(screen.getByRole('dialog', { name: 'עריכת טיול' })).toBeInTheDocument();
    expect(screen.getByLabelText('שם הטיול')).toHaveValue('רומא');
    expect(screen.getByLabelText('שעת סיום ביום האחרון')).toHaveValue('1080');
    clickDay(2);
    clickDay(5);
    save();
    expect(await screen.findByText('החלון נסגר')).toBeInTheDocument();
    expect(repo.updateWindow).toHaveBeenCalledWith('trip-1', {
      name: 'רומא',
      window: { startDate: '2026-05-02', startMinute: 600, endDate: '2026-05-05', endMinute: 1080 },
    });
    expect(screen.queryByText(/חזרו? למאגר/)).not.toBeInTheDocument();
  });

  it.each([
    [1, 'אטרקציה אחת יצאה מטווח הטיול וחזרה למאגר'],
    [2, 'שתי אטרקציות יצאו מטווח הטיול וחזרו למאגר'],
    [5, '5 אטרקציות יצאו מטווח הטיול וחזרו למאגר'],
  ])('reports %i activities moved back to the bank', async (movedCount, message) => {
    repo.updateWindow.mockResolvedValue({ trip, movedCount });
    await renderDialog(trip);
    save();
    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
  });
});

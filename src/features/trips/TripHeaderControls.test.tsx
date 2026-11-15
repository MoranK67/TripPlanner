import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AppError } from '@/data';
import { makeSummary, makeTrip, renderRoute } from './testUtils';
import { TripHeaderControls } from './TripHeaderControls';

// Under load (parallel workers, a busy machine) data and lazy chunks can take longer than
// Testing Library's 1 s default; give findBy / waitFor more room in this file.
configure({ asyncUtilTimeout: 5_000 });

const repo = vi.hoisted(() => ({
  list: vi.fn(),
  delete: vi.fn(),
  updateWindow: vi.fn(),
  create: vi.fn(),
}));

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return { ...actual, tripsRepo: repo };
});

const trip = makeTrip();

function renderControls() {
  return renderRoute(<TripHeaderControls trip={trip} />, {
    path: '/trips/trip-1',
    pattern: '/trips/:tripId',
    extraRoutes: [{ path: '/trips', element: <h2>רשימת הטיולים</h2> }],
  });
}

function header() {
  return within(screen.getByTestId('header'));
}

// The calendar is lazy-loaded; transform it once up front so no single test pays for it.
beforeAll(async () => {
  await import('./TripRangeCalendar');
}, 120_000);

beforeEach(() => {
  for (const fn of Object.values(repo)) fn.mockReset();
  repo.list.mockResolvedValue([makeSummary(), makeSummary({ id: 'trip-2', name: 'פריז' })]);
});

describe('TripHeaderControls', () => {
  it('shows the trip range and length like the prototype', async () => {
    renderControls();
    expect(await header().findByText('1.5 10:00 עד 3.5 18:00 · 3 ימים')).toBeInTheDocument();
  });

  it('switches trips with the trip selector (FR-2.1)', async () => {
    const { router } = renderControls();
    const select = header().getByRole('combobox', { name: 'בחירת טיול' });
    await header().findByRole('option', { name: 'פריז' });
    fireEvent.change(select, { target: { value: 'trip-2' } });
    expect(router.state.location.pathname).toBe('/trips/trip-2');
  });

  it('opens the edit dialog with the current trip', async () => {
    renderControls();
    fireEvent.click(await header().findByRole('button', { name: 'עריכה' }));
    expect(screen.getByRole('dialog', { name: 'עריכת טיול' })).toBeInTheDocument();
    expect(screen.getByLabelText('שם הטיול')).toHaveValue('רומא');
  });

  it('deletes only after confirmation, then returns to the list (FR-2.7)', async () => {
    repo.delete.mockResolvedValue(undefined);
    const { router } = renderControls();
    fireEvent.click(await header().findByRole('button', { name: 'מחיקה' }));

    const dialog = screen.getByRole('alertdialog', { name: 'מחיקת טיול' });
    expect(dialog).toHaveAccessibleDescription(
      'בטוח שרוצים למחוק את הטיול "רומא" וכל מה שתוכנן בו?',
    );
    expect(within(dialog).getByRole('button', { name: 'ביטול' })).toHaveFocus();
    expect(repo.delete).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'כן, למחוק' }));
    expect(await screen.findByRole('heading', { name: 'רשימת הטיולים' })).toBeInTheDocument();
    expect(repo.delete).toHaveBeenCalledWith('trip-1');
    expect(router.state.location.pathname).toBe('/trips');
    expect(screen.getByText('הטיול "רומא" נמחק')).toBeInTheDocument();
  });

  it('cancelling the confirmation keeps the trip', async () => {
    renderControls();
    fireEvent.click(await header().findByRole('button', { name: 'מחיקה' }));
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('reports a failed delete', async () => {
    repo.delete.mockRejectedValue(new AppError('network', { retryable: true }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderControls();
    fireEvent.click(await header().findByRole('button', { name: 'מחיקה' }));
    fireEvent.click(screen.getByRole('button', { name: 'כן, למחוק' }));
    await waitFor(() => expect(screen.getByText(/אין חיבור לשרת/)).toBeInTheDocument());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows the export action passed by the page before the edit button', () => {
    renderRoute(
      <TripHeaderControls trip={trip} exportAction={<button type="button">ייצוא</button>} />,
      {
        path: '/trips/trip-1',
        pattern: '/trips/:tripId',
      },
    );
    const buttons = header()
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(buttons.indexOf('ייצוא')).toBeGreaterThanOrEqual(0);
    expect(buttons.indexOf('ייצוא')).toBeLessThan(buttons.indexOf('עריכה'));
  });
});

describe('TripHeaderControls offline (M7.3, FR-8.3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disables edit, delete and new trip with the reason; switching trips still works', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { router } = renderControls();
    for (const name of ['עריכה', 'מחיקה', '+ טיול חדש']) {
      const button = header().getByRole('button', { name });
      expect(button).toBeDisabled();
      expect(button.getAttribute('title')).toMatch(/^אין חיבור לאינטרנט/);
    }
    const select = header().getByRole('combobox', { name: 'בחירת טיול' });
    await header().findByRole('option', { name: 'פריז' });
    fireEvent.change(select, { target: { value: 'trip-2' } });
    expect(router.state.location.pathname).toBe('/trips/trip-2');
    expect(repo.delete).not.toHaveBeenCalled();
  });
});

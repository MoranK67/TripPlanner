import { configure, act, fireEvent, screen, within } from '@testing-library/react';
import { AppError } from '@/data';
import { makeSummary, renderRoute } from './testUtils';
import { TripsPage } from './TripsPage';

// Under load (parallel workers, a busy machine) data and lazy chunks can take longer than
// Testing Library's 1 s default; give findBy / waitFor more room in this file.
configure({ asyncUtilTimeout: 5_000 });

const repo = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }));

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return { ...actual, tripsRepo: repo };
});

// The calendar is lazy-loaded; transform it once up front so no single test pays for it.
beforeAll(async () => {
  await import('./TripRangeCalendar');
}, 120_000);

beforeEach(() => {
  repo.list.mockReset();
  repo.create.mockReset();
});

describe('TripsPage (FR-2.1, FR-2.8)', () => {
  it('lists trips in the order the repository returns (by start) with range and days', async () => {
    repo.list.mockResolvedValue([
      makeSummary({ id: 'a', name: 'רומא' }),
      makeSummary({
        id: 'b',
        name: 'פריז',
        window: { startDate: '2026-07-10', startMinute: 0, endDate: '2026-07-10', endMinute: 1440 },
        dayCount: 1,
      }),
    ]);
    renderRoute(<TripsPage />, { path: '/trips' });

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    const rome = within(items[0]!).getByRole('link');
    expect(rome).toHaveAttribute('href', '/trips/a');
    expect(rome).toHaveTextContent('רומא');
    expect(rome).toHaveTextContent('1 במאי 2026 10:00 עד 3 במאי 2026 18:00');
    expect(rome).toHaveTextContent('3 ימים');
    expect(within(items[1]!).getByRole('link')).toHaveTextContent('יום אחד');
    expect(within(items[1]!).getByRole('link')).toHaveTextContent('24:00');
  });

  it('shows an empty state with a create button', async () => {
    repo.list.mockResolvedValue([]);
    renderRoute(<TripsPage />, { path: '/trips' });
    expect(await screen.findByRole('heading', { name: 'עדיין אין טיולים' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ יצירת טיול ראשון' }));
    expect(screen.getByRole('dialog', { name: 'טיול חדש' })).toBeInTheDocument();
  });

  it('puts a "new trip" button in the header', async () => {
    repo.list.mockResolvedValue([makeSummary()]);
    renderRoute(<TripsPage />, { path: '/trips' });
    const header = screen.getByTestId('header');
    fireEvent.click(await within(header).findByRole('button', { name: '+ טיול חדש' }));
    expect(screen.getByRole('dialog', { name: 'טיול חדש' })).toBeInTheDocument();
  });

  it('renders extra header actions after "+ טיול חדש"', async () => {
    repo.list.mockResolvedValue([makeSummary()]);
    renderRoute(<TripsPage headerActions={<button type="button">פעולה נוספת</button>} />, {
      path: '/trips',
    });
    const header = screen.getByTestId('header');
    const buttons = await within(header).findAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['+ טיול חדש', 'פעולה נוספת']);
  });

  it('shows a Hebrew error with a retry button', async () => {
    repo.list.mockRejectedValueOnce(new AppError('network', { retryable: true }));
    repo.list.mockResolvedValueOnce([]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderRoute(<TripsPage />, { path: '/trips' });
    expect(await screen.findByRole('alert')).toHaveTextContent('אין חיבור לשרת');
    fireEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
    expect(await screen.findByRole('heading', { name: 'עדיין אין טיולים' })).toBeInTheDocument();
  });
});

describe('TripsPage offline (M7.3, FR-8.3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps showing the cached list when a refetch fails (e.g. offline after a reload)', async () => {
    repo.list.mockResolvedValueOnce([makeSummary({ id: 'a', name: 'רומא' })]);
    const { queryClient } = renderRoute(<TripsPage />, { path: '/trips' });
    expect(await screen.findByText('רומא')).toBeInTheDocument();

    repo.list.mockRejectedValueOnce(new AppError('network', { retryable: true }));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['trips', 'list'] });
    });
    expect(screen.getByText('רומא')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables creating trips with the reason', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    repo.list.mockResolvedValue([]);
    renderRoute(<TripsPage />, { path: '/trips' });
    const create = await screen.findByRole('button', { name: '+ יצירת טיול ראשון' });
    expect(create).toBeDisabled();
    expect(create.getAttribute('title')).toMatch(/^אין חיבור לאינטרנט/);
    const headerNew = within(screen.getByTestId('header')).getByRole('button', {
      name: '+ טיול חדש',
    });
    expect(headerNew).toBeDisabled();
    fireEvent.click(headerNew);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

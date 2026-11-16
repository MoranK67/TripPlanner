import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { ToastProvider } from '@/components/ui';
import { AppError } from '@/data';
import { TripPage } from './TripPage';

const trips = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(async () => []) }));
const activities = vi.hoisted(() => ({ delete: vi.fn(), update: vi.fn(), create: vi.fn() }));

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return { ...actual, tripsRepo: trips, activitiesRepo: activities };
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/trips/:tripId', element: <TripPage /> }], {
    initialEntries: ['/trips/trip-1'],
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe('TripPage', () => {
  it('shows the bank in the side panel and the timetable in the main area', async () => {
    trips.get.mockResolvedValue({
      trip: {
        id: 'trip-1',
        name: 'רומא',
        window: {
          startDate: '2026-05-01',
          startMinute: 600,
          endDate: '2026-05-03',
          endMinute: 1080,
        },
        colorCursor: 0,
      },
      activities: [],
    });
    renderPage();
    const bank = await screen.findByRole('complementary', { name: 'מאגר אטרקציות' });
    expect(within(bank).getByRole('heading', { name: 'מאגר אטרקציות' })).toBeInTheDocument();
    // Named by the sr-only h2 (aria-labelledby), so the name is announced once (UX-2).
    const region = screen.getByRole('region', { name: 'לוח הזמנים' });
    const heading = screen.getByRole('heading', { level: 2, name: 'לוח הזמנים' });
    expect(region).toHaveAttribute('aria-labelledby', heading.id);
    expect(region).not.toHaveAttribute('aria-label');
    expect(trips.get).toHaveBeenCalledWith('trip-1');
    // Heading outline: trip, bank and timetable are h2; the timetable's day headers are h3.
    const h2 = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(h2).toEqual(expect.arrayContaining(['רומא', 'מאגר אטרקציות', 'לוח הזמנים']));
  });

  it('explains when the trip does not exist', async () => {
    trips.get.mockRejectedValue(new AppError('not_found'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage();
    expect(await screen.findByRole('heading', { name: /הטיול לא נמצא/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'חזרה לטיולים' })).toHaveAttribute('href', '/trips');
  });

  it('treats a malformed trip id (validation error) as not found', async () => {
    trips.get.mockRejectedValue(new AppError('validation'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage();
    expect(await screen.findByRole('heading', { name: /הטיול לא נמצא/ })).toBeInTheDocument();
  });

  describe('placed blocks in the timetable', () => {
    const data = {
      trip: {
        id: 'trip-1',
        name: 'רומא',
        window: {
          startDate: '2026-05-01',
          startMinute: 600,
          endDate: '2026-05-03',
          endMinute: 1080,
        },
        colorCursor: 0,
      },
      activities: [
        {
          id: 'placed-1',
          tripId: 'trip-1',
          name: 'מוזיאון',
          durationMinutes: 90,
          color: '#CDE5FF',
          placement: { date: '2026-05-02', startMinute: 660 },
          bankPosition: 1,
        },
      ],
    };

    it('opens the edit dialog for the clicked activity (FR-3.5)', async () => {
      trips.get.mockResolvedValue(data);
      renderPage();
      const timetable = await screen.findByRole('region', { name: 'לוח הזמנים' });
      fireEvent.click(within(timetable).getByRole('button', { name: 'מוזיאון 11:00–12:30' }));
      const dialog = screen.getByRole('dialog', { name: 'עריכת אטרקציה' });
      expect(within(dialog).getByLabelText('שם האטרקציה')).toHaveValue('מוזיאון');
      expect(within(dialog).getByLabelText('כמה זמן זה לוקח?')).toHaveValue('01:30');
    });

    it('asks before deleting from the × (FR-3.4)', async () => {
      trips.get.mockResolvedValue(data);
      activities.delete.mockResolvedValue(undefined);
      renderPage();
      const timetable = await screen.findByRole('region', { name: 'לוח הזמנים' });
      fireEvent.click(within(timetable).getByRole('button', { name: 'מחיקת מוזיאון' }));
      const confirm = screen.getByRole('alertdialog', { name: 'מחיקת אטרקציה' });
      expect(confirm).toHaveAccessibleDescription('בטוח שרוצים למחוק את "מוזיאון"?');
      expect(within(confirm).getByRole('button', { name: 'ביטול' })).toHaveFocus();
      expect(activities.delete).not.toHaveBeenCalled();
      fireEvent.click(within(confirm).getByRole('button', { name: 'כן, למחוק' }));
      await waitFor(() => expect(activities.delete).toHaveBeenCalledWith('placed-1'));
    });

    it('moves focus to the timetable after a block is deleted (UX-2)', async () => {
      trips.get.mockResolvedValue(data);
      activities.delete.mockResolvedValue(undefined);
      renderPage();
      const timetable = await screen.findByRole('region', { name: 'לוח הזמנים' });
      const remove = within(timetable).getByRole('button', { name: 'מחיקת מוזיאון' });
      remove.focus();
      fireEvent.click(remove);
      const confirm = screen.getByRole('alertdialog', { name: 'מחיקת אטרקציה' });
      // The refetch after the delete returns the trip without the block.
      trips.get.mockResolvedValue({ ...data, activities: [] });
      fireEvent.click(within(confirm).getByRole('button', { name: 'כן, למחוק' }));

      await waitFor(() =>
        expect(within(timetable).queryByRole('button', { name: /מוזיאון/ })).toBeNull(),
      );
      await waitFor(() => expect(timetable).toHaveFocus());
    });

    it('moves focus to the next block of the same day, else the previous one (UX-2)', async () => {
      const block = (id: string, name: string, startMinute: number, date = '2026-05-02') => ({
        ...data.activities[0],
        id,
        name,
        durationMinutes: 60,
        placement: { date, startMinute },
      });
      const all = [
        block('a', 'בוקר', 540),
        block('b', 'צהריים', 720),
        block('c', 'ערב', 1020),
        block('other', 'יום אחר', 600, '2026-05-01'),
      ];
      trips.get.mockResolvedValue({ ...data, activities: all });
      activities.delete.mockResolvedValue(undefined);
      renderPage();
      const timetable = await screen.findByRole('region', { name: 'לוח הזמנים' });

      async function deleteBlock(name: string) {
        const remove = within(timetable).getByRole('button', { name: `מחיקת ${name}` });
        remove.focus();
        fireEvent.click(remove);
        fireEvent.click(screen.getByRole('button', { name: 'כן, למחוק' }));
        await waitFor(() =>
          expect(within(timetable).queryByRole('button', { name: `מחיקת ${name}` })).toBeNull(),
        );
      }

      // The middle block: focus goes to the later one that day, not to the other day.
      trips.get.mockResolvedValue({ ...data, activities: all.filter((a) => a.id !== 'b') });
      await deleteBlock('צהריים');
      await waitFor(() =>
        expect(within(timetable).getByRole('button', { name: /^ערב / })).toHaveFocus(),
      );

      // The last block of the day: focus goes to the previous one.
      trips.get.mockResolvedValue({ ...data, activities: [all[0], all[3]] });
      await deleteBlock('ערב');
      await waitFor(() =>
        expect(within(timetable).getByRole('button', { name: /^בוקר / })).toHaveFocus(),
      );
    });

    it('keeps focus on the timetable when the delete fails and the block comes back', async () => {
      trips.get.mockResolvedValue(data);
      // The test decides when the server answers, so the optimistic removal is seen first.
      let fail: (error: unknown) => void = () => {};
      activities.delete.mockReturnValue(new Promise<void>((_, reject) => (fail = reject)));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      renderPage();
      const timetable = await screen.findByRole('region', { name: 'לוח הזמנים' });
      const remove = within(timetable).getByRole('button', { name: 'מחיקת מוזיאון' });
      remove.focus();
      fireEvent.click(remove);
      fireEvent.click(screen.getByRole('button', { name: 'כן, למחוק' }));

      await waitFor(() =>
        expect(within(timetable).queryByRole('button', { name: /מוזיאון/ })).toBeNull(),
      );
      await waitFor(() => expect(timetable).toHaveFocus());

      act(() => fail(new AppError('network', { retryable: true })));
      expect(await screen.findByText(/המחיקה לא הצליחה/)).toBeInTheDocument();
      expect(
        await within(timetable).findByRole('button', { name: 'מוזיאון 11:00–12:30' }),
      ).toBeInTheDocument();
      expect(timetable).toHaveFocus();
    });
  });
});

describe('TripPage offline (M7.3, FR-8.3)', () => {
  const tripData = {
    trip: {
      id: 'trip-1',
      name: 'רומא',
      window: { startDate: '2026-05-01', startMinute: 600, endDate: '2026-05-03', endMinute: 1080 },
      colorCursor: 0,
    },
    activities: [],
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the (cached) trip on screen when a refetch fails with a network error', async () => {
    trips.get.mockResolvedValueOnce(tripData);
    const queryClient = renderPage();
    await screen.findByRole('complementary', { name: 'מאגר אטרקציות' });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    trips.get.mockRejectedValueOnce(new AppError('network', { retryable: true }));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['trips', 'detail', 'trip-1'] });
    });
    expect(screen.getByRole('complementary', { name: 'מאגר אטרקציות' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('still says "not found" when a refetch finds the trip deleted', async () => {
    trips.get.mockResolvedValueOnce(tripData);
    const queryClient = renderPage();
    await screen.findByRole('complementary', { name: 'מאגר אטרקציות' });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    trips.get.mockRejectedValueOnce(new AppError('not_found'));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['trips', 'detail', 'trip-1'] });
    });
    expect(await screen.findByRole('heading', { name: /הטיול לא נמצא/ })).toBeInTheDocument();
  });
});

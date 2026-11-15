import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    expect(screen.getByRole('region', { name: 'לוח הזמנים' })).toBeInTheDocument();
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
  });
});

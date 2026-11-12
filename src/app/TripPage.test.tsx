import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { ToastProvider } from '@/components/ui';
import { AppError } from '@/data';
import { TripPage } from './TripPage';

const trips = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(async () => []) }));

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return { ...actual, tripsRepo: trips };
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
  it('shows the bank in the side panel and a timetable placeholder', async () => {
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
});

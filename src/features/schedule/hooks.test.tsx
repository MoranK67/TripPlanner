import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import { AppError } from '@/data';
import { PALETTE, type Activity, type TripWithActivities } from '@/domain';
import { tripKeys } from '@/features/trips';
import { usePlacementActions } from './hooks';

const repo = vi.hoisted(() => ({ place: vi.fn(), unplace: vi.fn() }));

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return { ...actual, activitiesRepo: repo };
});

const activity: Activity = {
  id: 'a-1',
  tripId: 'trip-1',
  name: 'שוק',
  durationMinutes: 60,
  color: PALETTE[0],
  placement: null,
  bankPosition: 1,
};
const data: TripWithActivities = {
  trip: {
    id: 'trip-1',
    name: 'טיול',
    colorCursor: 0,
    window: { startDate: '2026-12-01', startMinute: 0, endDate: '2026-12-03', endMinute: 1440 },
  },
  activities: [activity],
};

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(tripKeys.detail('trip-1'), data);
  // Keep the seeded data: no query function is registered, so invalidation must not refetch.
  vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  const { result } = renderHook(() => usePlacementActions('trip-1'), { wrapper });
  const cached = () => queryClient.getQueryData<TripWithActivities>(tripKeys.detail('trip-1'));
  return { result, cached, queryClient };
}

afterEach(() => vi.restoreAllMocks());

describe('usePlacementActions', () => {
  it('places through the repository and writes the result into the trip cache', async () => {
    const placed = { ...activity, placement: { date: '2026-12-02', startMinute: 600 } };
    repo.place.mockResolvedValue(placed);
    const { result, cached, queryClient } = setup();
    act(() => result.current.place('a-1', '2026-12-02', 600));
    await waitFor(() => expect(cached()?.activities[0]).toEqual(placed));
    expect(repo.place).toHaveBeenCalledWith('a-1', '2026-12-02', 600);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: tripKeys.detail('trip-1'),
    });
  });

  it('unplaces through the repository', async () => {
    const back = { ...activity, bankPosition: 7 };
    repo.unplace.mockResolvedValue(back);
    const { result, cached } = setup();
    act(() => result.current.unplace('a-1'));
    await waitFor(() => expect(cached()?.activities[0]).toEqual(back));
    expect(repo.unplace).toHaveBeenCalledWith('a-1');
  });

  it('shows the error kind message when the server rejects the placement', async () => {
    repo.place.mockRejectedValue(new AppError('conflict_overlap'));
    const { result, cached } = setup();
    act(() => result.current.place('a-1', '2026-12-02', 600));
    expect(await screen.findByText('יש כבר אטרקציה אחרת בזמן הזה.')).toBeInTheDocument();
    expect(cached()?.activities[0]).toEqual(activity);
  });
});

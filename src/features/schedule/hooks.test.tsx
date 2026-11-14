import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import { AppError } from '@/data';
import { PALETTE, type Activity, type TripWithActivities } from '@/domain';
import { tripKeys } from '@/features/trips';
import { usePlacementActions } from './hooks';

const repo = vi.hoisted(() => ({ place: vi.fn(), unplace: vi.fn() }));
const toastShown = vi.hoisted(() => vi.fn());

// Record every toast.show call (the provider replaces the visible toast, so the DOM cannot count).
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...actual,
    useToast: () => {
      const api = actual.useToast();
      return {
        ...api,
        show: (...args: Parameters<typeof api.show>) => {
          toastShown(...args);
          api.show(...args);
        },
      };
    },
  };
});

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
const museum: Activity = {
  id: 'a-2',
  tripId: 'trip-1',
  name: 'מוזיאון',
  durationMinutes: 90,
  color: PALETTE[1],
  placement: { date: '2026-12-01', startMinute: 540 },
  bankPosition: 4,
};
const data: TripWithActivities = {
  trip: {
    id: 'trip-1',
    name: 'טיול',
    colorCursor: 0,
    window: { startDate: '2026-12-01', startMinute: 0, endDate: '2026-12-03', endMinute: 1440 },
  },
  activities: [activity, museum],
};

const MESSAGES = {
  conflict_overlap: 'יש כבר אטרקציה אחרת בזמן הזה.',
  out_of_range: 'הזמן הזה מחוץ לתאריכים ולשעות של הטיול.',
  network: 'אין חיבור לשרת. כדאי לבדוק את החיבור לאינטרנט ולנסות שוב.',
} as const;

/** A promise the test resolves or rejects by hand, to observe the state while a save is pending. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const placed = (a: Activity, date: string, startMinute: number): Activity => ({
  ...a,
  placement: { date, startMinute },
});

function setup() {
  // The app's mutation defaults (src/app/queryClient.ts): no retry, offlineFirst (DEC-030).
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false, networkMode: 'offlineFirst' },
    },
  });
  queryClient.setQueryData(tripKeys.detail('trip-1'), data);
  // Keep the cache as the hook leaves it: no query function is registered, so do not refetch.
  vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
  const cancel = vi.spyOn(queryClient, 'cancelQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  const mount = () => renderHook(() => usePlacementActions('trip-1'), { wrapper });
  const { result, unmount } = mount();
  const cached = () => queryClient.getQueryData<TripWithActivities>(tripKeys.detail('trip-1'));
  const find = (id: string) => cached()?.activities.find((a) => a.id === id);
  const settled = () => waitFor(() => expect(queryClient.isMutating()).toBe(0));
  /** A refetch the hook did not start (e.g. window focus) that returns `server`. */
  const refetch = (server: TripWithActivities) =>
    act(async () => {
      await queryClient.fetchQuery({
        queryKey: tripKeys.detail('trip-1'),
        queryFn: () => Promise.resolve(server),
        staleTime: 0,
      });
    });
  return { result, unmount, mount, cached, find, settled, refetch, queryClient, cancel };
}

afterEach(() => {
  vi.restoreAllMocks();
  repo.place.mockReset();
  repo.unplace.mockReset();
  toastShown.mockReset();
});

describe('usePlacementActions', () => {
  it('moves the block before the server answers, then writes the server result', async () => {
    const save = deferred<Activity>();
    repo.place.mockReturnValue(save.promise);
    const { result, find, settled, queryClient, cancel } = setup();

    act(() => result.current.place('a-1', '2026-12-02', 600));
    await waitFor(() =>
      expect(find('a-1')?.placement).toEqual({ date: '2026-12-02', startMinute: 600 }),
    );
    expect(repo.place).toHaveBeenCalledWith('a-1', '2026-12-02', 600);
    expect(cancel).toHaveBeenCalledWith({ queryKey: tripKeys.detail('trip-1') });
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();

    // The server's row wins (here it differs in an unrelated field).
    const server = { ...placed(activity, '2026-12-02', 600), name: 'שוק הכרמל' };
    await act(async () => save.resolve(server));
    await settled();
    expect(find('a-1')).toEqual(server);
    expect(find('a-2')).toEqual(museum);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: tripKeys.detail('trip-1'),
    });
  });

  it('unplaces optimistically to the end of the bank (max bank position + 1)', async () => {
    const save = deferred<Activity>();
    repo.unplace.mockReturnValue(save.promise);
    const { result, find, settled } = setup();

    act(() => result.current.unplace('a-2'));
    await waitFor(() =>
      expect(find('a-2')).toEqual({ ...museum, placement: null, bankPosition: 5 }),
    );
    expect(repo.unplace).toHaveBeenCalledWith('a-2');

    const server = { ...museum, placement: null, bankPosition: 9 };
    await act(async () => save.resolve(server));
    await settled();
    expect(find('a-2')).toEqual(server);
  });

  it.each(['conflict_overlap', 'out_of_range', 'network'] as const)(
    'rolls back and shows the %s message when the save fails',
    async (kind) => {
      const save = deferred<Activity>();
      repo.place.mockReturnValue(save.promise);
      const { result, cached, find, settled, queryClient } = setup();

      act(() => result.current.place('a-2', '2026-12-03', 600));
      await waitFor(() => expect(find('a-2')?.placement?.date).toBe('2026-12-03'));

      await act(async () => save.reject(new AppError(kind)));
      expect(await screen.findByText(MESSAGES[kind])).toBeInTheDocument();
      await settled();
      expect(cached()).toEqual(data);
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: tripKeys.detail('trip-1'),
      });
    },
  );

  it('rolls back an unplace that fails', async () => {
    repo.unplace.mockRejectedValue(new AppError('not_found'));
    const { result, cached, settled } = setup();
    act(() => result.current.unplace('a-2'));
    expect(await screen.findByText('הפריט לא נמצא. ייתכן שהוא נמחק.')).toBeInTheDocument();
    await settled();
    expect(cached()).toEqual(data);
  });

  it('rolls back an aborted request without a toast', async () => {
    repo.place.mockRejectedValue(new AppError('network', { reason: 'aborted' }));
    const { result, cached, settled } = setup();
    act(() => result.current.place('a-1', '2026-12-02', 600));
    await settled();
    expect(cached()).toEqual(data);
    expect(screen.queryByText(MESSAGES.network)).not.toBeInTheDocument();
  });

  describe('a second drag of the same block while the first save is pending', () => {
    it('sends the saves in drop order and keeps the last position', async () => {
      const first = deferred<Activity>();
      const second = deferred<Activity>();
      repo.place.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const { result, find, settled, queryClient } = setup();

      act(() => result.current.place('a-1', '2026-12-02', 600));
      act(() => result.current.place('a-1', '2026-12-03', 720));
      await waitFor(() =>
        expect(find('a-1')?.placement).toEqual({ date: '2026-12-03', startMinute: 720 }),
      );
      // Serialised: the second request is not sent before the first one is answered.
      expect(repo.place).toHaveBeenCalledTimes(1);

      // The first answer must not pull the block back to the first position.
      await act(async () => first.resolve(placed(activity, '2026-12-02', 600)));
      await waitFor(() => expect(repo.place).toHaveBeenCalledTimes(2));
      expect(repo.place).toHaveBeenLastCalledWith('a-1', '2026-12-03', 720);
      expect(find('a-1')?.placement).toEqual({ date: '2026-12-03', startMinute: 720 });
      expect(queryClient.invalidateQueries).not.toHaveBeenCalled();

      await act(async () => second.resolve(placed(activity, '2026-12-03', 720)));
      await settled();
      expect(find('a-1')).toEqual(placed(activity, '2026-12-03', 720));
      expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    });

    it('rolls back to the last confirmed position when the later save fails', async () => {
      const first = deferred<Activity>();
      const second = deferred<Activity>();
      repo.place.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const { result, find, settled } = setup();

      act(() => result.current.place('a-1', '2026-12-02', 600));
      act(() => result.current.place('a-1', '2026-12-03', 720));
      await act(async () => first.resolve(placed(activity, '2026-12-02', 600)));
      await waitFor(() => expect(repo.place).toHaveBeenCalledTimes(2));
      await act(async () => second.reject(new AppError('conflict_overlap')));
      await settled();
      expect(await screen.findByText(MESSAGES.conflict_overlap)).toBeInTheDocument();
      expect(find('a-1')).toEqual(placed(activity, '2026-12-02', 600));
    });

    it('keeps the later move when only the earlier save fails', async () => {
      const first = deferred<Activity>();
      const second = deferred<Activity>();
      repo.place.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const { result, find, settled } = setup();

      act(() => result.current.place('a-1', '2026-12-02', 600));
      act(() => result.current.place('a-1', '2026-12-03', 720));
      await act(async () => first.reject(new AppError('conflict_overlap')));
      // Superseded: no snap back to the bank while the second save is pending.
      expect(find('a-1')?.placement).toEqual({ date: '2026-12-03', startMinute: 720 });
      await waitFor(() => expect(repo.place).toHaveBeenCalledTimes(2));
      await act(async () => second.resolve(placed(activity, '2026-12-03', 720)));
      await settled();
      expect(find('a-1')).toEqual(placed(activity, '2026-12-03', 720));
    });

    it('rolls back to the original position when both saves fail', async () => {
      repo.place.mockRejectedValue(new AppError('network'));
      const { result, cached, settled } = setup();
      act(() => result.current.place('a-1', '2026-12-02', 600));
      act(() => result.current.place('a-1', '2026-12-03', 720));
      await waitFor(() => expect(repo.place).toHaveBeenCalledTimes(2));
      await settled();
      expect(cached()).toEqual(data);
    });
  });

  it('keeps another block’s pending move when one save fails', async () => {
    const first = deferred<Activity>();
    const second = deferred<Activity>();
    repo.place.mockReturnValueOnce(first.promise);
    repo.unplace.mockReturnValueOnce(second.promise);
    const { result, find, settled } = setup();

    act(() => result.current.place('a-1', '2026-12-02', 600));
    act(() => result.current.unplace('a-2'));
    await act(async () => first.reject(new AppError('out_of_range')));
    expect(find('a-1')).toEqual(activity);
    expect(find('a-2')?.placement).toBeNull();
    await act(async () => second.resolve({ ...museum, placement: null, bankPosition: 5 }));
    await settled();
    expect(find('a-2')).toEqual({ ...museum, placement: null, bankPosition: 5 });
  });

  it('place, unplace, place of one block: a failure in the middle is superseded', async () => {
    const first = deferred<Activity>();
    const middle = deferred<Activity>();
    const last = deferred<Activity>();
    repo.place.mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise);
    repo.unplace.mockReturnValueOnce(middle.promise);
    const { result, find, settled } = setup();

    act(() => result.current.place('a-1', '2026-12-02', 600));
    act(() => result.current.unplace('a-1'));
    act(() => result.current.place('a-1', '2026-12-03', 720));
    await waitFor(() =>
      expect(find('a-1')?.placement).toEqual({ date: '2026-12-03', startMinute: 720 }),
    );

    await act(async () => first.resolve(placed(activity, '2026-12-02', 600)));
    await waitFor(() => expect(repo.unplace).toHaveBeenCalledTimes(1));
    await act(async () => middle.reject(new AppError('network')));
    expect(await screen.findByText(MESSAGES.network)).toBeInTheDocument();
    expect(find('a-1')?.placement).toEqual({ date: '2026-12-03', startMinute: 720 });

    await waitFor(() => expect(repo.place).toHaveBeenCalledTimes(2));
    expect(repo.place).toHaveBeenLastCalledWith('a-1', '2026-12-03', 720);
    await act(async () => last.resolve(placed(activity, '2026-12-03', 720)));
    await settled();
    expect(find('a-1')).toEqual(placed(activity, '2026-12-03', 720));
  });

  it('A leaves a slot, B enters it, A’s save fails: both end where the server has them', async () => {
    const leave = deferred<Activity>();
    const enter = deferred<Activity>();
    repo.unplace.mockReturnValueOnce(leave.promise);
    repo.place.mockReturnValueOnce(enter.promise);
    const { result, cached, find, settled } = setup();

    act(() => result.current.unplace('a-2'));
    act(() => result.current.place('a-1', '2026-12-01', 540));
    await waitFor(() =>
      expect(find('a-1')?.placement).toEqual({ date: '2026-12-01', startMinute: 540 }),
    );
    expect(find('a-2')?.placement).toBeNull();

    // A goes back to its slot; B's save is still queued behind it.
    await act(async () => leave.reject(new AppError('network')));
    expect(find('a-2')).toEqual(museum);
    expect(find('a-1')?.placement).toEqual({ date: '2026-12-01', startMinute: 540 });

    // The server still has A there, so B is refused and returns to the bank.
    await waitFor(() => expect(repo.place).toHaveBeenCalledTimes(1));
    await act(async () => enter.reject(new AppError('conflict_overlap')));
    await settled();
    expect(cached()).toEqual(data);
    expect(toastShown).toHaveBeenCalledTimes(2);
  });

  describe('leaving the trip page and coming back while a save is pending', () => {
    it('does not pull the block back when the earlier save succeeds', async () => {
      const first = deferred<Activity>();
      const second = deferred<Activity>();
      repo.place.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const { result, unmount, mount, find, settled } = setup();

      act(() => result.current.place('a-1', '2026-12-02', 600));
      await waitFor(() => expect(repo.place).toHaveBeenCalledTimes(1));
      unmount();
      const again = mount();
      act(() => again.result.current.place('a-1', '2026-12-03', 720));
      await waitFor(() =>
        expect(find('a-1')?.placement).toEqual({ date: '2026-12-03', startMinute: 720 }),
      );

      await act(async () => first.resolve(placed(activity, '2026-12-02', 600)));
      // The second request starts only after the first one's callbacks have run.
      await waitFor(() => expect(repo.place).toHaveBeenCalledTimes(2));
      expect(find('a-1')?.placement).toEqual({ date: '2026-12-03', startMinute: 720 });
      await act(async () => second.resolve(placed(activity, '2026-12-03', 720)));
      await settled();
      expect(find('a-1')).toEqual(placed(activity, '2026-12-03', 720));
    });

    it('rolls back to the last confirmed value, not the unsaved first drop', async () => {
      const first = deferred<Activity>();
      const second = deferred<Activity>();
      repo.place.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const { result, unmount, mount, cached, find, settled } = setup();

      act(() => result.current.place('a-1', '2026-12-02', 600));
      await waitFor(() => expect(repo.place).toHaveBeenCalledTimes(1));
      unmount();
      const again = mount();
      act(() => again.result.current.place('a-1', '2026-12-03', 720));
      await waitFor(() =>
        expect(find('a-1')?.placement).toEqual({ date: '2026-12-03', startMinute: 720 }),
      );

      // Superseded by the second drop: no jump back to the bank.
      await act(async () => first.reject(new AppError('conflict_overlap')));
      expect(find('a-1')?.placement).toEqual({ date: '2026-12-03', startMinute: 720 });
      await waitFor(() => expect(repo.place).toHaveBeenCalledTimes(2));
      await act(async () => second.reject(new AppError('conflict_overlap')));
      await settled();
      expect(cached()).toEqual(data);
    });
  });

  it('keeps queued moves visible when a refetch it did not start lands mid-queue', async () => {
    const first = deferred<Activity>();
    const second = deferred<Activity>();
    const third = deferred<Activity>();
    repo.place.mockReturnValueOnce(first.promise).mockReturnValueOnce(third.promise);
    repo.unplace.mockReturnValueOnce(second.promise);
    const { result, find, settled, refetch } = setup();
    const unplacedMuseum = { ...museum, placement: null, bankPosition: 5 };

    act(() => result.current.place('a-1', '2026-12-02', 600));
    act(() => result.current.unplace('a-2'));
    act(() => result.current.place('a-1', '2026-12-03', 720));
    await waitFor(() =>
      expect(find('a-1')?.placement).toEqual({ date: '2026-12-03', startMinute: 720 }),
    );

    // Nothing is saved yet, so the server returns the old rows (plus a rename saved elsewhere).
    const renamed = { ...activity, name: 'שוק הכרמל' };
    await refetch({ ...data, activities: [renamed, museum] });
    expect(find('a-1')).toEqual(placed(renamed, '2026-12-03', 720));
    expect(find('a-2')).toEqual(unplacedMuseum);

    // Two writes are confirmed, but a refetch that started earlier still returns old rows.
    await act(async () => first.resolve(placed(activity, '2026-12-02', 600)));
    await waitFor(() => expect(repo.unplace).toHaveBeenCalledTimes(1));
    await act(async () => second.resolve(unplacedMuseum));
    await waitFor(() => expect(repo.place).toHaveBeenCalledTimes(2));
    await refetch(data);
    expect(find('a-1')?.placement).toEqual({ date: '2026-12-03', startMinute: 720 });
    expect(find('a-2')).toEqual(unplacedMuseum);

    await act(async () => third.resolve(placed(activity, '2026-12-03', 720)));
    await settled();
    expect(find('a-1')).toEqual(placed(activity, '2026-12-03', 720));
    expect(find('a-2')).toEqual(unplacedMuseum);
  });

  it('shows one toast per error kind while the queue drains', async () => {
    repo.place.mockRejectedValue(new AppError('network'));
    repo.unplace.mockRejectedValue(new AppError('not_found'));
    const { result, cached, settled } = setup();

    act(() => result.current.place('a-1', '2026-12-02', 600));
    act(() => result.current.place('a-1', '2026-12-03', 720));
    act(() => result.current.unplace('a-2'));
    act(() => result.current.place('a-1', '2026-12-02', 900));
    await settled();
    expect(cached()).toEqual(data);
    expect(toastShown).toHaveBeenCalledTimes(2);
    expect(toastShown).toHaveBeenNthCalledWith(1, MESSAGES.network, { tone: 'error' });

    // A new queue reports its failures again.
    act(() => result.current.place('a-1', '2026-12-02', 600));
    await settled();
    expect(toastShown).toHaveBeenCalledTimes(3);
  });

  it('treats unplacing a bank activity as a no-op, like the RPC', async () => {
    const save = deferred<Activity>();
    repo.unplace.mockReturnValue(save.promise);
    const { result, find, settled } = setup();
    act(() => result.current.unplace('a-1'));
    await waitFor(() => expect(repo.unplace).toHaveBeenCalledWith('a-1'));
    expect(find('a-1')).toEqual(activity);
    await act(async () => save.resolve(activity));
    await settled();
    expect(find('a-1')).toEqual(activity);
  });

  it('does not bring back a queued activity the server no longer has', async () => {
    const save = deferred<Activity>();
    repo.place.mockReturnValueOnce(save.promise);
    const { result, find, settled, refetch } = setup();

    act(() => result.current.place('a-1', '2026-12-02', 600));
    await waitFor(() => expect(find('a-1')?.placement?.date).toBe('2026-12-02'));
    // Deleted elsewhere meanwhile.
    await refetch({ ...data, activities: [museum] });
    expect(find('a-1')).toBeUndefined();

    await act(async () => save.resolve(placed(activity, '2026-12-02', 600)));
    await settled();
    expect(find('a-1')).toBeUndefined();
  });

  describe('after the queue is gone, refetches are shown as the server sends them', () => {
    it('once the queue has drained', async () => {
      repo.place.mockResolvedValueOnce(placed(activity, '2026-12-02', 600));
      const { result, cached, settled, refetch } = setup();
      act(() => result.current.place('a-1', '2026-12-02', 600));
      await settled();

      const server = { ...data, activities: [placed(activity, '2026-12-03', 0), museum] };
      await refetch(server);
      expect(cached()).toEqual(server);
    });

    it('once the cache is cleared (sign-out) with a save in flight', async () => {
      const save = deferred<Activity>();
      repo.place.mockReturnValueOnce(save.promise);
      const { result, cached, find, refetch, queryClient } = setup();
      act(() => result.current.place('a-1', '2026-12-02', 600));
      await waitFor(() => expect(find('a-1')?.placement?.date).toBe('2026-12-02'));

      act(() => queryClient.clear());
      // The trip page loads again while the old save is still in flight.
      await refetch(data);
      expect(cached()).toEqual(data);

      await act(async () => save.resolve(placed(activity, '2026-12-02', 600)));
      expect(cached()).toEqual(data);
      await refetch(data);
      expect(cached()).toEqual(data);
    });
  });

  it('shows no toast for a save that fails after the cache was cleared (sign-out)', async () => {
    const save = deferred<Activity>();
    repo.place.mockReturnValueOnce(save.promise);
    const { result, cached, find, queryClient } = setup();
    act(() => result.current.place('a-1', '2026-12-02', 600));
    await waitFor(() => expect(find('a-1')?.placement?.date).toBe('2026-12-02'));

    act(() => queryClient.clear());
    await act(async () => save.reject(new AppError('network')));
    expect(cached()).toBeUndefined();
    expect(toastShown).not.toHaveBeenCalled();
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppError } from '@/data';
import { PALETTE, type Activity, type Trip, type TripWithActivities } from '@/domain';
import { ToastProvider } from '@/components/ui';
import { tripKeys, useTripQuery } from '@/features/trips';
import { BankPanel } from './BankPanel';

const repo = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));
const trips = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return { ...actual, activitiesRepo: repo, tripsRepo: trips };
});

const trip: Trip = {
  id: 'trip-1',
  name: 'רומא',
  window: { startDate: '2026-05-01', startMinute: 600, endDate: '2026-05-03', endMinute: 1080 },
  colorCursor: 5,
};

function activity(overrides: Partial<Activity>): Activity {
  return {
    id: 'a',
    tripId: 'trip-1',
    name: 'קפה',
    durationMinutes: 60,
    color: PALETTE[0],
    placement: null,
    bankPosition: 1,
    ...overrides,
  };
}

const ACTIVITIES = [
  activity({ id: 'late', name: 'שייט בנהר', bankPosition: 3, durationMinutes: 90 }),
  activity({ id: 'placed', name: 'מוזיאון', placement: { date: '2026-05-01', startMinute: 600 } }),
  activity({ id: 'early', name: 'קולוסיאום', bankPosition: 1.5, durationMinutes: 120 }),
];

/** Renders the bank from the trip cache, as the trip page does. */
function CachedBank() {
  const query = useTripQuery('trip-1');
  return query.data ? (
    <BankPanel trip={query.data.trip} activities={query.data.activities} />
  ) : null;
}

function renderBank(activities: Activity[] = ACTIVITIES) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  const data: TripWithActivities = { trip, activities };
  queryClient.setQueryData(tripKeys.detail(trip.id), data);
  // A refetch returns whatever the "server" (the cache after the mutation) has.
  trips.get.mockImplementation(async () => queryClient.getQueryData(tripKeys.detail(trip.id)));
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <CachedBank />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

beforeEach(() => {
  for (const fn of [...Object.values(repo), trips.get]) fn.mockReset();
});

describe('BankPanel list', () => {
  it('shows only unplaced activities, ordered by bank position, with a count', () => {
    renderBank();
    expect(screen.getByRole('heading', { name: 'מאגר אטרקציות (2)' })).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: 'אטרקציות במאגר' })).getAllByRole(
      'listitem',
    );
    expect(items.map((li) => li.textContent)).toEqual(['קולוסיאוםשעתיים×', 'שייט בנהרשעה וחצי×']);
    expect(screen.queryByText('מוזיאון')).not.toBeInTheDocument();
  });

  it('shows an empty state', () => {
    renderBank([]);
    expect(screen.getByText(/המאגר ריק/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});

describe('add activity (FR-3.1, FR-3.2)', () => {
  it('previews the next palette color and lets the DB assign it', async () => {
    repo.create.mockResolvedValue(activity({ id: 'new', name: 'גלידה', bankPosition: 4 }));
    renderBank();
    fireEvent.click(screen.getByRole('button', { name: '+ הוספה' }));
    const dialog = screen.getByRole('dialog', { name: 'אטרקציה חדשה' });
    expect(within(dialog).getByLabelText('שם האטרקציה')).toHaveFocus();
    // colorCursor 5 → PALETTE[5] (sky).
    expect(within(dialog).getByRole('radio', { name: 'תכלת' })).toBeChecked();
    expect(within(dialog).getByLabelText('כמה זמן זה לוקח?')).toHaveValue('60');

    fireEvent.change(within(dialog).getByLabelText('שם האטרקציה'), {
      target: { value: '  גלידה ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'הוספה למאגר' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(repo.create).toHaveBeenCalledWith('trip-1', { name: 'גלידה', durationMinutes: 60 });
  });

  it('sends a color the user picked', async () => {
    repo.create.mockResolvedValue(activity({ id: 'new' }));
    renderBank();
    fireEvent.click(screen.getByRole('button', { name: '+ הוספה' }));
    fireEvent.change(screen.getByLabelText('שם האטרקציה'), { target: { value: 'גלידה' } });
    fireEvent.change(screen.getByLabelText('כמה זמן זה לוקח?'), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('radio', { name: 'מנטה' }));
    fireEvent.click(screen.getByRole('button', { name: 'הוספה למאגר' }));
    await waitFor(() =>
      expect(repo.create).toHaveBeenCalledWith('trip-1', {
        name: 'גלידה',
        durationMinutes: 150,
        color: PALETTE[3],
      }),
    );
  });

  it('offers durations from half an hour to 24 hours with Hebrew labels', () => {
    renderBank();
    fireEvent.click(screen.getByRole('button', { name: '+ הוספה' }));
    const options = within(screen.getByLabelText('כמה זמן זה לוקח?')).getAllByRole('option');
    expect(options).toHaveLength(48);
    expect(options.map((o) => o.textContent).slice(0, 4)).toEqual([
      'חצי שעה',
      'שעה',
      'שעה וחצי',
      'שעתיים',
    ]);
    expect(options.at(-1)).toHaveTextContent('24 שעות');
  });

  it('requires a name', () => {
    renderBank();
    fireEvent.click(screen.getByRole('button', { name: '+ הוספה' }));
    fireEvent.change(screen.getByLabelText('שם האטרקציה'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוספה למאגר' }));
    expect(screen.getByText('צריך לתת שם לאטרקציה')).toBeInTheDocument();
    expect(screen.getByLabelText('שם האטרקציה')).toHaveFocus();
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('edit activity (FR-3.5, FR-3.6)', () => {
  it('opens from the block with the current values and saves the patch', async () => {
    repo.update.mockResolvedValue({
      activity: activity({ id: 'early', name: 'קולוסיאום', durationMinutes: 180 }),
      returnedToBank: false,
    });
    renderBank();
    fireEvent.click(screen.getByRole('button', { name: 'קולוסיאום שעתיים' }));
    const dialog = screen.getByRole('dialog', { name: 'עריכת אטרקציה' });
    expect(within(dialog).getByLabelText('שם האטרקציה')).toHaveValue('קולוסיאום');
    expect(within(dialog).getByLabelText('כמה זמן זה לוקח?')).toHaveValue('120');
    fireEvent.change(within(dialog).getByLabelText('כמה זמן זה לוקח?'), {
      target: { value: '180' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'שמירה' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(repo.update).toHaveBeenCalledWith('early', {
      name: 'קולוסיאום',
      durationMinutes: 180,
      color: PALETTE[0],
    });
  });

  it('tells the user when the activity went back to the bank', async () => {
    repo.update.mockResolvedValue({ activity: activity({ id: 'early' }), returnedToBank: true });
    renderBank();
    fireEvent.click(screen.getByRole('button', { name: 'קולוסיאום שעתיים' }));
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(
      await screen.findByText('האטרקציה ארוכה מדי למקום שלה בלוח, ולכן חזרה למאגר'),
    ).toBeInTheDocument();
  });

  it('shows a server error in the dialog and keeps it open', async () => {
    repo.update.mockRejectedValue(new AppError('not_found'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderBank();
    fireEvent.click(screen.getByRole('button', { name: 'קולוסיאום שעתיים' }));
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('הפריט לא נמצא');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('delete activity (FR-3.4)', () => {
  it('asks first with Cancel focused, then deletes optimistically', async () => {
    repo.delete.mockResolvedValue(undefined);
    const queryClient = renderBank();
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת קולוסיאום' }));
    const dialog = screen.getByRole('alertdialog', { name: 'מחיקת אטרקציה' });
    expect(dialog).toHaveAccessibleDescription('בטוח שרוצים למחוק את "קולוסיאום"?');
    expect(within(dialog).getByRole('button', { name: 'ביטול' })).toHaveFocus();

    fireEvent.click(within(dialog).getByRole('button', { name: 'כן, למחוק' }));
    await waitFor(() => expect(repo.delete).toHaveBeenCalledWith('early'));
    const cached = queryClient.getQueryData<TripWithActivities>(tripKeys.detail('trip-1'));
    expect(cached?.activities.map((a) => a.id)).not.toContain('early');
  });

  it('restores the activity and reports a failed delete', async () => {
    repo.delete.mockRejectedValue(new AppError('network', { retryable: true }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const queryClient = renderBank();
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת קולוסיאום' }));
    fireEvent.click(screen.getByRole('button', { name: 'כן, למחוק' }));
    expect(await screen.findByText(/המחיקה לא הצליחה/)).toBeInTheDocument();
    const cached = queryClient.getQueryData<TripWithActivities>(tripKeys.detail('trip-1'));
    expect(cached?.activities.map((a) => a.id)).toContain('early');
  });

  it('does nothing when cancelled', () => {
    renderBank();
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת קולוסיאום' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(repo.delete).not.toHaveBeenCalled();
  });
});

describe('dialogs while saving and focus after delete', () => {
  it('keeps the activity dialog open while it saves', async () => {
    let resolve: (a: Activity) => void = () => {};
    repo.create.mockImplementation(() => new Promise<Activity>((r) => (resolve = r)));
    renderBank();
    fireEvent.click(screen.getByRole('button', { name: '+ הוספה' }));
    fireEvent.change(screen.getByLabelText('שם האטרקציה'), { target: { value: 'גלידה' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוספה למאגר' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'סגירה' })).not.toBeInTheDocument(),
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'אטרקציה חדשה' })).toBeInTheDocument();
    resolve(activity({ id: 'new', name: 'גלידה', bankPosition: 9 }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('moves focus to the next block after a delete', async () => {
    repo.delete.mockResolvedValue(undefined);
    renderBank();
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת קולוסיאום' }));
    fireEvent.click(screen.getByRole('button', { name: 'כן, למחוק' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'שייט בנהר שעה וחצי' })).toHaveFocus(),
    );
  });

  it('moves focus to the previous block when the last one is deleted', async () => {
    repo.delete.mockResolvedValue(undefined);
    renderBank();
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת שייט בנהר' }));
    fireEvent.click(screen.getByRole('button', { name: 'כן, למחוק' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'קולוסיאום שעתיים' })).toHaveFocus(),
    );
  });

  it('moves focus to the bank heading when the bank becomes empty', async () => {
    repo.delete.mockResolvedValue(undefined);
    renderBank([activity({ id: 'only', name: 'קפה' })]);
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת קפה' }));
    fireEvent.click(screen.getByRole('button', { name: 'כן, למחוק' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'מאגר אטרקציות' })).toHaveFocus(),
    );
  });

  it('wraps the cached color cursor after adding (FR-3.2)', async () => {
    repo.create.mockResolvedValue(activity({ id: 'new' }));
    const queryClient = renderBank();
    queryClient.setQueryData<TripWithActivities>(tripKeys.detail('trip-1'), {
      trip: { ...trip, colorCursor: PALETTE.length - 1 },
      activities: ACTIVITIES,
    });
    fireEvent.click(screen.getByRole('button', { name: '+ הוספה' }));
    fireEvent.change(screen.getByLabelText('שם האטרקציה'), { target: { value: 'גלידה' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוספה למאגר' }));
    await waitFor(() =>
      expect(
        queryClient.getQueryData<TripWithActivities>(tripKeys.detail('trip-1'))?.trip.colorCursor,
      ).toBe(0),
    );
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppError } from '@/data';
import { PALETTE, type Activity, type Trip, type TripWithActivities } from '@/domain';
import { ToastProvider } from '@/components/ui';
import { tripKeys, useTripQuery } from '@/features/trips';
import { BankPanel, type BankPanelProps } from './BankPanel';
import { resetTagFilters } from './tagFilterStore';

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
function CachedBank({ variant }: { variant?: BankPanelProps['variant'] }) {
  const query = useTripQuery('trip-1');
  return query.data ? (
    <BankPanel trip={query.data.trip} activities={query.data.activities} variant={variant} />
  ) : null;
}

function renderBank(activities: Activity[] = ACTIVITIES, variant?: BankPanelProps['variant']) {
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
        <CachedBank variant={variant} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

beforeEach(() => {
  for (const fn of [...Object.values(repo), trips.get]) fn.mockReset();
  resetTagFilters();
});

describe('BankPanel list', () => {
  it('shows only unplaced activities, ordered by bank position, with a count', () => {
    renderBank();
    expect(screen.getByRole('heading', { name: 'מאגר אטרקציות (2)' })).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: 'אטרקציות במאגר' })).getAllByRole(
      'listitem',
    );
    expect(items.map((li) => li.textContent)).toEqual(['קולוסיאום שעתיים×', 'שייט בנהר שעה וחצי×']);
    expect(screen.queryByText('מוזיאון')).not.toBeInTheDocument();
  });

  it('shows an empty state', () => {
    renderBank([]);
    expect(screen.getByText(/המאגר ריק/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});

describe('inside the phone bottom sheet (UX-7)', () => {
  it('keeps the title for screen readers only and drops its own card', () => {
    renderBank(ACTIVITIES, 'sheet');
    // The sheet handle already shows "מאגר אטרקציות (N)"; the heading stays in the outline.
    const heading = screen.getByRole('heading', { name: 'מאגר אטרקציות (2)' });
    expect(heading).toHaveClass('sr-only');
    const panel = heading.closest('[data-variant]');
    expect(panel).toHaveAttribute('data-variant', 'sheet');
    expect(panel).not.toHaveClass('border');
    expect(panel?.className).not.toMatch(/shadow/);
    expect(screen.getByRole('button', { name: '+ הוספה' })).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows the visible title and card by default (side panel)', () => {
    renderBank();
    const heading = screen.getByRole('heading', { name: 'מאגר אטרקציות (2)' });
    expect(heading).not.toHaveClass('sr-only');
    expect(heading.closest('[data-variant]')).toHaveClass('border');
  });

  it('moves focus to the (screen-reader) bank heading when the bank becomes empty', async () => {
    repo.delete.mockResolvedValue(undefined);
    renderBank([activity({ id: 'only', name: 'קפה' })], 'sheet');
    fireEvent.click(screen.getByRole('button', { name: 'מחיקת קפה' }));
    fireEvent.click(screen.getByRole('button', { name: 'כן, למחוק' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'מאגר אטרקציות' })).toHaveFocus(),
    );
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
    expect(within(dialog).getByLabelText('כמה זמן זה לוקח?')).toHaveValue('01:00');

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
    fireEvent.change(screen.getByLabelText('כמה זמן זה לוקח?'), { target: { value: '0230' } });
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

  it('takes a typed HHMM duration, rounded to the half hour (UX-5)', async () => {
    repo.create.mockResolvedValue(activity({ id: 'new' }));
    renderBank();
    fireEvent.click(screen.getByRole('button', { name: '+ הוספה' }));
    const duration = screen.getByLabelText('כמה זמן זה לוקח?');
    expect(duration).toHaveAttribute('inputmode', 'numeric');
    expect(duration).toHaveAccessibleDescription('שעות ודקות, לדוגמה 0130 = שעה וחצי');
    fireEvent.change(screen.getByLabelText('שם האטרקציה'), { target: { value: 'גלידה' } });
    fireEvent.change(duration, { target: { value: '0145' } });
    fireEvent.blur(duration);
    expect(duration).toHaveValue('02:00');
    expect(screen.getByText(/עוגל ל-02:00/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'הוספה למאגר' }));
    await waitFor(() =>
      expect(repo.create).toHaveBeenCalledWith('trip-1', { name: 'גלידה', durationMinutes: 120 }),
    );
  });

  it.each([
    ['0000', 'משך מינימלי חצי שעה'],
    ['0014', 'משך מינימלי חצי שעה'],
    ['2430', 'משך מקסימלי 24 שעות'],
    ['שעה', 'צריך להקליד ספרות בלבד, למשל 0130 או 1:30'],
    ['', 'צריך להקליד משך זמן, למשל 0130'],
  ])('blocks saving an invalid duration %j', (text, message) => {
    renderBank();
    fireEvent.click(screen.getByRole('button', { name: '+ הוספה' }));
    fireEvent.change(screen.getByLabelText('שם האטרקציה'), { target: { value: 'גלידה' } });
    const duration = screen.getByLabelText('כמה זמן זה לוקח?');
    fireEvent.change(duration, { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'הוספה למאגר' }));
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(duration).toHaveFocus();
    expect(duration).toHaveAttribute('aria-invalid', 'true');
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('after a timeout says it may have been saved and refetches the bank (UX-3)', async () => {
    repo.create.mockRejectedValue(new AppError('network', { reason: 'timeout', retryable: true }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderBank();
    // The server did commit it: the refetch after the error brings it in.
    const saved = activity({ id: 'saved', name: 'גלידה', bankPosition: 4 });
    trips.get.mockResolvedValue({ trip, activities: [...ACTIVITIES, saved] });
    fireEvent.click(screen.getByRole('button', { name: '+ הוספה' }));
    fireEvent.change(screen.getByLabelText('שם האטרקציה'), { target: { value: 'גלידה' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוספה למאגר' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'ייתכן שהפעולה בכל זאת נשמרה: לפני שמנסים שוב, כדאי לסגור את החלון ולבדוק ברשימה.',
    );
    await waitFor(() => expect(trips.get).toHaveBeenCalled());
    expect(
      await within(screen.getByRole('list', { name: 'אטרקציות במאגר' })).findByText('גלידה'),
    ).toBeInTheDocument();
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
    expect(within(dialog).getByLabelText('כמה זמן זה לוקח?')).toHaveValue('02:00');
    fireEvent.change(within(dialog).getByLabelText('כמה זמן זה לוקח?'), {
      target: { value: '3' },
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

describe('offline (M7.3, FR-8.3)', () => {
  const REASON = 'אין חיבור לאינטרנט, אז אי אפשר לשמור שינויים כרגע. העריכה תחזור כשהחיבור יחזור.';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is read-only: add, import and × are disabled with the reason', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderBank();
    for (const name of ['+ הוספה', 'ייבוא רשימה']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', REASON);
    }
    const remove = screen.getByRole('button', { name: 'מחיקת קולוסיאום' });
    expect(remove).toHaveAttribute('aria-disabled', 'true');
    expect(remove).toHaveAccessibleDescription(REASON);
    fireEvent.click(remove);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('still opens an activity, but its dialog cannot save (no request is made)', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderBank();
    fireEvent.click(screen.getByRole('button', { name: 'קולוסיאום שעתיים' }));
    const dialog = screen.getByRole('dialog', { name: 'עריכת אטרקציה' });
    expect(within(dialog).getByText(REASON)).toBeInTheDocument();
    const save = within(dialog).getByRole('button', { name: 'שמירה' });
    expect(save).toBeDisabled();
    // Enter in a field submits the form: still nothing is sent.
    fireEvent.submit(save.closest('form')!);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('enables editing again when the connection returns', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderBank();
    expect(screen.getByRole('button', { name: '+ הוספה' })).toBeDisabled();
    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.getByRole('button', { name: '+ הוספה' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'מחיקת קולוסיאום' })).not.toHaveAttribute(
      'aria-disabled',
    );
  });
});

describe('tag filter chips (FEAT-2)', () => {
  const TAGGED = [
    activity({ id: 'm', name: 'מוזיאון', tag: 'מרכז', color: PALETTE[2], bankPosition: 1 }),
    activity({ id: 'c', name: 'קפה', tag: 'מרכז', color: PALETTE[2], bankPosition: 2 }),
    activity({ id: 'p', name: 'נמל', tag: 'Port', color: PALETTE[6], bankPosition: 3 }),
    activity({ id: 'x', name: 'גלידה', bankPosition: 4 }),
    // Placed: its tag counts for the colour, not for the bank count.
    activity({
      id: 'z',
      name: 'מצודה',
      tag: 'צפון',
      placement: { date: '2026-05-01', startMinute: 600 },
    }),
  ];
  const names = () =>
    within(screen.getByRole('list', { name: 'אטרקציות במאגר' }))
      .getAllByRole('listitem')
      .map((li) => li.querySelector('[title]')?.getAttribute('title'));

  it('shows "all" and each bank tag with its count as a toggle group', () => {
    renderBank(TAGGED);
    const group = screen.getByRole('group', { name: 'סינון לפי תגית' });
    const chips = within(group).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['הכול', 'מרכז (2)', 'Port (1)']);
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true');
    expect(chips[1]).toHaveAttribute('aria-pressed', 'false');
    // Hebrew collation: Hebrew tags before Latin ones.
  });

  it('filters the list, and pressing the chip again shows all', () => {
    renderBank(TAGGED);
    expect(names()).toEqual(['מוזיאון · מרכז', 'קפה · מרכז', 'נמל · Port', 'גלידה']);
    const chip = screen.getByRole('button', { name: 'מרכז (2)' });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'הכול' })).toHaveAttribute('aria-pressed', 'false');
    expect(names()).toEqual(['מוזיאון · מרכז', 'קפה · מרכז']);
    fireEvent.click(chip);
    expect(names()).toHaveLength(4);
  });

  it('remembers the selection per trip while the panel remounts', () => {
    renderBank(TAGGED);
    fireEvent.click(screen.getByRole('button', { name: 'Port (1)' }));
    cleanup();
    renderBank(TAGGED, 'sheet');
    expect(screen.getByRole('button', { name: 'Port (1)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(names()).toEqual(['נמל · Port']);
  });

  it('scrolls sideways in the phone sheet instead of wrapping', () => {
    renderBank(TAGGED, 'sheet');
    expect(screen.getByRole('group', { name: 'סינון לפי תגית' })).toHaveClass(
      'flex-nowrap',
      'overflow-x-auto',
    );
  });

  it('has no chips without tags, and puts the tag in the block name', () => {
    renderBank(TAGGED);
    expect(screen.getByRole('button', { name: 'קפה שעה (תגית: מרכז)' })).toBeInTheDocument();
    cleanup();
    renderBank();
    expect(screen.queryByRole('group', { name: 'סינון לפי תגית' })).not.toBeInTheDocument();
  });
});

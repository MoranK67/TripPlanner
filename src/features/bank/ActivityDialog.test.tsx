import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui';
import { AppError } from '@/data';
import { PALETTE, type Activity, type Trip, type TripWithActivities } from '@/domain';
import { tripKeys, useTripQuery } from '@/features/trips';
import { ActivityDialog } from './ActivityDialog';

const repo = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  place: vi.fn(),
  unplace: vi.fn(),
}));
const trips = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return { ...actual, activitiesRepo: repo, tripsRepo: trips };
});

// Fri 1.5 10:00 – Sun 3.5 18:00.
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
    tag: null,
    ...overrides,
  };
}

const museum = activity({
  id: 'museum',
  name: 'מוזיאון',
  durationMinutes: 120,
  color: PALETTE[2],
  placement: { date: '2026-05-02', startMinute: 600 },
  tag: 'מרכז העיר',
  createdAt: '2026-04-01T10:00:00.000Z',
});
const cafe = activity({
  id: 'cafe',
  name: 'קפה',
  bankPosition: 2,
  color: PALETTE[7],
  tag: 'מרכז העיר',
  createdAt: '2026-04-02T10:00:00.000Z',
});
const market = activity({ id: 'market', name: 'שוק', bankPosition: 3, durationMinutes: 90 });
const ACTIVITIES = [museum, cafe, market];

/** The dialog with the trip from the cache, as the bank and the trip page render it. */
function CachedDialog({ activityId, onClose }: { activityId?: string; onClose: () => void }) {
  const query = useTripQuery('trip-1');
  if (!query.data) return null;
  const subject = query.data.activities.find((a) => a.id === activityId);
  return (
    <ActivityDialog
      open
      onClose={onClose}
      trip={query.data.trip}
      activities={query.data.activities}
      activity={activityId ? subject : undefined}
    />
  );
}

function setup(activityId?: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  const data: TripWithActivities = { trip, activities: ACTIVITIES };
  queryClient.setQueryData(tripKeys.detail(trip.id), data);
  trips.get.mockImplementation(async () => queryClient.getQueryData(tripKeys.detail(trip.id)));
  const onClose = vi.fn();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <CachedDialog activityId={activityId} onClose={onClose} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  const cached = (id: string) =>
    queryClient
      .getQueryData<TripWithActivities>(tripKeys.detail(trip.id))
      ?.activities.find((a) => a.id === id);
  return { queryClient, onClose, cached, view };
}

const field = (label: string) => screen.getByLabelText(label);
const day = () => screen.getByRole('combobox', { name: 'יום' }) as HTMLSelectElement;
const from = () => field('משעה');
const to = () => field('עד שעה');
const duration = () => field('כמה זמן זה לוקח?');

function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

beforeEach(() => {
  for (const fn of [...Object.values(repo), trips.get]) fn.mockReset();
});

describe('placement section (FEAT-1)', () => {
  it('pre-fills Day / From / To for a placed activity', () => {
    setup('museum');
    const dialog = screen.getByRole('dialog', { name: 'עריכת אטרקציה' });
    expect(within(dialog).getByRole('group', { name: 'שיבוץ בלוח' })).toBeInTheDocument();
    expect(day().value).toBe('2026-05-02');
    expect(day().selectedOptions[0]).toHaveTextContent('יום 2 · שבת 2.5');
    expect(from()).toHaveValue('10:00');
    expect(to()).toHaveValue('12:00');
    expect(from()).toBeEnabled();
  });

  it('starts "not placed" with From / To empty and disabled for a bank activity', () => {
    setup('market');
    expect(day().value).toBe('');
    expect(day().selectedOptions[0]).toHaveTextContent('לא משובץ (במאגר)');
    // The first option, then the three trip days.
    expect(within(day()).getAllByRole('option')).toHaveLength(4);
    expect(from()).toHaveValue('');
    expect(from()).toBeDisabled();
    expect(to()).toBeDisabled();
  });

  it('picking a day fills the first free slot for the duration', () => {
    setup('market');
    fireEvent.change(day(), { target: { value: '2026-05-02' } });
    // 10:00–12:00 is the museum's: the first free 90 minutes start at 12:00.
    expect(from()).toHaveValue('12:00');
    expect(to()).toHaveValue('13:30');
    expect(from()).toBeEnabled();
  });

  it('the duration follows the range, and a typed duration moves To', () => {
    setup('museum');
    type(to(), '1230');
    expect(duration()).toHaveValue('02:30');
    type(from(), '1100');
    expect(duration()).toHaveValue('01:30');
    fireEvent.blur(from());
    type(duration(), '0300');
    expect(to()).toHaveValue('14:00');
    expect(from()).toHaveValue('11:00');
  });

  it('shows inline errors and disables Save while the range is invalid', () => {
    setup('market');
    const save = screen.getByRole('button', { name: 'שמירה' });
    fireEvent.change(day(), { target: { value: '2026-05-02' } });
    expect(save).toBeEnabled();

    // Overlaps the museum (10:00–12:00).
    type(from(), '1100');
    expect(to()).toHaveAccessibleDescription('יש כבר אטרקציה בזמן הזה: „מוזיאון” (10:00–12:00)');
    expect(to()).toHaveAttribute('aria-invalid', 'true');
    expect(save).toBeDisabled();

    // To not after From.
    type(from(), '1400');
    type(to(), '1300');
    expect(to()).toHaveAccessibleDescription('שעת הסיום צריכה להיות אחרי שעת ההתחלה');
    expect(save).toBeDisabled();

    // Outside the trip hours on the first day (from 10:00).
    fireEvent.change(day(), { target: { value: '2026-05-01' } });
    type(to(), '1000');
    type(from(), '0900');
    expect(from()).toHaveAccessibleDescription('ביום הזה אפשר לשבץ רק בין 10:00 ל-24:00');
    expect(save).toBeDisabled();

    // Back to the bank: the times no longer matter.
    fireEvent.change(day(), { target: { value: '' } });
    expect(from()).toBeDisabled();
    expect(from()).not.toHaveAttribute('aria-invalid');
    expect(save).toBeEnabled();
  });

  it('always shows why Save is disabled, also for a cleared time not yet left', () => {
    setup('museum');
    type(from(), '');
    expect(from()).toHaveAccessibleDescription('צריך להקליד שעה, למשל 0800');
    expect(screen.getByRole('button', { name: 'שמירה' })).toBeDisabled();
    type(from(), '1000');
    type(duration(), '');
    expect(duration()).toHaveAccessibleDescription(/צריך להקליד משך זמן/);
    expect(screen.getByRole('button', { name: 'שמירה' })).toBeDisabled();
  });

  it('flags a duration that would end after midnight', () => {
    setup('market');
    fireEvent.change(day(), { target: { value: '2026-05-02' } });
    type(from(), '2200');
    type(duration(), '0300');
    expect(duration()).toHaveAccessibleDescription(/עם המשך הזה האטרקציה תסתיים אחרי חצות/);
    expect(screen.getByRole('button', { name: 'שמירה' })).toBeDisabled();
  });

  it('saves the placement with the other fields in one request, optimistically', async () => {
    let resolve: (v: unknown) => void = () => {};
    repo.update.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { cached, onClose } = setup('market');
    fireEvent.change(day(), { target: { value: '2026-05-03' } });
    type(from(), '1300');
    type(to(), '1500');
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));

    await waitFor(() =>
      expect(repo.update).toHaveBeenCalledWith('market', {
        name: 'שוק',
        durationMinutes: 120,
        color: PALETTE[0],
        placement: { date: '2026-05-03', startMinute: 780 },
      }),
    );
    // Shown at once, before the server answers.
    expect(cached('market')?.placement).toEqual({ date: '2026-05-03', startMinute: 780 });
    expect(cached('market')?.durationMinutes).toBe(120);
    resolve({
      activity: activity({
        ...market,
        durationMinutes: 120,
        placement: { date: '2026-05-03', startMinute: 780 },
      }),
      returnedToBank: false,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // Not the automatic FR-3.6 case: no "returned to bank" notice.
    expect(screen.queryByText(/חזרה למאגר/)).not.toBeInTheDocument();
  });

  it('"not placed" returns a placed activity to the bank', async () => {
    repo.update.mockResolvedValue({
      activity: { ...museum, placement: null, bankPosition: 4 },
      returnedToBank: false,
    });
    const { cached } = setup('museum');
    fireEvent.change(day(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    await waitFor(() =>
      expect(repo.update).toHaveBeenCalledWith(
        'museum',
        expect.objectContaining({ placement: null }),
      ),
    );
    await waitFor(() => expect(cached('museum')?.placement).toBeNull());
    expect(screen.queryByText(/חזרה למאגר/)).not.toBeInTheDocument();
  });

  it('does not send an unchanged placement', async () => {
    repo.update.mockResolvedValue({ activity: museum, returnedToBank: false });
    setup('museum');
    type(field('שם האטרקציה'), 'מוזיאון הוותיקן');
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    await waitFor(() =>
      expect(repo.update).toHaveBeenCalledWith('museum', {
        name: 'מוזיאון הוותיקן',
        durationMinutes: 120,
        color: PALETTE[2],
      }),
    );
  });

  it('rolls back and shows a rejected placement in the dialog', async () => {
    repo.update.mockRejectedValue(new AppError('conflict_overlap'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { cached, onClose } = setup('market');
    fireEvent.change(day(), { target: { value: '2026-05-03' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('יש כבר אטרקציה אחרת בזמן הזה.');
    expect(cached('market')?.placement).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    // Reported in the dialog only, not also as a toast.
    expect(screen.getAllByText('יש כבר אטרקציה אחרת בזמן הזה.')).toHaveLength(1);
  });

  it('a new activity with a placement is created, then placed', async () => {
    const created = activity({ id: 'new', name: 'גלידה', bankPosition: 4, color: PALETTE[5] });
    repo.create.mockResolvedValue(created);
    repo.update.mockResolvedValue({
      activity: { ...created, placement: { date: '2026-05-03', startMinute: 600 } },
      returnedToBank: false,
    });
    const { onClose } = setup();
    type(field('שם האטרקציה'), 'גלידה');
    fireEvent.change(day(), { target: { value: '2026-05-03' } });
    // A full day: the first free slot from 09:00.
    expect(from()).toHaveValue('09:00');
    fireEvent.click(screen.getByRole('button', { name: 'הוספה למאגר' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(repo.create).toHaveBeenCalledWith('trip-1', { name: 'גלידה', durationMinutes: 60 });
    expect(repo.update).toHaveBeenCalledWith('new', {
      placement: { date: '2026-05-03', startMinute: 540 },
    });
  });

  it('a new activity whose placement fails stays in the bank, with a toast', async () => {
    repo.create.mockResolvedValue(activity({ id: 'new', name: 'גלידה', bankPosition: 4 }));
    repo.update.mockRejectedValue(new AppError('out_of_range'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { onClose } = setup();
    type(field('שם האטרקציה'), 'גלידה');
    fireEvent.change(day(), { target: { value: '2026-05-03' } });
    fireEvent.click(screen.getByRole('button', { name: 'הוספה למאגר' }));
    expect(
      await screen.findByText(
        'האטרקציה נוספה למאגר, אבל השיבוץ בלוח לא הצליח. הזמן הזה מחוץ לתאריכים ולשעות של הטיול.',
      ),
    ).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('tag field (FEAT-2)', () => {
  it('suggests the trip tags and fills the field from a suggestion', () => {
    setup('market');
    const input = field('תגית (לא חובה)');
    expect(input).toHaveValue('');
    const suggestions = screen.getByRole('group', { name: 'תגיות שכבר יש בטיול' });
    const chip = within(suggestions).getByRole('button', { name: 'מרכז העיר' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip);
    expect(input).toHaveValue('מרכז העיר');
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    // A toggle: pressing it again clears the tag.
    fireEvent.click(chip);
    expect(input).toHaveValue('');
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    // The native suggestion list too.
    expect(input).toHaveAttribute('list');
  });

  it('previews the group colour and locks the swatches when joining a group', () => {
    setup('market');
    type(field('תגית (לא חובה)'), '  מרכז   העיר ');
    // The oldest member (the museum) gives the colour: PALETTE[2] = butter.
    expect(field('תגית (לא חובה)')).toHaveAccessibleDescription(
      'התגית „מרכז העיר” כבר בשימוש, ולכן האטרקציה תקבל את צבע הקבוצה: צהוב חמאה.',
    );
    expect(screen.getByRole('radio', { name: 'צהוב חמאה' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'ורוד' })).toBeDisabled();
    expect(screen.getByText('הצבע נקבע לפי התגית. אחרי השמירה אפשר לשנות אותו.')).toBeVisible();
  });

  it('sends the normalized tag, and the server colour replaces the preview', async () => {
    repo.update.mockResolvedValue({
      activity: { ...market, tag: 'מרכז העיר', color: PALETTE[2] },
      returnedToBank: false,
    });
    const { cached } = setup('market');
    type(field('תגית (לא חובה)'), '  מרכז   העיר ');
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    await waitFor(() =>
      expect(repo.update).toHaveBeenCalledWith('market', {
        name: 'שוק',
        durationMinutes: 90,
        color: PALETTE[2],
        tag: 'מרכז העיר',
      }),
    );
    await waitFor(() => expect(cached('market')?.tag).toBe('מרכז העיר'));
    expect(cached('market')?.color).toBe(PALETTE[2]);
  });

  it('keeps the colour editable for an activity already in the group, and clears a tag', async () => {
    repo.update.mockResolvedValue({ activity: { ...cafe, tag: null }, returnedToBank: false });
    setup('cafe');
    expect(field('תגית (לא חובה)')).toHaveValue('מרכז העיר');
    expect(screen.getByRole('radio', { name: 'ורוד' })).toBeEnabled();
    type(field('תגית (לא חובה)'), '   ');
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    await waitFor(() =>
      expect(repo.update).toHaveBeenCalledWith('cafe', expect.objectContaining({ tag: null })),
    );
  });

  it('rejects a tag longer than 30 characters', () => {
    setup('market');
    const input = field('תגית (לא חובה)');
    type(input, 'א'.repeat(31));
    expect(input).toHaveAccessibleDescription(/התגית יכולה להכיל עד 30 תווים/);
    fireEvent.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(input).toHaveFocus();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('a new activity joining a group lets the DB pick the colour', async () => {
    repo.create.mockResolvedValue(activity({ id: 'new', tag: 'מרכז העיר', color: PALETTE[2] }));
    setup();
    type(field('שם האטרקציה'), 'גלידה');
    type(field('תגית (לא חובה)'), 'מרכז העיר');
    fireEvent.click(screen.getByRole('button', { name: 'הוספה למאגר' }));
    await waitFor(() =>
      expect(repo.create).toHaveBeenCalledWith('trip-1', {
        name: 'גלידה',
        durationMinutes: 60,
        tag: 'מרכז העיר',
      }),
    );
  });
});

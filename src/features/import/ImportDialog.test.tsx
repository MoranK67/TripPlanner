import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui';
import { AppError } from '@/data';
import {
  buildAiPrompt,
  PALETTE,
  type Activity,
  type ImportRowError,
  type Trip,
  type TripWithActivities,
} from '@/domain';
import { BankPanel } from '@/features/bank';
import { tripKeys, useTripQuery } from '@/features/trips';
import i18n from '@/i18n';
import { ImportDialog } from './ImportDialog';
import { IMPORT_REASON_KEYS } from './importReasons';

const repo = vi.hoisted(() => ({ importMany: vi.fn() }));
const trips = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return { ...actual, activitiesRepo: repo, tripsRepo: trips };
});

const trip: Trip = {
  id: 'trip-1',
  name: 'רומא',
  window: { startDate: '2026-05-01', startMinute: 600, endDate: '2026-05-03', endMinute: 1080 },
  colorCursor: 8,
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

function setup(ui: 'dialog' | 'bank' = 'dialog', activities: Activity[] = []) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  const data: TripWithActivities = { trip, activities };
  queryClient.setQueryData(tripKeys.detail(trip.id), data);
  trips.get.mockImplementation(async () => queryClient.getQueryData(tripKeys.detail(trip.id)));
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        {ui === 'dialog' ? (
          <ImportDialog open onClose={onClose} trip={trip} activities={activities} />
        ) : (
          <CachedBank />
        )}
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { queryClient, onClose };
}

function CachedBank() {
  const query = useTripQuery('trip-1');
  return query.data ? (
    <BankPanel trip={query.data.trip} activities={query.data.activities} />
  ) : null;
}

function paste(text: string) {
  fireEvent.change(screen.getByLabelText('הרשימה'), { target: { value: text } });
}

/** The computed `background-color` of a hex colour, as the preview's colour chips report it. */
function cssColor(hex: string): string {
  const probe = document.createElement('span');
  probe.style.backgroundColor = hex;
  return probe.style.backgroundColor;
}

function chipColor(item: HTMLElement | undefined): string {
  return (item?.querySelector('[aria-hidden="true"]') as HTMLElement).style.backgroundColor;
}

function lines(count: number): string {
  return Array.from({ length: count }, (_, i) => `אטרקציה ${i + 1}; 1`).join('\n');
}

beforeEach(() => {
  repo.importMany.mockReset();
  trips.get.mockReset();
});

describe('preview (FR-6.2–FR-6.4)', () => {
  it('starts empty, with the textarea focused and the import button disabled', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'ייבוא רשימת אטרקציות' })).toBeInTheDocument();
    expect(screen.getByLabelText('הרשימה')).toHaveFocus();
    expect(screen.getByText('אחרי ההדבקה יופיעו כאן האטרקציות שזוהו.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הוספה למאגר' })).toBeDisabled();
  });

  it('shows valid rows with color and duration and invalid rows with a Hebrew reason', async () => {
    setup();
    paste('מוזיאון הלובר; 3\nשייט\t1:20\nבלי זמן\n\nארוחת ערב; 1,5');
    const list = screen.getByRole('list', { name: 'תצוגה מקדימה של הייבוא' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('מוזיאון הלובר3 שעות');
    // 1:20 is rounded to the 30-minute grid and flagged.
    expect(items[1]).toHaveTextContent('שייטשעה וחצי (עוגל)');
    expect(items[2]).toHaveTextContent('שורה עם בעיה:בלי זמןחסר ; או טאב בין השם לזמן');
    expect(items[3]).toHaveTextContent('ארוחת ערבשעה וחצי');
    expect(screen.getByText('זוהו 3 אטרקציות · שורה אחת עם בעיה לא תיכנס')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הוספת 3 אטרקציות למאגר' })).toBeEnabled();

    // Preview colors follow the trip's color cursor (8, 9, then wrap to 0).
    const chips = [0, 1, 3].map(
      (i) => (items[i]?.querySelector('[aria-hidden="true"]') as HTMLElement).style.backgroundColor,
    );
    const expected = [PALETTE[8], PALETTE[9], PALETTE[0]].map((hex) => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = hex;
      return probe.style.backgroundColor;
    });
    expect(chips).toEqual(expected);

    // The counts reach screen readers through a polite live region once typing pauses.
    await waitFor(() =>
      expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent(
        'זוהו 3 אטרקציות · שורה אחת עם בעיה לא תיכנס',
      ),
    );
  });

  it('updates as the user types', () => {
    setup();
    paste('קפה; 1');
    expect(screen.getByText('זוהתה אטרקציה אחת')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הוספת אטרקציה אחת למאגר' })).toBeEnabled();
    paste('קפה; 1\nגלידה; חצי שעה');
    expect(screen.getByText('זוהו שתי אטרקציות')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הוספת שתי אטרקציות למאגר' })).toBeEnabled();
  });

  it('accepts the brace format', () => {
    setup();
    paste('{קפה;1},{גלידה;שעתיים}');
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['קפהשעה', 'גלידהשעתיים']);
  });

  it('disables the import when no row is valid, and says why', () => {
    setup();
    paste('שם; זמן\nסתם טקסט');
    expect(
      screen.getByText('לא זוהו אטרקציות תקינות · שתי שורות עם בעיה לא ייכנסו'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הוספה למאגר' })).toBeDisabled();
  });
});

describe('row errors (DEC-009, DEC-015)', () => {
  // A full Record: a new ImportRowError code fails the typecheck until it gets a sample here.
  const samples: Record<ImportRowError, { input: string; message: string }> = {
    missing_separator: { input: 'סתם טקסט', message: 'חסר ; או טאב בין השם לזמן' },
    missing_name: { input: '; 2', message: 'חסר שם' },
    name_too_long: { input: `${'א'.repeat(61)}; 2`, message: 'השם ארוך מ־60 תווים' },
    missing_duration: { input: 'קפה;', message: 'חסר זמן' },
    invalid_duration: { input: 'קפה; הרבה', message: 'לא הבנתי את הזמן' },
    duration_out_of_range: { input: 'קפה; 25', message: 'הזמן צריך להיות בין חצי שעה ל־24 שעות' },
    tag_too_long: { input: `קפה; 1; ${'א'.repeat(31)}`, message: 'התגית ארוכה מ־30 תווים' },
    tag_invalid: { input: 'קפה; 1; מרכז\u0007', message: 'בתגית יש תווים לא חוקיים' },
  };

  it('has a Hebrew message for every reason code', () => {
    for (const key of Object.values(IMPORT_REASON_KEYS)) {
      expect(i18n.exists(key), key).toBe(true);
    }
    expect(Object.keys(IMPORT_REASON_KEYS).sort()).toEqual(Object.keys(samples).sort());
  });

  it.each(Object.entries(samples))('shows %s in Hebrew', (_code, { input, message }) => {
    setup();
    paste(input);
    const item = within(screen.getByRole('list')).getByRole('listitem');
    expect(item).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'הוספה למאגר' })).toBeDisabled();
  });
});

describe('200-row limit (FR-6.5, DEC-015)', () => {
  it('allows exactly 200 valid rows', () => {
    setup();
    paste(lines(200));
    expect(screen.getByRole('button', { name: 'הוספת 200 אטרקציות למאגר' })).toBeEnabled();
  });

  it('blocks the whole import above 200 valid rows and explains why', () => {
    setup();
    paste(lines(201));
    const button = screen.getByRole('button', { name: 'הוספה למאגר' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      'ברשימה יש 201 אטרקציות, ואפשר לייבא עד 200 בכל פעם. כדאי לפצל את הרשימה לכמה חלקים ולייבא כל חלק בנפרד.',
    );
    fireEvent.submit(button.closest('form') as HTMLFormElement);
    expect(repo.importMany).not.toHaveBeenCalled();
  });

  it('counts only valid rows toward the limit', () => {
    setup();
    paste(`${lines(200)}\nשורה שבורה\nעוד אחת`);
    expect(screen.getByRole('button', { name: 'הוספת 200 אטרקציות למאגר' })).toBeEnabled();
  });
});

describe('import', () => {
  it('imports only the valid rows in one call, then toasts and closes', async () => {
    const created = [
      activity({ id: 'n1', name: 'קפה', color: PALETTE[8], bankPosition: 1 }),
      activity({
        id: 'n2',
        name: 'גלידה',
        durationMinutes: 30,
        color: PALETTE[9],
        bankPosition: 2,
      }),
    ];
    repo.importMany.mockResolvedValue(created);
    const { queryClient, onClose } = setup();
    paste('קפה; 1\nשבור\n"גלידה"\t40 דקות');
    fireEvent.click(screen.getByRole('button', { name: 'הוספת שתי אטרקציות למאגר' }));

    expect(await screen.findByText('נוספו שתי אטרקציות למאגר')).toBeInTheDocument();
    expect(repo.importMany).toHaveBeenCalledTimes(1);
    expect(repo.importMany).toHaveBeenCalledWith('trip-1', [
      { name: 'קפה', durationMinutes: 60 },
      { name: 'גלידה', durationMinutes: 30 },
    ]);
    expect(onClose).toHaveBeenCalled();
    const cached = queryClient.getQueryData<TripWithActivities>(tripKeys.detail('trip-1'));
    expect(cached?.activities.map((a) => a.id)).toEqual(['n1', 'n2']);
    expect(cached?.trip.colorCursor).toBe(0);
  });

  it('cannot be closed while saving', async () => {
    let resolve: (value: Activity[]) => void = () => {};
    repo.importMany.mockReturnValue(new Promise<Activity[]>((r) => (resolve = r)));
    const { onClose } = setup();
    paste('קפה; 1');
    fireEvent.click(screen.getByRole('button', { name: 'הוספת אטרקציה אחת למאגר' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'ביטול' })).toBeDisabled());
    expect(screen.queryByRole('button', { name: 'סגירה' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('הרשימה')).toHaveAttribute('readonly');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByTestId('modal-backdrop'));
    fireEvent.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).not.toHaveBeenCalled();

    resolve([activity({ id: 'n1' })]);
    expect(await screen.findByText('נוספה אטרקציה אחת למאגר')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a server error in Hebrew and keeps the dialog open with the text', async () => {
    repo.importMany.mockRejectedValue(new AppError('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { onClose } = setup();
    paste('קפה; 1');
    fireEvent.click(screen.getByRole('button', { name: 'הוספת אטרקציה אחת למאגר' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'הייבוא לא הצליח, ושום אטרקציה לא נוספה. אין חיבור לשרת. כדאי לבדוק את החיבור לאינטרנט ולנסות שוב.',
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('הרשימה')).toHaveValue('קפה; 1');
    expect(screen.getByRole('button', { name: 'הוספת אטרקציה אחת למאגר' })).toBeEnabled();
  });

  it('after a timeout says the import may have been saved, and refetches the bank (UX-3)', async () => {
    repo.importMany.mockRejectedValue(
      new AppError('network', { reason: 'timeout', retryable: true }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    paste('קפה; 1');
    fireEvent.click(screen.getByRole('button', { name: 'הוספת אטרקציה אחת למאגר' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('import.uncertain'));
    expect(screen.getByRole('alert')).not.toHaveTextContent('ושום אטרקציה לא נוספה');
    // Rows the server did commit show up in the bank behind the dialog.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: tripKeys.detail('trip-1') });
  });
});

describe('translations (M6.1 nits)', () => {
  // Current CLDR gives Hebrew one / two / other only, so `_many` keys were never used. A runtime
  // with older ICU data may still say "many" (e.g. for 20); i18next then falls back to `_other`.
  it('has no `_many` plural forms anywhere, and counts like 20 still read correctly', () => {
    const json = JSON.stringify(i18n.getResourceBundle('he', 'translation'));
    expect(json).not.toMatch(/[A-Za-z]_many"/);
    expect(i18n.t('import.submit', { count: 20 })).toBe('הוספת 20 אטרקציות למאגר');
    expect(i18n.t('trips.days', { count: 20 })).toBe('20 ימים');
  });

  it('joins the summary and the limit message through translations', async () => {
    setup();
    paste(`${lines(201)}\nשבור`);
    expect(screen.getByText('זוהו 201 אטרקציות · שורה אחת עם בעיה לא תיכנס')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent(
        'זוהו 201 אטרקציות · שורה אחת עם בעיה לא תיכנס. ברשימה יש 201 אטרקציות',
      ),
    );
  });
});

describe('from the bank panel', () => {
  it('opens from the bank and the new activities appear in the bank', async () => {
    repo.importMany.mockResolvedValue([
      activity({ id: 'n1', name: 'קפה', bankPosition: 2 }),
      activity({ id: 'n2', name: 'גלידה', bankPosition: 3 }),
    ]);
    setup('bank', [activity({ id: 'old', name: 'מוזיאון', bankPosition: 1 })]);
    fireEvent.click(screen.getByRole('button', { name: 'ייבוא רשימה' }));
    expect(screen.getByRole('dialog', { name: 'ייבוא רשימת אטרקציות' })).toBeInTheDocument();
    paste('קפה; 1\nגלידה; 1');
    fireEvent.click(screen.getByRole('button', { name: 'הוספת שתי אטרקציות למאגר' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const items = within(screen.getByRole('list', { name: 'אטרקציות במאגר' })).getAllByRole(
      'listitem',
    );
    expect(items.map((li) => li.textContent)).toEqual(['מוזיאון שעה×', 'קפה שעה×', 'גלידה שעה×']);
    expect(screen.getByRole('heading', { name: 'מאגר אטרקציות (3)' })).toBeInTheDocument();
  });
});

describe('tags (FEAT-2)', () => {
  it('shows a tag column and gives same-tag rows the group colour', () => {
    setup('dialog', [
      activity({ id: 'old', tag: 'נמל', color: PALETTE[4], createdAt: '2026-01-01T00:00:00Z' }),
    ]);
    paste('מוזיאון; 3; מרכז העיר\nשייט; 1; נמל\nקפה; 1; מרכז העיר\nגלידה; 1');
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('מוזיאוןתגית: מרכז העיר3 שעות');
    expect(items[3]).toHaveTextContent('גלידהשעה');
    expect(items.map(chipColor)).toEqual(
      // Cursor 8: a new group takes the next colour; "נמל" joins the trip's group (no cursor move).
      [PALETTE[8], PALETTE[4], PALETTE[8], PALETTE[9]].map(cssColor),
    );
  });

  it('sends the tags with the rows', async () => {
    repo.importMany.mockResolvedValue([activity({ id: 'n1', tag: 'מרכז העיר' })]);
    setup();
    paste('מוזיאון; 3; מרכז העיר\nקפה; 1');
    fireEvent.click(screen.getByRole('button', { name: 'הוספת שתי אטרקציות למאגר' }));
    await waitFor(() =>
      expect(repo.importMany).toHaveBeenCalledWith('trip-1', [
        { name: 'מוזיאון', durationMinutes: 180, tag: 'מרכז העיר' },
        { name: 'קפה', durationMinutes: 60 },
      ]),
    );
  });
});

describe('AI prompt (FEAT-2)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockClipboard(writeText: (text: string) => Promise<void>) {
    const spy = vi.fn(writeText);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: spy },
    });
    return spy;
  }

  it('copies the prompt for the trip and confirms with a toast', async () => {
    const writeText = mockClipboard(() => Promise.resolve());
    setup();
    expect(
      screen.getByText('מדביקים ב-ChatGPT או ב-Claude, ואת התשובה מדביקים כאן'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'העתקת הודעה ל-AI' }));
    expect(
      await screen.findByText('ההודעה הועתקה. עכשיו מדביקים אותה ב-ChatGPT או ב-Claude.'),
    ).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(buildAiPrompt(trip));
    expect(screen.queryByLabelText('ההודעה ל-AI')).not.toBeInTheDocument();
  });

  it('falls back to a selected read-only box when copying fails', async () => {
    mockClipboard(() => Promise.reject(new Error('denied')));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'העתקת הודעה ל-AI' }));
    const box = await screen.findByLabelText('ההודעה ל-AI');
    expect(box).toHaveValue(buildAiPrompt(trip));
    expect(box).toHaveAttribute('readonly');
    await waitFor(() => expect(box).toHaveFocus());
    const input = box as HTMLTextAreaElement;
    expect(input.selectionEnd - input.selectionStart).toBe(input.value.length);
    expect(box).toHaveAccessibleDescription(/לא הצלחנו להעתיק אוטומטית/);
  });
});

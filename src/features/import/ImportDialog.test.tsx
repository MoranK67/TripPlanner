import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui';
import { AppError, type ImportedActivity } from '@/data';
import {
  buildAiPrompt,
  PALETTE,
  type Activity,
  type ImportRowError,
  type Trip,
  type TripWithActivities,
} from '@/domain';
import { BankPanel } from '@/features/bank';
import { placementQueueScope } from '@/features/schedule';
import { tripKeys, useTripQuery } from '@/features/trips';
import i18n from '@/i18n';
import { ImportDialog } from './ImportDialog';
import { IMPORT_REASON_KEYS } from './importReasons';
import { IMPORT_TYPE_STORAGE_KEY } from './useImportType';

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

/** `importMany` outcomes for activities that went to the bank (no placement requested). */
function banked(activities: Activity[]): ImportedActivity[] {
  return activities.map((a) => ({
    activity: a,
    placed: false,
    bankReason: null,
    conflictActivityId: null,
    conflictItem: null,
  }));
}

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
  // The import type is remembered per device (FEAT-3): every test starts from the default.
  localStorage.clear();
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
    repo.importMany.mockResolvedValue(banked(created));
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
    let resolve: (value: ImportedActivity[]) => void = () => {};
    repo.importMany.mockReturnValue(new Promise<ImportedActivity[]>((r) => (resolve = r)));
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

    resolve(banked([activity({ id: 'n1' })]));
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
    repo.importMany.mockResolvedValue(
      banked([
        activity({ id: 'n1', name: 'קפה', bankPosition: 2 }),
        activity({ id: 'n2', name: 'גלידה', bankPosition: 3 }),
      ]),
    );
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
    repo.importMany.mockResolvedValue(banked([activity({ id: 'n1', tag: 'מרכז העיר' })]));
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

describe('import types (FEAT-3)', () => {
  const radio = (name: string) => screen.getByRole('radio', { name });

  it('offers three types in a labelled radio group, "+ תגיות" by default', () => {
    setup();
    const group = screen.getByRole('radiogroup', { name: 'מה מייבאים?' });
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    expect(radio('אטרקציות ומשך')).toHaveAccessibleDescription(
      'שם וזמן לכל אטרקציה. הכול נכנס למאגר.',
    );
    expect(radio('+ תגיות')).toBeChecked();
    expect(radio('+ שיבוץ בלוח')).not.toBeChecked();
    expect(screen.getByLabelText('הרשימה')).toHaveAttribute(
      'placeholder',
      i18n.t('import.placeholder.tags'),
    );
  });

  it('remembers the choice on this device, and the hint and placeholder follow it', () => {
    setup();
    fireEvent.click(radio('+ שיבוץ בלוח'));
    expect(localStorage.getItem(IMPORT_TYPE_STORAGE_KEY)).toBe('placement');
    const box = screen.getByLabelText('הרשימה');
    expect(box).toHaveAttribute('placeholder', i18n.t('import.placeholder.placement'));
    expect(box).toHaveAccessibleDescription(/שם; זמן; תגית; יום; שעת התחלה/);

    fireEvent.click(radio('אטרקציות ומשך'));
    expect(box).toHaveAttribute('placeholder', i18n.t('import.placeholder.basic'));
    expect(box).toHaveAccessibleDescription(/בפורמט שם; זמן\./);
    expect(localStorage.getItem(IMPORT_TYPE_STORAGE_KEY)).toBe('basic');
  });

  it('opens with the stored type', () => {
    localStorage.setItem(IMPORT_TYPE_STORAGE_KEY, 'placement');
    setup();
    expect(radio('+ שיבוץ בלוח')).toBeChecked();
  });

  it.each([
    ['אטרקציות ומשך', 'basic'],
    ['+ תגיות', 'tags'],
    ['+ שיבוץ בלוח', 'placement'],
  ] as const)('copies the AI prompt of the "%s" type', async (label, type) => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    setup();
    fireEvent.click(radio(label));
    fireEvent.click(screen.getByRole('button', { name: 'העתקת הודעה ל-AI' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(buildAiPrompt(trip, type)));
  });
});

describe('placement preview (FEAT-3)', () => {
  // Trip: 1.5 10:00 – 3.5 18:00. "מוזיאון" sits on day 2, 14:00–15:00.
  const museum = activity({
    id: 'old',
    name: 'מוזיאון',
    placement: { date: '2026-05-02', startMinute: 840 },
  });
  const text = [
    'קולוסיאום; 3; רומא העתיקה; 1; 10:00',
    'פורום; 2; רומא העתיקה; 1; 12:00',
    'שבור',
    'ארוחת בוקר; 1; ; 1; 09:00',
    'וותיקן; 4; ; 5; 10:00',
    'גלידה; 1; ; 2',
    'שוק; 1; ; 2; 25:00',
    'פיצה; 1; אוכל; 2; 12:10',
    'טרסטוורה; 1',
    'קפה; 1; ; 2; 14:30',
  ].join('\n');

  function choosePlacement() {
    fireEvent.click(screen.getByRole('radio', { name: '+ שיבוץ בלוח' }));
  }

  function placedOutcome(a: Activity): ImportedActivity {
    return {
      activity: a,
      placed: true,
      bankReason: null,
      conflictActivityId: null,
      conflictItem: null,
    };
  }

  it('shows where every row goes, with the reason for the bank, and a summary', () => {
    setup('dialog', [museum]);
    choosePlacement();
    paste(text);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    const destination = (i: number) => items[i]?.lastElementChild?.textContent;
    expect(destination(0)).toBe('יום 1 · 10:00–13:00');
    expect(destination(1)).toBe('למאגר — חופף לשורה 1');
    expect(items[2]).toHaveTextContent('שורה עם בעיה:');
    expect(destination(3)).toBe('למאגר — מחוץ לשעות הטיול');
    expect(destination(4)).toBe('למאגר — היום לא קיים בטיול');
    expect(destination(5)).toBe('למאגר — חסר יום או שעה');
    expect(destination(6)).toBe('למאגר — יום או שעה לא תקינים');
    expect(destination(7)).toBe('יום 2 · 12:00–13:00 (השעה עוגלה)');
    expect(destination(8)).toBe('למאגר');
    expect(destination(9)).toBe('למאגר — חופף ל-מוזיאון');
    expect(items[7]).toHaveTextContent('פיצהתגית: אוכלשעה');
    expect(screen.getByText('שתיים ישובצו, 7 למאגר')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הוספת 9 אטרקציות' })).toBeEnabled();
  });

  it('ignores placement fields for the other types', async () => {
    repo.importMany.mockResolvedValue(banked([activity({ id: 'n1' })]));
    setup('dialog', [museum]);
    paste('קולוסיאום; 3; רומא העתיקה; 1; 10:00');
    expect(screen.queryByText(/יום 1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/תשובץ/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'הוספת אטרקציה אחת למאגר' }));
    await waitFor(() =>
      expect(repo.importMany).toHaveBeenCalledWith('trip-1', [
        { name: 'קולוסיאום', durationMinutes: 180, tag: 'רומא העתיקה' },
      ]),
    );
  });

  it('sends placements as dates, puts placed rows in the timetable cache and toasts the outcome', async () => {
    repo.importMany.mockResolvedValue([
      placedOutcome(
        activity({
          id: 'n1',
          name: 'קולוסיאום',
          durationMinutes: 180,
          placement: { date: '2026-05-01', startMinute: 600 },
        }),
      ),
      {
        activity: activity({ id: 'n2', name: 'פורום', bankPosition: 2 }),
        placed: false,
        bankReason: 'overlaps_import_row',
        conflictActivityId: 'n1',
        conflictItem: 1,
      },
      ...banked([activity({ id: 'n3', name: 'טרסטוורה', bankPosition: 3 })]),
    ]);
    const { queryClient, onClose } = setup('dialog', [museum]);
    choosePlacement();
    paste('קולוסיאום; 3; ; 1; 10:00\nפורום; 2; ; 1; 12:00\nטרסטוורה; 1');
    fireEvent.click(screen.getByRole('button', { name: 'הוספת 3 אטרקציות' }));

    expect(await screen.findByText('נוספו 3: אחת שובצה, שתיים במאגר')).toBeInTheDocument();
    expect(repo.importMany).toHaveBeenCalledWith('trip-1', [
      {
        name: 'קולוסיאום',
        durationMinutes: 180,
        placement: { date: '2026-05-01', startMinute: 600 },
      },
      { name: 'פורום', durationMinutes: 120, placement: { date: '2026-05-01', startMinute: 720 } },
      { name: 'טרסטוורה', durationMinutes: 60 },
    ]);
    expect(onClose).toHaveBeenCalled();
    const cached = queryClient.getQueryData<TripWithActivities>(tripKeys.detail('trip-1'));
    expect(cached?.activities.find((a) => a.id === 'n1')?.placement).toEqual({
      date: '2026-05-01',
      startMinute: 600,
    });
    expect(cached?.activities.map((a) => a.id)).toEqual(['old', 'n1', 'n2', 'n3']);
  });

  it('says so when every row was placed', async () => {
    repo.importMany.mockResolvedValue([
      placedOutcome(activity({ id: 'n1', placement: { date: '2026-05-01', startMinute: 600 } })),
    ]);
    setup();
    choosePlacement();
    paste('קפה; 1; ; 1; 10:00');
    fireEvent.click(screen.getByRole('button', { name: 'הוספת אטרקציה אחת' }));
    expect(await screen.findByText('נוספה אטרקציה אחת ושובצה בלוח')).toBeInTheDocument();
  });

  it('follows the server when it banks a row the preview placed (the timetable changed)', async () => {
    repo.importMany.mockResolvedValue([
      placedOutcome(activity({ id: 'n1', placement: { date: '2026-05-01', startMinute: 600 } })),
      {
        activity: activity({ id: 'n2', name: 'גלידה' }),
        placed: false,
        bankReason: 'overlaps_import_row',
        conflictActivityId: 'n1',
        conflictItem: 1,
      },
    ]);
    setup();
    choosePlacement();
    // Row 1 is invalid, so the server's item 1 is preview row 2.
    paste('שבור\nקפה; 1; ; 1; 10:00\nגלידה; 1; ; 1; 11:00');
    expect(screen.getByText('שתיים ישובצו', { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'הוספת שתי אטרקציות' }));
    expect(
      await screen.findByText('נוספו 2: אחת שובצה, אחת במאגר. „גלידה” לא שובצה: חופף לשורה 2'),
    ).toBeInTheDocument();
  });

  it('waits for the placement writes already queued for the trip (DEC-031)', async () => {
    repo.importMany.mockResolvedValue(banked([activity({ id: 'n1' })]));
    const { queryClient } = setup();
    let finishDrop: () => void = () => {};
    const drop = queryClient
      .getMutationCache()
      .build(queryClient, {
        scope: placementQueueScope('trip-1'),
        mutationFn: () => new Promise<void>((resolve) => (finishDrop = resolve)),
      })
      .execute(undefined);
    paste('קפה; 1');
    fireEvent.click(screen.getByRole('button', { name: 'הוספת אטרקציה אחת למאגר' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'ביטול' })).toBeDisabled());
    expect(repo.importMany).not.toHaveBeenCalled();

    finishDrop();
    await drop;
    expect(await screen.findByText('נוספה אטרקציה אחת למאגר')).toBeInTheDocument();
    expect(repo.importMany).toHaveBeenCalledTimes(1);
  });
});

describe('review follow-ups (FEAT-3)', () => {
  it('leaves a zero count out of the placement summary', () => {
    setup();
    fireEvent.click(screen.getByRole('radio', { name: '+ שיבוץ בלוח' }));
    paste('קפה; 1');
    expect(screen.getByText('אחת למאגר', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(/תשובץ|ישובצו/)).not.toBeInTheDocument();
  });

  it('does not duplicate rows a refetch already brought in, nor move the cursor again', async () => {
    const created = [
      activity({ id: 'n1', name: 'קפה', bankPosition: 1 }),
      activity({ id: 'n2', name: 'גלידה', bankPosition: 2 }),
    ];
    const ref: { client?: QueryClient } = {};
    repo.importMany.mockImplementation(async () => {
      // A refetch finished first: the cache already holds the rows and the server's cursor.
      ref.client?.setQueryData<TripWithActivities>(tripKeys.detail('trip-1'), {
        trip: { ...trip, colorCursor: 3 },
        activities: created,
      });
      return banked(created);
    });
    const { queryClient } = setup();
    ref.client = queryClient;
    paste('קפה; 1\nגלידה; 1');
    fireEvent.click(screen.getByRole('button', { name: 'הוספת שתי אטרקציות למאגר' }));
    expect(await screen.findByText('נוספו שתי אטרקציות למאגר')).toBeInTheDocument();
    const cached = queryClient.getQueryData<TripWithActivities>(tripKeys.detail('trip-1'));
    expect(cached?.activities.map((a) => a.id)).toEqual(['n1', 'n2']);
    expect(cached?.trip.colorCursor).toBe(3);
  });

  it('names an unexpected overlap from the trip cache when the dialog did not know it', async () => {
    const intruder = activity({
      id: 'other',
      name: 'מכשול',
      placement: { date: '2026-05-01', startMinute: 660 },
    });
    const ref: { client?: QueryClient } = {};
    repo.importMany.mockImplementation(async () => {
      // Another device placed it meanwhile; a refetch brought it into the cache.
      ref.client?.setQueryData<TripWithActivities>(tripKeys.detail('trip-1'), {
        trip,
        activities: [intruder],
      });
      return [
        {
          activity: activity({ id: 'n1', name: 'קולוסיאום' }),
          placed: false,
          bankReason: 'overlaps_existing',
          conflictActivityId: 'other',
          conflictItem: null,
        },
      ] satisfies ImportedActivity[];
    });
    const { queryClient } = setup();
    ref.client = queryClient;
    fireEvent.click(screen.getByRole('radio', { name: '+ שיבוץ בלוח' }));
    paste('קולוסיאום; 3; ; 1; 10:00');
    fireEvent.click(screen.getByRole('button', { name: 'הוספת אטרקציה אחת' }));
    expect(
      await screen.findByText('נוספה אטרקציה אחת למאגר. „קולוסיאום” לא שובצה: חופף ל-מכשול'),
    ).toBeInTheDocument();
  });
});

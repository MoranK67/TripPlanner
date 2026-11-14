import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui';
import { AppError, type ImportTripsCounts } from '@/data';
import { serializeBackup, type BackupTrip } from '@/domain';
import { tripKeys } from '@/features/trips';
import i18n from '@/i18n';
import {
  BACKUP_FORMAT_KEYS,
  BACKUP_PARSE_ERROR_KEYS,
  BACKUP_WARNING_KEYS,
  IMPORT_ACTIVITY_REASON_KEYS,
  IMPORT_GENERAL_REASON_KEYS,
  IMPORT_TRIP_REASON_KEYS,
} from './backupMessages';
import { BackupImportDialog, MAX_BACKUP_FILE_BYTES } from './BackupImportDialog';
import { prototypeBackup, storedTrips } from './testData';

const repo = vi.hoisted(() => ({ exportAll: vi.fn(), importAll: vi.fn() }));

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return { ...actual, backupRepo: repo };
});

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(tripKeys.list(), []);
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BackupImportDialog open onClose={onClose} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { queryClient, onClose };
}

function fileInput(): HTMLInputElement {
  return screen.getByLabelText('קובץ הגיבוי');
}

function pick(content: string | File, name = 'backup.json') {
  const file = typeof content === 'string' ? new File([content], name) : content;
  fireEvent.change(fileInput(), { target: { files: [file] } });
}

async function pickPrototype() {
  pick(JSON.stringify(prototypeBackup), 'trip-planner-backup-2026-11-10.json');
  await screen.findByRole('list', { name: 'הטיולים בקובץ' });
}

const importButton = (name = 'הוספת טיול אחד') => screen.getByRole('button', { name });

beforeEach(() => {
  repo.importAll.mockReset();
});

describe('picking a file', () => {
  it('starts with a keyboard-reachable pick button and a disabled import', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'שחזור טיולים מקובץ גיבוי' })).toBeInTheDocument();
    const pickButton = screen.getByRole('button', { name: 'בחירת קובץ…' });
    expect(pickButton).toHaveFocus();
    expect(fileInput()).toHaveAttribute('accept', '.json,application/json');
    const click = vi.spyOn(fileInput(), 'click').mockImplementation(() => {});
    fireEvent.click(pickButton);
    expect(click).toHaveBeenCalled();
    expect(importButton('הוספת הטיולים')).toBeDisabled();
  });
});

describe('preview (FR-8.1, FR-8.2)', () => {
  it('summarises a prototype backup with its warnings', async () => {
    setup();
    await pickPrototype();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('בקובץ: טיול אחד · 4 אטרקציות')).toBeInTheDocument();
    expect(
      within(dialog).getByText(/סוג הקובץ: גיבוי מהגרסה הקודמת \(אב־הטיפוס\)/),
    ).toHaveTextContent(/נוצר ב־.*2026/);
    expect(
      within(dialog).getByText('הקובץ שנבחר: trip-planner-backup-2026-11-10.json'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'בחירת קובץ אחר…' })).toBeInTheDocument();

    const trips = within(screen.getByRole('list', { name: 'הטיולים בקובץ' })).getAllByRole(
      'listitem',
    );
    expect(trips).toHaveLength(1);
    expect(trips[0]).toHaveTextContent('רומא');
    expect(trips[0]).toHaveTextContent('1 במאי 2026 10:00 עד 3 במאי 2026 18:00 · 3 ימים');
    expect(trips[0]).toHaveTextContent('4 אטרקציות (1 בלוח · 3 במאגר)');

    const warnings = within(screen.getByRole('list', { name: '4 הערות על הקובץ:' })).getAllByRole(
      'listitem',
    );
    expect(warnings.map((li) => li.textContent)).toEqual([
      'אטרקציה "חופף" בטיול "רומא": היא חופפת לאטרקציה אחרת בלוח, ולכן היא תיכנס למאגר',
      'אטרקציה מספר 4 בטיול "רומא": שם האטרקציה חסר או ארוך מ־60 תווים, והיא לא תשוחזר',
      'אטרקציה "צבע" בטיול "רומא": הצבע לא תקין, והוחלף בצבע אחר',
      'טיול מספר 2: שם הטיול חסר או ארוך מ־50 תווים, והטיול לא ישוחזר',
    ]);

    expect(within(dialog).getByText(/ייצור טיולים כפולים/)).toHaveTextContent(
      'השחזור מוסיף את הטיולים שבקובץ לטיולים שכבר יש לך',
    );
    expect(importButton()).toBeEnabled();
  });

  it('summarises an app backup without warnings', async () => {
    setup();
    pick(serializeBackup(storedTrips, new Date('2026-11-14T10:00:00Z')));
    const list = await screen.findByRole('list', { name: 'הטיולים בקובץ' });
    expect(screen.getByText('בקובץ: שני טיולים · שתי אטרקציות')).toBeInTheDocument();
    expect(screen.getByText(/סוג הקובץ: גיבוי של האפליקציה/)).toBeInTheDocument();
    const trips = within(list).getAllByRole('listitem');
    expect(trips.map((li) => li.firstChild?.textContent)).toEqual(['פריז', 'לונדון']);
    expect(trips[0]).toHaveTextContent('שתי אטרקציות (1 בלוח · 1 במאגר)');
    expect(trips[1]).toHaveTextContent('בלי אטרקציות');
    expect(trips[1]).toHaveTextContent('יום אחד');
    expect(screen.queryByText(/הערות על הקובץ/)).not.toBeInTheDocument();
    expect(importButton('הוספת שני טיולים')).toBeEnabled();
  });

  it('replaces the preview when another file is picked', async () => {
    setup();
    await pickPrototype();
    pick('{"format": "something-else"}', 'other.json');
    expect(await screen.findByText(/זה לא קובץ גיבוי של מתכנן הטיולים/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'הטיולים בקובץ' })).not.toBeInTheDocument();
    expect(importButton('הוספת הטיולים')).toBeDisabled();
  });
});

describe('rejected files', () => {
  it.each([
    ['not json at all', 'זה לא קובץ גיבוי: התוכן שלו לא בפורמט JSON תקין.'],
    ['{"format":"trip-planner-backup","version":2,"trips":[]}', 'קובץ הגיבוי נוצר בגרסה חדשה יותר'],
    ['{"format":"trip-planner-backup","version":1,"trips":[]}', 'אין טיולים בקובץ הגיבוי.'],
  ])('rejects %s with a Hebrew message', async (content, message) => {
    setup();
    pick(content);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(importButton('הוספת הטיולים')).toBeDisabled();
  });

  it('lists why every trip was skipped when none is valid', async () => {
    setup();
    pick(JSON.stringify({ ...prototypeBackup, trips: [prototypeBackup.trips[1], 'x'] }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'אף טיול בקובץ לא תקין, ולכן אין מה לשחזר.',
    );
    const warnings = within(screen.getByRole('list', { name: 'שתי הערות על הקובץ:' })).getAllByRole(
      'listitem',
    );
    expect(warnings.map((li) => li.textContent)).toEqual([
      'טיול מספר 1: שם הטיול חסר או ארוך מ־50 תווים, והטיול לא ישוחזר',
      'טיול מספר 2: הטיול פגום ולא ישוחזר',
    ]);
  });

  it('rejects a file that is too large without reading it', async () => {
    setup();
    const file = new File(['{}'], 'huge.json');
    Object.defineProperty(file, 'size', { value: MAX_BACKUP_FILE_BYTES + 1 });
    const text = vi.spyOn(file, 'text');
    pick(file);
    expect(await screen.findByRole('alert')).toHaveTextContent('הקובץ גדול מדי בשביל קובץ גיבוי.');
    expect(text).not.toHaveBeenCalled();
  });

  it('rejects text longer than the backup limit', async () => {
    setup();
    pick(' '.repeat(5_000_001));
    expect(await screen.findByRole('alert')).toHaveTextContent('הקובץ גדול מדי בשביל קובץ גיבוי.');
  });

  it('says so when the file cannot be read', async () => {
    setup();
    const file = new File(['{}'], 'broken.json');
    vi.spyOn(file, 'text').mockRejectedValue(new Error('NotReadableError'));
    pick(file);
    expect(await screen.findByRole('alert')).toHaveTextContent('לא הצלחתי לקרוא את הקובץ.');
  });
});

describe('Hebrew messages for every code', () => {
  it.each([
    ['formats', BACKUP_FORMAT_KEYS],
    ['parse errors', BACKUP_PARSE_ERROR_KEYS],
    ['warnings', BACKUP_WARNING_KEYS],
    ['general import reasons', IMPORT_GENERAL_REASON_KEYS],
    ['trip import reasons', IMPORT_TRIP_REASON_KEYS],
    ['activity import reasons', IMPORT_ACTIVITY_REASON_KEYS],
  ])('%s', (_name, keys: Readonly<Record<string, string>>) => {
    for (const key of Object.values(keys)) expect(i18n.exists(key), key).toBe(true);
  });
});

describe('import (DEC-033)', () => {
  it('imports the parsed trips in one call, toasts, refreshes the trips list and closes', async () => {
    repo.importAll.mockResolvedValue({ trips: 1, activities: 4 } satisfies ImportTripsCounts);
    const { queryClient, onClose } = setup();
    await pickPrototype();
    fireEvent.click(importButton());

    expect(await screen.findByText('הגיבוי שוחזר: נוספו טיול אחד, 4 אטרקציות')).toBeInTheDocument();
    expect(repo.importAll).toHaveBeenCalledTimes(1);
    const [trips] = repo.importAll.mock.calls[0] as [BackupTrip[]];
    expect(trips).toHaveLength(1);
    expect(trips[0]?.name).toBe('רומא');
    expect(trips[0]?.activities.map((a) => [a.name, a.placement])).toEqual([
      ['קולוסיאום', { date: '2026-05-01', startMinute: 600 }],
      ['פנתאון', null],
      ['חופף', null],
      ['צבע', null],
    ]);
    expect(onClose).toHaveBeenCalled();
    expect(queryClient.getQueryState(tripKeys.list())?.isInvalidated).toBe(true);
  });

  it('cannot be closed while importing', async () => {
    let resolve: (value: ImportTripsCounts) => void = () => {};
    repo.importAll.mockReturnValue(new Promise<ImportTripsCounts>((r) => (resolve = r)));
    const { onClose } = setup();
    await pickPrototype();
    fireEvent.click(importButton());

    await waitFor(() => expect(screen.getByRole('button', { name: 'ביטול' })).toBeDisabled());
    expect(screen.queryByRole('button', { name: 'סגירה' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'בחירת קובץ אחר…' })).toBeDisabled();
    expect(fileInput()).toBeDisabled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByTestId('modal-backdrop'));
    fireEvent.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(importButton());
    expect(repo.importAll).toHaveBeenCalledTimes(1);

    resolve({ trips: 1, activities: 4 });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('names the failing activity of a server error and keeps the preview', async () => {
    repo.importAll.mockRejectedValue(
      new AppError('conflict_overlap', {
        reason: 'overlap',
        location: { tripIndex: 0, activityIndex: 1 },
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { onClose } = setup();
    await pickPrototype();
    fireEvent.click(importButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'השחזור לא הצליח, ושום טיול לא נוסף. אטרקציה "פנתאון" בטיול "רומא": האטרקציה חופפת לאטרקציה אחרת בלוח',
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('list', { name: 'הטיולים בקובץ' })).toBeInTheDocument();
    expect(importButton()).toBeEnabled();
  });

  it.each([
    [
      new AppError('validation', {
        reason: 'too_long',
        location: { tripIndex: 0, activityIndex: null },
      }),
      'השחזור לא הצליח, ושום טיול לא נוסף. טיול "רומא": הטיול ארוך מ־90 ימים',
    ],
    [
      new AppError('validation', { reason: 'too_many_activities' }),
      'השחזור לא הצליח, ושום טיול לא נוסף. אפשר לשחזר עד 2000 אטרקציות בכל פעם.',
    ],
    [
      new AppError('validation', {
        reason: 'mystery',
        location: { tripIndex: 7, activityIndex: 2 },
      }),
      'השחזור לא הצליח, ושום טיול לא נוסף. אטרקציה מספר 3 בטיול מספר 8: חלק מהפרטים לא תקינים.',
    ],
    [
      new AppError('auth_expired'),
      'השחזור לא הצליח, ושום טיול לא נוסף. ההתחברות פגה. צריך להתחבר מחדש.',
    ],
  ])('explains %s in Hebrew', async (error, message) => {
    repo.importAll.mockRejectedValue(error);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setup();
    await pickPrototype();
    fireEvent.click(importButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('after a timeout, says the trips may have been saved and refreshes the list', async () => {
    repo.importAll.mockRejectedValue(
      new AppError('network', { reason: 'timeout', retryable: false }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { queryClient } = setup();
    await pickPrototype();
    fireEvent.click(importButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('לא ברור אם השחזור הסתיים: השרת לא ענה בזמן.');
    expect(alert).toHaveTextContent('ייתכן שהטיולים בכל זאת נשמרו');
    expect(alert).toHaveTextContent('כדאי לסגור את החלון ולבדוק ברשימת הטיולים');
    expect(alert).not.toHaveTextContent('שום טיול לא נוסף');
    expect(repo.importAll).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryState(tripKeys.list())?.isInvalidated).toBe(true);
  });
});

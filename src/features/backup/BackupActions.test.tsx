import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ui';
import { AppError } from '@/data';
import { parseBackup } from '@/domain';
import { tripKeys } from '@/features/trips';
import { BackupActions } from './BackupActions';
import { storedTrips } from './testData';

const repo = vi.hoisted(() => ({ exportAll: vi.fn(), importAll: vi.fn() }));
const saveFile = vi.hoisted(() => vi.fn());

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return { ...actual, backupRepo: repo };
});

vi.mock('@/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform')>();
  return { ...actual, platform: { ...actual.platform, saveFile } };
});

/** `hasTrips` seeds the shared trips list query the export button reads. */
function setup(hasTrips = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  queryClient.setQueryData(
    tripKeys.list(),
    hasTrips
      ? [{ id: 'trip-a', name: 'פריז', window: storedTrips[0]!.trip.window, dayCount: 2 }]
      : [],
  );
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BackupActions />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const exportButton = () => screen.getByRole('button', { name: 'שמירת גיבוי' });

function setUserActivation(value: { isActive: boolean } | undefined) {
  Object.defineProperty(navigator, 'userActivation', { value, configurable: true });
}

beforeEach(() => {
  repo.exportAll.mockReset();
  saveFile.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 14, 12, 0));
});

afterEach(() => {
  vi.useRealTimers();
  setUserActivation(undefined);
});

describe('export (FR-8.2)', () => {
  it('saves all trips as one JSON backup file and toasts', async () => {
    repo.exportAll.mockResolvedValue(storedTrips);
    saveFile.mockResolvedValue('saved');
    setup();
    fireEvent.click(exportButton());

    expect(await screen.findByText('קובץ הגיבוי נשמר (שני טיולים)')).toBeInTheDocument();
    expect(repo.exportAll).toHaveBeenCalledTimes(1);
    expect(saveFile).toHaveBeenCalledTimes(1);
    const [blob, name, mime] = saveFile.mock.calls[0] as [Blob, string, string];
    expect(name).toBe('trip-planner-backup-2026-11-14.json');
    expect(mime).toBe('application/json');
    expect(blob.type).toBe('application/json');
    // The file reads back as an app backup with both trips.
    const parsed = parseBackup(await blob.text());
    expect(parsed.ok && parsed.format).toBe('app');
    expect(parsed.ok && parsed.trips.map((trip) => trip.name)).toEqual(['פריז', 'לונדון']);
    expect(parsed.ok && parsed.activityCount).toBe(2);
    expect(exportButton()).toBeEnabled();
  });

  it('says "shared" after the share sheet', async () => {
    repo.exportAll.mockResolvedValue(storedTrips.slice(0, 1));
    saveFile.mockResolvedValue('shared');
    setup();
    fireEvent.click(exportButton());
    expect(await screen.findByText('קובץ הגיבוי שותף (טיול אחד)')).toBeInTheDocument();
  });

  it('shows no toast when the user cancels the share sheet', async () => {
    repo.exportAll.mockResolvedValue(storedTrips);
    saveFile.mockResolvedValue('cancelled');
    setup();
    fireEvent.click(exportButton());
    await waitFor(() => expect(saveFile).toHaveBeenCalled());
    await waitFor(() => expect(exportButton()).toBeEnabled());
    expect(screen.queryByText(/קובץ הגיבוי/)).not.toBeInTheDocument();
  });

  it('shows a loading state and ignores a second tap while building', async () => {
    let resolve: (value: typeof storedTrips) => void = () => {};
    repo.exportAll.mockReturnValue(new Promise((r) => (resolve = r)));
    saveFile.mockResolvedValue('saved');
    setup();
    fireEvent.click(exportButton());
    await waitFor(() => expect(exportButton()).toBeDisabled());
    expect(exportButton()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('מכין את קובץ הגיבוי…')).toHaveAttribute('role', 'status');
    fireEvent.click(exportButton());
    resolve(storedTrips);
    await screen.findByText('קובץ הגיבוי נשמר (שני טיולים)');
    expect(repo.exportAll).toHaveBeenCalledTimes(1);
  });

  it('shows a Hebrew error toast when the trips cannot be read', async () => {
    repo.exportAll.mockRejectedValue(new AppError('network', { retryable: true }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setup();
    fireEvent.click(exportButton());
    expect(
      await screen.findByText(
        'שמירת הגיבוי לא הצליחה. אין חיבור לשרת. כדאי לבדוק את החיבור לאינטרנט ולנסות שוב.',
      ),
    ).toBeInTheDocument();
    expect(saveFile).not.toHaveBeenCalled();
    expect(exportButton()).toBeEnabled();
  });

  it('shows an error toast when saving fails', async () => {
    repo.exportAll.mockResolvedValue(storedTrips);
    saveFile.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setup();
    fireEvent.click(exportButton());
    expect(await screen.findByText(/שמירת הגיבוי לא הצליחה/)).toBeInTheDocument();
  });

  it('says there is nothing to back up when the server has no trips', async () => {
    repo.exportAll.mockResolvedValue([]);
    setup();
    fireEvent.click(exportButton());
    expect(await screen.findByText('אין עדיין טיולים לגיבוי')).toBeInTheDocument();
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('asks for one more tap when the tap activation expired while loading', async () => {
    setUserActivation({ isActive: false });
    repo.exportAll.mockResolvedValue(storedTrips);
    saveFile.mockResolvedValue('shared');
    setup();
    fireEvent.click(exportButton());

    const dialog = await screen.findByRole('dialog', { name: 'קובץ הגיבוי מוכן' });
    expect(dialog).toHaveAccessibleDescription(
      'הקובץ מוכן (שני טיולים). לוחצים על הכפתור כדי לשמור או לשתף אותו.',
    );
    expect(saveFile).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'שמירה או שיתוף' }));
    });
    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('קובץ הגיבוי שותף (שני טיולים)')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('hides the export button when there are no trips', () => {
    setup(false);
    expect(screen.queryByRole('button', { name: 'שמירת גיבוי' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'שחזור מגיבוי' })).toBeInTheDocument();
  });
});

describe('restore (FR-8.1)', () => {
  it('opens the restore dialog', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'שחזור מגיבוי' }));
    expect(screen.getByRole('dialog', { name: 'שחזור טיולים מקובץ גיבוי' })).toBeInTheDocument();
  });
});

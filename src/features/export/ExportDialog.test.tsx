import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui';
import { AppError } from '@/data';
import { ExportButton } from './ExportButton';
import { activities, trip } from './testData';

const renderer = vi.hoisted(() => ({
  renderPng: vi.fn(),
  renderPdf: vi.fn(),
}));
vi.mock('./renderExport', () => renderer);

const platformMock = vi.hoisted(() => ({ saveFile: vi.fn() }));
vi.mock('@/platform', () => ({ platform: platformMock }));

const pngBlob = new Blob(['png'], { type: 'image/png' });
const pdfBlob = new Blob(['%PDF'], { type: 'application/pdf' });

beforeEach(() => {
  renderer.renderPng.mockReset().mockResolvedValue(pngBlob);
  renderer.renderPdf.mockReset().mockResolvedValue(pdfBlob);
  platformMock.saveFile.mockReset().mockResolvedValue('saved');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as { userActivation?: unknown }).userActivation;
});

function renderButton() {
  render(
    <ToastProvider>
      <ExportButton trip={trip} activities={activities} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'ייצוא' }));
  return screen.getByRole('dialog', { name: 'ייצוא לוח הזמנים' });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('ExportDialog', () => {
  it('offers the two hour ranges with their hours (FR-7.3)', () => {
    const dialog = renderButton();
    const fitted = within(dialog).getByRole('radio', { name: /השעות הרלוונטיות/ });
    const full = within(dialog).getByRole('radio', { name: /כל היממה/ });
    expect(fitted).toBeChecked();
    expect(full).not.toBeChecked();
    // 08:00–22:00 widened to the 07:00 activity.
    expect(within(dialog).getByText('07:00–22:00')).toBeInTheDocument();
    expect(within(dialog).getByText('00:00–24:00')).toBeInTheDocument();
    expect(within(dialog).getByText('בקובץ PDF כל עמוד מציג עד 7 ימים.')).toBeInTheDocument();
  });

  it('saves a PNG of all days with the trip name (FR-7.1)', async () => {
    const dialog = renderButton();
    fireEvent.click(within(dialog).getByRole('button', { name: 'שמירה כתמונה' }));

    await waitFor(() =>
      expect(platformMock.saveFile).toHaveBeenCalledWith(pngBlob, 'רומא.png', 'image/png'),
    );
    const [layout, text] = renderer.renderPng.mock.calls[0]!;
    expect(layout.pages).toHaveLength(1);
    expect(layout.range).toEqual({ startMinute: 420, endMinute: 1320 });
    expect(text.subtitle(layout.pages[0])).toBe('1.5 10:00 עד 3.5 18:00');
    expect(text.dayCaption(layout.days[0])).toBe('1.5 · יום 1');
    expect(await screen.findByText('הקובץ נשמר')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('saves a paginated PDF with the full-day range (FR-7.2, FR-7.3)', async () => {
    const dialog = renderButton();
    fireEvent.click(within(dialog).getByRole('radio', { name: /כל היממה/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'שמירה כ־PDF' }));

    await waitFor(() =>
      expect(platformMock.saveFile).toHaveBeenCalledWith(pdfBlob, 'רומא.pdf', 'application/pdf'),
    );
    const [layout, text] = renderer.renderPdf.mock.calls[0]!;
    expect(layout.hourRange).toBe('full');
    expect(layout.range).toEqual({ startMinute: 0, endMinute: 1440 });
    expect(layout.pages[0].days.length).toBeLessThanOrEqual(7);
    // "Page X of Y" only when there is more than one page.
    expect(text.subtitle({ ...layout.pages[0], pageNumber: 2, pageCount: 3 })).toBe(
      '1.5 10:00 עד 3.5 18:00 · עמוד 2 מתוך 3',
    );
  });

  it('says "shared" after the share sheet', async () => {
    platformMock.saveFile.mockResolvedValue('shared');
    const dialog = renderButton();
    fireEvent.click(within(dialog).getByRole('button', { name: 'שמירה כתמונה' }));
    expect(await screen.findByText('הקובץ שותף')).toBeInTheDocument();
  });

  it('shows nothing when the user cancels the share sheet, and stays open', async () => {
    platformMock.saveFile.mockResolvedValue('cancelled');
    const dialog = renderButton();
    fireEvent.click(within(dialog).getByRole('button', { name: 'שמירה כתמונה' }));
    await waitFor(() => expect(platformMock.saveFile).toHaveBeenCalled());
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'שמירה כתמונה' })).toBeEnabled(),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText(/הקובץ (נשמר|שותף)|לא הצלחתי/)).not.toBeInTheDocument();
  });

  it('shows a Hebrew error toast when the file cannot be made', async () => {
    renderer.renderPdf.mockRejectedValue(new Error('canvas exploded'));
    const dialog = renderButton();
    fireEvent.click(within(dialog).getByRole('button', { name: 'שמירה כ־PDF' }));
    expect(
      await screen.findByText('לא הצלחתי ליצור את הקובץ. משהו השתבש. אפשר לנסות שוב.'),
    ).toBeInTheDocument();
    expect(platformMock.saveFile).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'שמירה כ־PDF' })).toBeEnabled();
  });

  it('maps an AppError from saving to its Hebrew message', async () => {
    platformMock.saveFile.mockRejectedValue(new AppError('network', { reason: 'offline' }));
    const dialog = renderButton();
    fireEvent.click(within(dialog).getByRole('button', { name: 'שמירה כתמונה' }));
    expect(
      await screen.findByText(/^לא הצלחתי ליצור את הקובץ\. אין חיבור לשרת/),
    ).toBeInTheDocument();
  });

  it('cannot be closed while the file is being made', async () => {
    const pending = deferred<Blob>();
    renderer.renderPng.mockReturnValue(pending.promise);
    const dialog = renderButton();
    fireEvent.click(within(dialog).getByRole('button', { name: 'שמירה כתמונה' }));

    const busyButton = await within(dialog).findByRole('button', { name: 'מכין את הקובץ…' });
    expect(busyButton).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'ביטול' })).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: 'סגירה' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /כל היממה/ })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await act(async () => pending.resolve(pngBlob));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes on Esc and with Cancel when idle', () => {
    renderButton();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ייצוא' }));
    fireEvent.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks for one more tap when the user activation expired during a slow export', async () => {
    Object.defineProperty(navigator, 'userActivation', {
      value: { isActive: false },
      configurable: true,
    });
    const dialog = renderButton();
    fireEvent.click(within(dialog).getByRole('button', { name: 'שמירה כ־PDF' }));

    const save = await within(dialog).findByRole('button', { name: 'שמירה או שיתוף' });
    expect(platformMock.saveFile).not.toHaveBeenCalled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(platformMock.saveFile).toHaveBeenCalledWith(pdfBlob, 'רומא.pdf', 'application/pdf'),
    );
    expect(await screen.findByText('הקובץ נשמר')).toBeInTheDocument();
  });
});

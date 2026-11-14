import { buildExportLayout, PDF_DAYS_PER_PAGE } from '@/domain';
import type { ExportText } from './drawTimetable';
import { renderPdf, renderPng } from './renderExport';
import { createMockContext } from './testCanvas';
import { activities, trip } from './testData';

// `?raw` CSS is empty under Vitest (css: false); use the tokens read from disk.
vi.mock('./theme', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./theme')>();
  const { tokensCss } = await import('./testTheme');
  return { ...actual, exportTheme: () => actual.exportTheme(tokensCss) };
});

interface FakeDoc {
  options: { orientation: string; unit: string; format: string };
  pages: string[];
  images: { type: string; x: number; y: number; w: number; h: number }[];
  title?: string;
}
const docs: FakeDoc[] = [];

vi.mock('jspdf', () => ({
  jsPDF: class {
    doc: FakeDoc;
    constructor(options: FakeDoc['options']) {
      this.doc = { options, pages: [options.orientation], images: [] };
      docs.push(this.doc);
    }
    addPage(_format: string, orientation: string) {
      this.doc.pages.push(orientation);
    }
    addImage(_data: string, type: string, x: number, y: number, w: number, h: number) {
      this.doc.images.push({ type, x, y, w, h });
    }
    setProperties(props: { title: string }) {
      this.doc.title = props.title;
    }
    output() {
      return new Blob(['%PDF'], { type: 'application/pdf' });
    }
  },
}));

const text: ExportText = {
  subtitle: (page) => `עמוד ${page.pageNumber} מתוך ${page.pageCount}`,
  dayCaption: (day) => `#${day.dayNumber}`,
};

let contexts: ReturnType<typeof createMockContext>[] = [];

beforeEach(() => {
  docs.length = 0;
  contexts = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    const mock = createMockContext();
    contexts.push(mock);
    return mock.ctx;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AA');
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) {
    callback(new Blob(['png'], { type: 'image/png' }));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function longTrip(endDate: string) {
  return { ...trip, window: { ...trip.window, endDate } };
}

describe('renderPdf', () => {
  it('puts at most 7 days on a page (FR-7.2)', async () => {
    // 1.5 – 16.5 = 16 days → 7 + 7 + 2.
    const layout = buildExportLayout(longTrip('2026-05-16'), activities, {
      hourRange: 'fitted',
      daysPerPage: PDF_DAYS_PER_PAGE,
    });
    const blob = await renderPdf(layout, text);

    expect(blob.type).toBe('application/pdf');
    expect(docs).toHaveLength(1);
    const doc = docs[0]!;
    expect(doc.options).toMatchObject({ unit: 'mm', format: 'a4' });
    expect(doc.images).toHaveLength(3);
    expect(doc.images.every((i) => i.type === 'JPEG')).toBe(true);
    expect(doc.title).toBe('רומא');
    // Every page has its own canvas with only its days and "page X of Y".
    expect(contexts).toHaveLength(3);
    const dayCaptions = contexts.map((c) =>
      c.texts.filter((t) => t.text.startsWith('#')).map((t) => t.text),
    );
    expect(dayCaptions[0]).toEqual(['#1', '#2', '#3', '#4', '#5', '#6', '#7']);
    expect(dayCaptions[2]).toEqual(['#15', '#16']);
    expect(contexts[2]!.texts.some((t) => t.text === 'עמוד 3 מתוך 3')).toBe(true);
  });

  it('chooses the orientation per page and keeps the image inside the A4 margins', async () => {
    // Fitted range: a 7-day page is wide (landscape), the 2-day last page is tall (portrait).
    const layout = buildExportLayout(longTrip('2026-05-09'), activities, {
      hourRange: 'fitted',
      daysPerPage: PDF_DAYS_PER_PAGE,
    });
    await renderPdf(layout, text);
    const doc = docs[0]!;
    expect(doc.pages).toEqual(['landscape', 'portrait']);
    const [wide, tall] = doc.images;
    expect(wide!.x + wide!.w).toBeLessThanOrEqual(297 - 8 + 1e-9);
    expect(wide!.y + wide!.h).toBeLessThanOrEqual(210 - 8 + 1e-9);
    expect(tall!.x + tall!.w).toBeLessThanOrEqual(210 - 8 + 1e-9);
    expect(tall!.y + tall!.h).toBeLessThanOrEqual(297 - 8 + 1e-9);
  });

  it('uses one shared hour range on every page', async () => {
    const layout = buildExportLayout(longTrip('2026-05-09'), activities, {
      hourRange: 'full',
      daysPerPage: PDF_DAYS_PER_PAGE,
    });
    await renderPdf(layout, text);
    for (const { texts } of contexts) {
      const hours = texts.filter((t) => /^\d\d:00$/.test(t.text)).map((t) => t.text);
      expect(hours[0]).toBe('00:00');
      expect(hours.at(-1)).toBe('23:00');
    }
  });

  it('fails when the canvas is unavailable', async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    const layout = buildExportLayout(trip, activities, { hourRange: 'fitted', daysPerPage: 7 });
    await expect(renderPdf(layout, text)).rejects.toThrow(/canvas/);
  });
});

describe('renderPng', () => {
  it('draws every day on one image (FR-7.1)', async () => {
    const layout = buildExportLayout(longTrip('2026-05-16'), activities, { hourRange: 'full' });
    const blob = await renderPng(layout, text);
    expect(blob.type).toBe('image/png');
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.texts.filter((t) => t.text.startsWith('#'))).toHaveLength(16);
    expect(contexts[0]!.ctx.scale).toHaveBeenCalledWith(2, 2);
  });

  it('rejects a paginated layout', async () => {
    const layout = buildExportLayout(longTrip('2026-05-16'), activities, {
      hourRange: 'full',
      daysPerPage: 7,
    });
    await expect(renderPng(layout, text)).rejects.toThrow(/single-page/);
  });

  it('fails when the browser cannot encode the image', async () => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) => callback(null));
    const layout = buildExportLayout(trip, activities, { hourRange: 'fitted' });
    await expect(renderPng(layout, text)).rejects.toThrow(/encode/);
  });
});

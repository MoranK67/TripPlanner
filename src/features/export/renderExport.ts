// PNG / PDF file generation (FR-7.1, FR-7.2, FR-7.4). Loaded on demand by the export dialog
// (`import('./renderExport')`) so neither the renderer nor jsPDF is in the main bundle (NFR-4).
//
// Hebrew in the PDF: jsPDF draws text glyph by glyph with no bidi reordering of mixed Hebrew /
// number runs (dates, "יום 1", "09:00–10:30"), so its text output would come out in the wrong
// order. Each PDF page is therefore drawn by the same canvas renderer as the PNG (the browser does
// the RTL layout with the bundled Rubik font) and embedded as an image — as in the prototype.

import { fitOnA4, type ExportLayout, type ExportPage } from '@/domain';
import { canvasScale } from './canvasHelpers';
import { drawPage, measurePage, type ExportText } from './drawTimetable';
import { exportTheme, type ExportTheme } from './theme';

export type { ExportText } from './drawTimetable';

/** JPEG keeps PDF pages small and fast to embed; the background is opaque, so nothing is lost. */
const PDF_IMAGE_TYPE = 'image/jpeg';
const PDF_IMAGE_QUALITY = 0.92;
/** Margin around the timetable on a PDF page, in mm. */
const PDF_MARGIN_MM = 8;

/** Text that makes the browser fetch both the Hebrew and the Latin (digits) subsets of Rubik. */
const FONT_SAMPLE = 'אבג abc 0123';
const FONT_WEIGHTS = [400, 600, 700] as const;

/**
 * Makes sure Rubik is loaded before drawing: a canvas never waits for a web font and would silently
 * use a fallback. The faces come from the bundled @fontsource CSS (no network outside the app,
 * FR-7.4). A failure only means a fallback font, so it is not an error.
 */
export async function loadExportFonts(theme: ExportTheme): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts || typeof fonts.load !== 'function') return;
  try {
    await Promise.all(FONT_WEIGHTS.map((w) => fonts.load(`${w} 16px ${theme.font}`, FONT_SAMPLE)));
  } catch (error) {
    console.warn('[export] font loading failed, using a fallback font', error);
  }
}

/** Draws one page on a new canvas sized for the device scale. */
export function renderPageCanvas(
  layout: ExportLayout,
  page: ExportPage,
  text: ExportText,
  theme: ExportTheme,
): HTMLCanvasElement {
  const size = measurePage(layout, page);
  const scale = canvasScale(size.width, size.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(size.width * scale));
  canvas.height = Math.max(1, Math.floor(size.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('[export] canvas 2D context is not available');
  ctx.scale(scale, scale);
  drawPage(ctx, layout, page, text, theme);
  return canvas;
}

/** Frees a canvas bitmap at once (iOS keeps a tight budget for canvas memory). */
function release(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('[export] the browser could not encode the image'));
    }, type);
  });
}

/** Lets the browser paint (the "preparing" state) between heavy steps. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** FR-7.1: one PNG of all trip days. `layout` must be built without `daysPerPage` (one page). */
export async function renderPng(layout: ExportLayout, text: ExportText): Promise<Blob> {
  const [page, ...rest] = layout.pages;
  if (!page || rest.length > 0) throw new Error('[export] PNG needs a single-page layout');
  const theme = exportTheme();
  await loadExportFonts(theme);
  await nextFrame();
  const canvas = renderPageCanvas(layout, page, text, theme);
  try {
    return await canvasToBlob(canvas, 'image/png');
  } finally {
    release(canvas);
  }
}

/**
 * FR-7.2: an A4 PDF with one layout page per PDF page (≤ 7 days, built with `PDF_DAYS_PER_PAGE`),
 * one shared hour range, orientation chosen per page from its aspect ratio (`fitOnA4`).
 */
export async function renderPdf(layout: ExportLayout, text: ExportText): Promise<Blob> {
  if (layout.pages.length === 0) throw new Error('[export] nothing to export');
  const theme = exportTheme();
  const [{ jsPDF }] = await Promise.all([import('jspdf'), loadExportFonts(theme)]);

  let doc: InstanceType<typeof jsPDF> | null = null;
  for (const page of layout.pages) {
    await nextFrame();
    const size = measurePage(layout, page);
    const place = fitOnA4(size.width, size.height, PDF_MARGIN_MM);
    if (!doc) {
      doc = new jsPDF({ orientation: place.orientation, unit: 'mm', format: 'a4', compress: true });
    } else {
      doc.addPage('a4', place.orientation);
    }
    const canvas = renderPageCanvas(layout, page, text, theme);
    try {
      const image = canvas.toDataURL(PDF_IMAGE_TYPE, PDF_IMAGE_QUALITY);
      doc.addImage(image, 'JPEG', place.x, place.y, place.width, place.height);
    } finally {
      release(canvas);
    }
  }
  if (!doc) throw new Error('[export] nothing to export');
  doc.setProperties({ title: layout.tripName });
  return doc.output('blob');
}

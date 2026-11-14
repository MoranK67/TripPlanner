import { buildExportLayout, type ExportLayout } from '@/domain';
import { drawPage, fillHatch, measurePage, PAGE_GEOMETRY, type ExportText } from './drawTimetable';
import { createMockContext } from './testCanvas';
import { activities, trip } from './testData';
import { testTheme } from './testTheme';

const theme = testTheme();
const text: ExportText = {
  subtitle: (page) => `כותרת משנה ${page.pageNumber}/${page.pageCount}`,
  dayCaption: (day) => `${day.shortDateLabel} · יום ${day.dayNumber}`,
};

function draw(layout: ExportLayout, pageIndex = 0) {
  const mock = createMockContext();
  const page = layout.pages[pageIndex];
  if (!page) throw new Error('no page');
  drawPage(mock.ctx, layout, page, text, theme);
  return { ...mock, page };
}

describe('measurePage', () => {
  it('sizes the page from the day count and the number of rows', () => {
    const layout = buildExportLayout(trip, activities, { hourRange: 'fitted' });
    const g = PAGE_GEOMETRY;
    // Fitted range 07:00–22:00 = 30 rows; 3 days.
    expect(layout.rows).toHaveLength(30);
    expect(measurePage(layout, layout.pages[0]!)).toEqual({
      width: g.pad * 2 + g.timeWidth + 3 * g.columnWidth,
      height: g.pad * 2 + g.titleHeight + g.headHeight + 30 * g.rowHeight,
    });
  });

  it('is taller for the full day (48 rows)', () => {
    const fitted = buildExportLayout(trip, activities, { hourRange: 'fitted' });
    const full = buildExportLayout(trip, activities, { hourRange: 'full' });
    const delta =
      measurePage(full, full.pages[0]!).height - measurePage(fitted, fitted.pages[0]!).height;
    expect(delta).toBe((48 - 30) * PAGE_GEOMETRY.rowHeight);
  });
});

describe('drawPage', () => {
  const layout = buildExportLayout(trip, activities, { hourRange: 'fitted' });

  it('draws right-to-left with the trip name and subtitle in Rubik', () => {
    const { ctx, texts } = draw(layout);
    expect(ctx.direction).toBe('rtl');
    const title = texts.find((c) => c.text === 'רומא');
    expect(title?.font).toContain('700 22px');
    expect(title?.font).toContain('Rubik');
    expect(title?.fillStyle).toBe(theme.ink);
    expect(texts.some((c) => c.text === 'כותרת משנה 1/1')).toBe(true);
  });

  it('puts day 1 in the right-most column, like the timetable', () => {
    const { texts } = draw(layout);
    const x = (label: string) => texts.find((c) => c.text === label)?.x ?? NaN;
    expect(x('1.5 · יום 1')).toBeGreaterThan(x('2.5 · יום 2'));
    expect(x('2.5 · יום 2')).toBeGreaterThan(x('3.5 · יום 3'));
    expect(texts.some((c) => c.text === layout.days[0]!.weekdayLabel)).toBe(true);
  });

  it('labels every full hour of the range in the hour column on the right', () => {
    const { texts } = draw(layout);
    const hours = texts.filter((c) => /^\d\d:00$/.test(c.text));
    expect(hours.map((c) => c.text)).toEqual(
      layout.rows.flatMap((r) => (r.label ? [r.label] : [])),
    );
    expect(hours[0]?.text).toBe('07:00');
    const dayHeader = texts.find((c) => c.text === '1.5 · יום 1');
    expect(hours[0]!.x).toBeGreaterThan(dayHeader!.x);
  });

  it('fills blocks with their colour and draws name and time', () => {
    const { texts, fills } = draw(layout);
    expect(fills).toContain('#cde5ff');
    expect(fills).toContain('#ffe3c2');
    const time = texts.find((c) => c.text === '10:00–13:00');
    expect(time?.fillStyle).toBe(theme.blockInkSoft);
    // A one-slot block keeps its name on one line, next to the time.
    expect(texts.some((c) => c.text === 'קפה' && c.fillStyle === theme.blockInk)).toBe(true);
    expect(texts.some((c) => c.text === '07:00–07:30')).toBe(true);
    // Bank activities are not drawn.
    expect(texts.some((c) => c.text === 'במאגר')).toBe(false);
  });

  it('places a block by its row offset', () => {
    const { texts } = draw(layout);
    const g = PAGE_GEOMETRY;
    const top = g.pad + g.titleHeight + g.headHeight;
    // Day 1 block at 10:00 = 6 rows below 07:00; its name starts 6 px inside the block.
    const name = texts.find((c) => c.text.startsWith('הקולוסיאום'));
    expect(name?.y).toBe(top + 6 * g.rowHeight + g.blockInsetTop + 6);
  });

  it('hatches the hours outside the trip on the first and last day (FR-4.2)', () => {
    const { rects } = draw(layout);
    const disabled = rects.filter((r) => r.fillStyle === theme.slotDisabled);
    // Day 1 07:00–10:00 and day 3 18:00–22:00.
    expect(disabled).toHaveLength(2);
    const g = PAGE_GEOMETRY;
    expect(disabled.map((r) => r.h)).toEqual([6 * g.rowHeight, 8 * g.rowHeight]);
  });

  it('draws only the days of the given page', () => {
    const long = buildExportLayout(
      { ...trip, window: { ...trip.window, endDate: '2026-05-10' } },
      activities,
      { hourRange: 'full', daysPerPage: 7 },
    );
    const { texts } = draw(long, 1);
    expect(texts.some((c) => c.text === '8.5 · יום 8')).toBe(true);
    expect(texts.some((c) => c.text === '1.5 · יום 1')).toBe(false);
    expect(texts.some((c) => c.text === 'כותרת משנה 2/2')).toBe(true);
  });
});

describe('fillHatch', () => {
  it('fills the base colour and strokes clipped stripes', () => {
    const { ctx, rects } = createMockContext();
    fillHatch(ctx, theme, 10, 20, 100, 50);
    expect(rects).toEqual([{ x: 10, y: 20, w: 100, h: 50, fillStyle: theme.slotDisabled }]);
    expect(ctx.rect).toHaveBeenCalledWith(10, 20, 100, 50);
    expect(ctx.clip).toHaveBeenCalled();
    expect(ctx.strokeStyle).toBe(theme.slotDisabledHatch);
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });
});

import { autoScrollStep, dropArea, edgeSide, hitTestSlot, type GridMetrics } from './geometry';

// A scroller at x 0..800, y 0..600 with a 56 px sticky header and a 64 px time column.
// 7 columns of 150 px; in RTL the first day sits next to the time column on the right.
const rtl: GridMetrics = {
  viewport: { left: 0, top: 56, right: 736, bottom: 600 },
  columns: { left: 736 - 1050, top: -344, right: 736, bottom: -344 + 48 * 28 },
  dayCount: 7,
  direction: 'rtl',
  slotHeight: 28,
};
const ltr: GridMetrics = {
  ...rtl,
  viewport: { left: 64, top: 56, right: 800, bottom: 600 },
  columns: { left: 64, top: -344, right: 64 + 1050, bottom: -344 + 48 * 28 },
  direction: 'ltr',
};

describe('hitTestSlot', () => {
  it('counts days from the right edge in RTL', () => {
    expect(hitTestSlot(rtl, { x: 735, y: 300 }, 0, 1)?.dayIndex).toBe(0);
    expect(hitTestSlot(rtl, { x: 736 - 151, y: 300 }, 0, 1)?.dayIndex).toBe(1);
    expect(hitTestSlot(rtl, { x: 1, y: 300 }, 0, 1)?.dayIndex).toBe(4);
  });

  it('counts days from the left edge in LTR', () => {
    expect(hitTestSlot(ltr, { x: 65, y: 300 }, 0, 1)?.dayIndex).toBe(0);
    expect(hitTestSlot(ltr, { x: 64 + 151, y: 300 }, 0, 1)?.dayIndex).toBe(1);
  });

  it('follows horizontal scrolling through the measured columns rect', () => {
    // Scrolled two days towards the end: the columns layer moved 300 px to the right in RTL.
    const scrolled = {
      ...rtl,
      columns: { ...rtl.columns, left: rtl.columns.left + 300, right: 1036 },
    };
    expect(hitTestSlot(scrolled, { x: 735, y: 300 }, 0, 1)?.dayIndex).toBe(2);
  });

  it('snaps the block top (not the pointer) to the nearest slot', () => {
    // Block top = y - grabOffset = 226 - 10 = 216 → 216 + 344 = 560 = slot 20 (10:00).
    expect(hitTestSlot(rtl, { x: 700, y: 226 }, 10, 2)?.slot).toBe(20);
    expect(hitTestSlot(rtl, { x: 700, y: 226 + 13 }, 10, 2)?.slot).toBe(20);
    expect(hitTestSlot(rtl, { x: 700, y: 226 + 15 }, 10, 2)?.slot).toBe(21);
  });

  it('clamps so the whole block stays inside the day', () => {
    const bottom = { ...rtl, columns: { ...rtl.columns, top: -800 } };
    expect(hitTestSlot(bottom, { x: 700, y: 590 }, 0, 4)?.slot).toBe(44);
    const top = { ...rtl, columns: { ...rtl.columns, top: 56 } };
    expect(hitTestSlot(top, { x: 700, y: 57 }, 20, 2)?.slot).toBe(0);
  });

  it('ignores the sticky header, the time column and the area beyond the last day', () => {
    expect(hitTestSlot(rtl, { x: 700, y: 30 }, 0, 1)).toBeNull(); // header
    expect(hitTestSlot(rtl, { x: 760, y: 300 }, 0, 1)).toBeNull(); // time column
    const short = { ...rtl, dayCount: 2, columns: { ...rtl.columns, left: 736 - 300 } };
    expect(hitTestSlot(short, { x: 300, y: 300 }, 0, 1)).toBeNull(); // past day 2
  });
});

describe('autoScrollStep', () => {
  const area = { left: 0, top: 56, right: 736, bottom: 600 };

  it('does nothing in the middle or far outside', () => {
    expect(autoScrollStep(area, { x: 400, y: 300 })).toEqual({ dx: 0, dy: 0 });
    expect(autoScrollStep(area, { x: 1000, y: 300 })).toEqual({ dx: 0, dy: 0 });
  });

  it('scrolls physically towards the nearest edge, faster closer to it', () => {
    expect(autoScrollStep(area, { x: 2, y: 300 }).dx).toBeLessThan(0); // left = later days in RTL
    expect(autoScrollStep(area, { x: 734, y: 300 }).dx).toBeGreaterThan(0);
    expect(autoScrollStep(area, { x: 400, y: 598 }).dy).toBeGreaterThan(0);
    expect(autoScrollStep(area, { x: 400, y: 58 }).dy).toBeLessThan(0);
    const near = autoScrollStep(area, { x: 400, y: 595 }).dy;
    const far = autoScrollStep(area, { x: 400, y: 560 }).dy;
    expect(near).toBeGreaterThan(far);
  });

  it('keeps scrolling at full speed just outside the edge', () => {
    expect(autoScrollStep(area, { x: 400, y: 610 }, { maxSpeed: 18 }).dy).toBe(18);
  });
});

describe('dropArea', () => {
  const box = { left: 0, top: 0, right: 800, bottom: 600 };

  it('removes the header and the time column on the right in RTL', () => {
    expect(dropArea(box, 'rtl', 56, 64)).toEqual(rtl.viewport);
  });

  it('removes the header and the time column on the left in LTR', () => {
    expect(dropArea(box, 'ltr', 56, 64)).toEqual(ltr.viewport);
  });
});

describe('edgeSide', () => {
  const area = { left: 0, top: 56, right: 360, bottom: 600 };

  it('reports the physical side edge the pointer holds', () => {
    expect(edgeSide(area, { x: 10, y: 300 })).toBe(-1);
    expect(edgeSide(area, { x: -20, y: 300 })).toBe(-1); // a little outside still counts
    expect(edgeSide(area, { x: 350, y: 300 })).toBe(1);
    expect(edgeSide(area, { x: 180, y: 300 })).toBe(0);
  });

  it('ignores the header, anything below the area, and far outside', () => {
    expect(edgeSide(area, { x: 10, y: 30 })).toBe(0);
    expect(edgeSide(area, { x: 10, y: 650 })).toBe(0);
    expect(edgeSide(area, { x: -40, y: 300 })).toBe(0);
  });
});

describe('hitTestSlot at the phone scale (PHONE-2)', () => {
  // One 296 px day column, 40 px day row, 22 px half hours; slot s starts at y = s × 22 − 344.
  const phone: GridMetrics = {
    viewport: { left: 0, top: 40, right: 296, bottom: 600 },
    columns: { left: 0, top: -344, right: 296, bottom: -344 + 48 * 22 },
    dayCount: 1,
    direction: 'rtl',
    slotHeight: 22,
  };

  it('snaps the block top to the nearest 22 px row', () => {
    const y = (slot: number) => slot * 22 - 344;
    expect(hitTestSlot(phone, { x: 150, y: y(20) }, 0, 2)).toEqual({ dayIndex: 0, slot: 20 });
    expect(hitTestSlot(phone, { x: 150, y: y(20) + 10 }, 0, 2)?.slot).toBe(20);
    expect(hitTestSlot(phone, { x: 150, y: y(20) + 12 }, 0, 2)?.slot).toBe(21);
    // The grab offset is subtracted: the pointer 10 px below the block top.
    expect(hitTestSlot(phone, { x: 150, y: y(25) + 10 }, 10, 2)?.slot).toBe(25);
  });

  it('ignores the slim day row above the rows', () => {
    expect(hitTestSlot(phone, { x: 150, y: 39 }, 0, 1)).toBeNull();
    expect(hitTestSlot(phone, { x: 150, y: 40 }, 0, 1)).not.toBeNull();
  });
});

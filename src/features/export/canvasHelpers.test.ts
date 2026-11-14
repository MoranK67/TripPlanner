import {
  canvasScale,
  fitText,
  MAX_CANVAS_AREA,
  MAX_CANVAS_SIDE,
  mixHex,
  roundRectPath,
  wrapText,
} from './canvasHelpers';
import { createMockContext } from './testCanvas';

describe('canvasScale', () => {
  it('uses 2× when the bitmap fits', () => {
    expect(canvasScale(1200, 900)).toBe(2);
  });

  it('shrinks to stay inside the total-pixel limit (iOS)', () => {
    const scale = canvasScale(5000, 2000);
    expect(scale).toBeLessThan(2);
    expect(5000 * scale * 2000 * scale).toBeLessThanOrEqual(MAX_CANVAS_AREA + 1);
  });

  it('shrinks to stay inside the side limit', () => {
    const scale = canvasScale(30_000, 100);
    expect(30_000 * scale).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
  });

  it('falls back to 1 for an empty size', () => {
    expect(canvasScale(0, 100)).toBe(1);
  });
});

describe('mixHex', () => {
  it('mixes two colours by the given amount', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('rgb(0,0,0)');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('rgb(255,255,255)');
    expect(mixHex('#ffd6e0', '#5a4a6a', 0.16)).toBe('rgb(229,192,205)');
  });
});

describe('roundRectPath', () => {
  it('draws a closed path with corner radius limited to half the size', () => {
    const { ctx } = createMockContext();
    roundRectPath(ctx, 0, 0, 10, 4, 16);
    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.moveTo).toHaveBeenCalledWith(2, 0);
    expect(ctx.arcTo).toHaveBeenCalledTimes(4);
    expect(ctx.arcTo).toHaveBeenCalledWith(10, 0, 10, 4, 2);
    expect(ctx.closePath).toHaveBeenCalledTimes(1);
  });
});

describe('fitText', () => {
  const { ctx } = createMockContext(10);

  it('keeps text that fits', () => {
    expect(fitText(ctx, 'קפה', 30)).toBe('קפה');
  });

  it('cuts text with an ellipsis to fit the width', () => {
    const cut = fitText(ctx, 'מוזיאון הוותיקן', 60);
    expect(cut.endsWith('…')).toBe(true);
    expect(Array.from(cut).length * 10).toBeLessThanOrEqual(60);
  });

  it('never splits an emoji', () => {
    const cut = fitText(ctx, '🎡🎡🎡🎡🎡', 30);
    expect(cut).toBe('🎡🎡…');
  });
});

describe('wrapText', () => {
  const { ctx } = createMockContext(10);

  it('wraps on spaces', () => {
    expect(wrapText(ctx, 'שייט על הסן', 70, 3)).toEqual(['שייט על', 'הסן']);
  });

  it('limits the lines and ends the last one with an ellipsis', () => {
    const lines = wrapText(ctx, 'אחת שתיים שלוש ארבע חמש', 60, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith('…')).toBe(true);
  });

  it('cuts a single word longer than the line', () => {
    expect(wrapText(ctx, 'אבגדהוזחטי', 50, 2)).toEqual(['אבגד…']);
  });
});

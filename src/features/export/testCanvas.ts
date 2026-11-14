// Test-only: a recording stand-in for CanvasRenderingContext2D (jsdom has no canvas).

export interface TextCall {
  text: string;
  x: number;
  y: number;
  font: string;
  fillStyle: string;
  textAlign: string;
  direction: string;
}

export interface FillRectCall {
  x: number;
  y: number;
  w: number;
  h: number;
  fillStyle: string;
}

/** Each character is `charWidth` px wide, so text measuring is predictable. */
export function createMockContext(charWidth = 6) {
  const texts: TextCall[] = [];
  const rects: FillRectCall[] = [];
  const fills: string[] = [];
  const ctx = {
    direction: 'inherit',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    font: '10px sans-serif',
    lineWidth: 1,
    textAlign: 'start',
    textBaseline: 'alphabetic',
    arcTo: vi.fn(),
    beginPath: vi.fn(),
    clip: vi.fn(),
    closePath: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    rect: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    setLineDash: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(() => {
      fills.push(String(ctx.fillStyle));
    }),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
      rects.push({ x, y, w, h, fillStyle: String(ctx.fillStyle) });
    }),
    fillText: vi.fn((text: string, x: number, y: number) => {
      texts.push({
        text,
        x,
        y,
        font: ctx.font,
        fillStyle: String(ctx.fillStyle),
        textAlign: ctx.textAlign,
        direction: ctx.direction,
      });
    }),
    measureText: vi.fn((text: string) => ({ width: Array.from(text).length * charWidth })),
  };
  // Typed as a real context too, so it can be passed to the code under test.
  return { ctx: ctx as unknown as CanvasRenderingContext2D & typeof ctx, texts, rects, fills };
}

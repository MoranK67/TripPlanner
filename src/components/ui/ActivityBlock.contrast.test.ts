// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PALETTE } from '@/domain';

// NFR-7 / DEC-011: text on every pastel must pass WCAG AA (4.5:1 for normal-size text).
// Reads the real token values so a token change cannot silently break contrast.
const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

function token(name: string): string {
  const match = new RegExp(String.raw`--color-${name}:\s*(#[0-9a-fA-F]{6})`).exec(tokensCss);
  if (!match?.[1]) throw new Error(`token --color-${name} not found`);
  return match[1];
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const PASTEL_NAMES = [
  'pink',
  'peach',
  'butter',
  'mint',
  'sage',
  'sky',
  'lavender',
  'lilac',
  'coral',
  'stone',
];

describe('activity block colors', () => {
  it('tokens.css pastels mirror PALETTE in order', () => {
    expect(PASTEL_NAMES.map((n) => token(`pastel-${n}`).toUpperCase())).toEqual([...PALETTE]);
  });

  it.each([...PALETTE])('block text passes AA on %s', (color) => {
    expect(contrast(token('block-ink'), color)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('block-ink-soft'), color)).toBeGreaterThanOrEqual(4.5);
  });

  it('the × icon (ink-soft) passes the 3:1 non-text minimum even without its white backing', () => {
    for (const color of PALETTE) {
      expect(contrast(token('ink-soft'), color)).toBeGreaterThanOrEqual(3);
    }
  });
});

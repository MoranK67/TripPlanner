// Colours and font for the canvas renderer, read from the design tokens (src/styles/tokens.css)
// so the exported image uses exactly the app's palette without a second copy of the hex values.
// Part of the lazily loaded export chunk (NFR-4): the raw CSS text only ships with the exporter.

import tokensCss from '@/styles/tokens.css?raw';

export interface ExportTheme {
  /** CSS font list for `ctx.font`, e.g. `'Rubik', system-ui, …`. */
  font: string;
  bg: string;
  panel: string;
  ink: string;
  inkSoft: string;
  line: string;
  lineStrong: string;
  slotDisabled: string;
  slotDisabledHatch: string;
  blockInk: string;
  blockInkSoft: string;
  blockEdge: string;
}

/** Token name (without `--color-`) for every colour the renderer uses. */
const COLOR_TOKENS = {
  bg: 'bg',
  panel: 'panel',
  ink: 'ink',
  inkSoft: 'ink-soft',
  line: 'line',
  lineStrong: 'line-strong',
  slotDisabled: 'slot-disabled',
  slotDisabledHatch: 'slot-disabled-hatch',
  blockInk: 'block-ink',
  blockInkSoft: 'block-ink-soft',
  blockEdge: 'block-edge',
} as const satisfies Record<Exclude<keyof ExportTheme, 'font'>, string>;

/** `--color-name: #hex` declarations of a CSS text, keyed by `name`. */
export function parseColorTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of css.matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,8})\b/gi)) {
    const [, name, value] = match;
    if (name && value) tokens.set(name.toLowerCase(), value.toLowerCase());
  }
  return tokens;
}

/** Value of `--font-sans`, or `null` if it is missing. */
export function parseFontToken(css: string): string | null {
  return /--font-sans\s*:\s*([^;]+);/.exec(css)?.[1]?.trim() ?? null;
}

/** Builds the renderer theme from the tokens CSS. Throws if a token is missing (a coding error). */
export function exportTheme(css: string = tokensCss): ExportTheme {
  const colors = parseColorTokens(css);
  const font = parseFontToken(css);
  if (!font) throw new Error('[export] --font-sans token not found');
  const pick = (name: string): string => {
    const value = colors.get(name);
    if (!value) throw new Error(`[export] --color-${name} token not found`);
    return value;
  };
  return {
    font,
    bg: pick(COLOR_TOKENS.bg),
    panel: pick(COLOR_TOKENS.panel),
    ink: pick(COLOR_TOKENS.ink),
    inkSoft: pick(COLOR_TOKENS.inkSoft),
    line: pick(COLOR_TOKENS.line),
    lineStrong: pick(COLOR_TOKENS.lineStrong),
    slotDisabled: pick(COLOR_TOKENS.slotDisabled),
    slotDisabledHatch: pick(COLOR_TOKENS.slotDisabledHatch),
    blockInk: pick(COLOR_TOKENS.blockInk),
    blockInkSoft: pick(COLOR_TOKENS.blockInkSoft),
    blockEdge: pick(COLOR_TOKENS.blockEdge),
  };
}

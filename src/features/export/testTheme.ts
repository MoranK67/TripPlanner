// Test-only: the real design tokens. Vitest runs with `css: false`, which empties `?raw` CSS
// imports, so tests read the file from disk instead (the build inlines it via `?raw`).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exportTheme, type ExportTheme } from './theme';

export const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

export function testTheme(): ExportTheme {
  return exportTheme(tokensCss);
}

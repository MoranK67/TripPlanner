// The app's Hebrew strings, read from src/i18n/he.json, so assertions follow the real copy.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const he = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../src/i18n/he.json', import.meta.url)), 'utf8'),
) as Record<string, unknown>;

/** `t('trips.dialog.errors.too_long')`, `t('trips.deleted', { name })`. Missing keys throw. */
export function t(key: string, vars: Record<string, string | number> = {}): string {
  const value = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], he);
  if (typeof value !== 'string') throw new Error(`Missing he.json key: ${key}`);
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? `{{${name}}}`));
}

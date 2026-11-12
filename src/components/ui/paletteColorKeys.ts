import type { PALETTE } from '@/domain';

/** i18n key suffix (`common.colors.*`) per palette entry, in PALETTE order. */
export const PALETTE_COLOR_KEYS = [
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
] as const satisfies readonly string[] & { length: (typeof PALETTE)['length'] };

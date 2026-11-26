// PWA options for vite-plugin-pwa (M8.3). Owned by platform-engineer; wired into vite.config.ts.
//
// - Manifest: Hebrew, RTL, standalone, colours from src/styles/tokens.css (--color-bg).
// - Service worker: Workbox generateSW that precaches the app shell, every lazy route chunk and
//   the export chunks (renderer + jsPDF, DEC-034) so an offline reload opens the app.
// - NO runtime caching at all: Supabase API/auth responses never enter the SW cache. Trip data
//   is available offline only through the per-user TanStack persisted cache (DEC-037/039).
// - registerType 'prompt': a new version waits until the user taps "refresh" (PwaUpdatePrompt in
//   src/platform), and the reload is deferred while writes are pending.
import type { VitePWAOptions } from 'vite-plugin-pwa';

/** --color-bg in src/styles/tokens.css; also the <meta name="theme-color"> in index.html. */
const BACKGROUND = '#fbf8f4';

/**
 * jsPDF's optional dependencies (html2canvas, DOMPurify, canvg) are split into their own lazy
 * chunks but are never loaded: the PDF is built from canvas JPEGs (DEC-034). They get a fixed
 * file-name prefix at build time (`jspdfOptionalChunkFileNames`, wired into vite.config.ts) so
 * the precache can leave them out by name instead of by a generic pattern.
 */
const JSPDF_OPTIONAL_PREFIX = 'jspdf-optional-';
const JSPDF_OPTIONAL_PACKAGES: Record<string, string> = {
  canvg: 'canvg',
  html2canvas: 'html2canvas',
  dompurify: 'purify',
};

/** Rolldown `output.chunkFileNames`: Vite's default, except for jsPDF's unused optional deps. */
export function jspdfOptionalChunkFileNames(chunk: {
  facadeModuleId: string | null;
  moduleIds: readonly string[];
}): string {
  const ids = chunk.facadeModuleId ? [chunk.facadeModuleId] : chunk.moduleIds;
  for (const id of ids) {
    const match = /[\\/]node_modules[\\/]([^\\/]+)[\\/]/.exec(id);
    const name = match?.[1] ? JSPDF_OPTIONAL_PACKAGES[match[1]] : undefined;
    if (name) return `assets/${JSPDF_OPTIONAL_PREFIX}${name}-[hash].js`;
  }
  return 'assets/[name]-[hash].js';
}

export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: 'prompt',
  // Registration happens in src/platform/pwa.ts (web only; never in Tauri/Capacitor shells).
  injectRegister: false,
  // The SW stays off in `vite dev` (no stale-cache surprises while developing).
  devOptions: { enabled: false },
  includeAssets: ['icon.svg', 'apple-touch-icon-180x180.png'],
  manifest: {
    id: '/',
    name: 'TripPlanner',
    short_name: 'TripPlanner',
    description: 'תכנון לוח זמנים לטיולים: מאגר אטרקציות וגרירה ללוח לפי ימים ושעות.',
    lang: 'he',
    dir: 'rtl',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: BACKGROUND,
    background_color: BACKGROUND,
    icons: [
      { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/maskable-icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  },
  workbox: {
    // App shell + all JS/CSS chunks (lazy routes, export renderer, jsPDF). The icons and the
    // manifest are added by the plugin itself (includeAssets + manifest icons).
    // Rubik: only the Hebrew and Latin woff2 subsets (what the UI uses); the browser picks
    // woff2, so the .woff fallbacks and other scripts are left to the network.
    globPatterns: ['**/*.{js,css,html}', 'assets/rubik-{hebrew,latin,latin-ext}-*.woff2'],
    globIgnores: [`**/${JSPDF_OPTIONAL_PREFIX}*.js`],
    // SPA: every navigation (e.g. a reload of /trips/123 offline) gets the precached index.html.
    navigateFallback: 'index.html',
    runtimeCaching: [],
    cleanupOutdatedCaches: true,
    // Prompt mode: the waiting SW activates only after the user agrees (skipWaiting message),
    // and takes over the open pages then so the reload uses the new files.
    clientsClaim: true,
    skipWaiting: false,
  },
};

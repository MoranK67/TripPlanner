// Generates the PWA PNG icons from public/icon.svg with Playwright's Chromium (no extra deps).
// Usage (from the repo root): node <this file> C:\dev\trip-planner
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const root = process.argv[2];
const require = createRequire(join(root, 'package.json'));
const { chromium } = require('@playwright/test');

const svg = readFileSync(join(root, 'public', 'icon.svg'), 'utf8');
// Full-bleed square variant (no rounded corners, no transparency): iOS applies its own mask,
// and Android's maskable safe zone (radius 40%) already contains the pin (max ~28% from centre).
const square = svg.replace('rx="16"', 'rx="0"');

const jobs = [
  { file: 'pwa-192x192.png', size: 192, src: svg, transparent: true },
  { file: 'pwa-512x512.png', size: 512, src: svg, transparent: true },
  { file: 'maskable-icon-512x512.png', size: 512, src: square, transparent: false },
  { file: 'apple-touch-icon-180x180.png', size: 180, src: square, transparent: false },
];

const browser = await chromium.launch();
for (const job of jobs) {
  const page = await browser.newPage({ viewport: { width: job.size, height: job.size } });
  const body = job.src.replace('<svg ', `<svg width="${job.size}" height="${job.size}" `);
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${body}</body></html>`,
  );
  await page.locator('svg').screenshot({
    path: join(root, 'public', job.file),
    omitBackground: job.transparent,
  });
  await page.close();
  console.log('wrote', job.file);
}
await browser.close();

// Accessibility scans with axe-core (NFR-7: WCAG 2.1 AA).
//
// `expectNoA11yViolations(page, 'screen name')` runs axe on the current page with the WCAG 2.0 /
// 2.1 A and AA rule sets and fails on **serious** or **critical** violations. Minor and moderate
// ones never fail the test; they are listed in the attached report (`axe-<screen>.json`) and as
// a test annotation so they are still visible in the HTML report.
//
// Exclusions must be narrow and justified with a DEC reference. Currently there are none:
// DEC-011 accepts the 1.26:1 input-border contrast until M11.1, but that is a non-text contrast
// issue (WCAG 1.4.11) and axe's `color-contrast` rule checks text only, so it does not fire.

import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const FAILING_IMPACTS = new Set(['serious', 'critical']);

type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;
type AxeViolation = AxeResults['violations'][number];

/** Waits until CSS transitions/animations (e.g. a dialog fading in) have finished. */
async function waitForSettledAnimations(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => {
      const iterations = animation.effect?.getComputedTiming().iterations;
      // Spinners loop forever: they never settle and do not affect the scan.
      return animation.playState !== 'running' || iterations === Infinity;
    }),
  );
}

/** One line per offending element: `[impact] rule: help — selector`. */
export function formatViolations(violations: AxeViolation[]): string {
  return violations
    .flatMap((v) =>
      v.nodes.map(
        (node) =>
          `[${v.impact ?? 'unknown'}] ${v.id}: ${v.help} — ${node.target.join(' ')}` +
          (node.failureSummary ? `\n    ${node.failureSummary.replace(/\n/g, '\n    ')}` : ''),
      ),
    )
    .join('\n');
}

export interface A11yScanOptions {
  /** CSS selectors to leave out of the scan. Each one needs a comment citing the decision. */
  exclude?: string[];
  /** Rule IDs to switch off. Each one needs a comment citing the decision. */
  disableRules?: string[];
}

/**
 * Scans the whole page (dialogs included) and fails on serious/critical WCAG 2.1 AA violations.
 * Call it once the screen is in the state to check (e.g. after `expect(dialog).toBeVisible()`).
 */
export async function expectNoA11yViolations(
  page: Page,
  screen: string,
  options: A11yScanOptions = {},
): Promise<void> {
  const testInfo: TestInfo = test.info();
  await waitForSettledAnimations(page);

  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector);
  if (options.disableRules?.length) builder = builder.disableRules(options.disableRules);
  const results = await builder.analyze();

  await testInfo.attach(`axe-${screen}.json`, {
    body: JSON.stringify(
      { url: results.url, violations: results.violations, incomplete: results.incomplete },
      null,
      2,
    ),
    contentType: 'application/json',
  });

  const blocking = results.violations.filter((v) => FAILING_IMPACTS.has(v.impact ?? ''));
  const other = results.violations.filter((v) => !FAILING_IMPACTS.has(v.impact ?? ''));
  if (other.length > 0) {
    testInfo.annotations.push({
      type: 'a11y (minor/moderate)',
      description: `${screen}:\n${formatViolations(other)}`,
    });
  }

  // Soft, so one test can scan several states and report all of them.
  expect
    .soft(formatViolations(blocking), `serious/critical axe violations on "${screen}"`)
    .toBe('');
}

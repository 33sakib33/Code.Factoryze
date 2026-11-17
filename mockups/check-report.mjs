import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(resolve(here, '../packages/app/package.json'))('playwright');
const output = resolve(here, '../dist/report-preview'); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.FACTORYZE_PREVIEW_BROWSER || 'chrome', headless: true });
const errors = [], external = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  await page.goto(pathToFileURL(resolve(here, 'report.html')).href);
  await page.locator('.fz-learning-grid').waitFor();
  await page.evaluate(() => document.fonts.ready);
  for (const size of [{ width: 1254, height: 612 }, { width: 1280, height: 800 }, { width: 683, height: 512 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    const layout = () => page.locator('#report').evaluate(node => {
      const card = node.querySelector('.fz-report-result').getBoundingClientRect();
      const figures = node.querySelector('.fz-figures').getBoundingClientRect();
      return { height: card.height, width: card.width, figuresTop: figures.top + scrollY };
    });
    await page.locator('#report-state').selectOption('complete');
    const complete = await layout();
    await page.locator('#report-state').selectOption('partial');
    const partial = await layout();
    assert.deepEqual(partial, complete, `Result card size and following content stay fixed at ${size.width}px`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('#report-state').selectOption('complete');
  await page.locator('#report').evaluate(node => { node.style.width = '600px'; });
  assert.equal(await page.locator('.fz-learning-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 1,
    'A narrow app pane uses the compact layout even in a wide window');
  assert.equal(await page.locator('#report-content').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await page.locator('#report').evaluate(node => { node.style.width = ''; });
  assert.equal(await page.locator('.fz-report-sticker').count(), 1, 'A circular pass-rate indicator highlights the result');
  assert.equal(await page.locator('.fz-report-sticker').evaluate(node => node.getBoundingClientRect().width >= 80), true);
  assert.equal(await page.locator('.fz-report-sticker-percent').innerText(), '100%');
  assert.equal(await page.locator('.fz-report-check-segment').count(), 9, 'One separated perimeter segment per hidden check');
  assert.equal(await page.locator('.fz-report-segment-passed').count(), 9);
  assert.doesNotMatch(await page.locator('.fz-report-result').innerText(), /KEEP GOING|IN PROGRESS|WELL DONE|Nicely done/);
  assert.equal(await page.locator('.fz-report-result-number').innerText(), '9 / 9');
  await page.getByRole('button', { name: 'View all 9 checks', exact: true }).click();
  const checkDialog = page.getByRole('dialog', { name: 'Hidden-check details', exact: true });
  await checkDialog.waitFor();
  assert.equal(await checkDialog.locator('.fz-report-check-row').count(), 9);
  await page.screenshot({ path: resolve(output, 'checks-all-passed.png'), fullPage: true });
  await page.keyboard.press('Escape');
  assert.equal(await checkDialog.count(), 0);
  assert.equal(await page.getByRole('button', { name: 'View all 9 checks', exact: true }).evaluate(node => node === document.activeElement), true, 'Focus returns to the result card');
  assert.equal(await page.locator('.fz-report-advice').count(), 0, 'No next-attempt suggestions in the mockup');
  assert.equal(await page.locator('.fz-prompts .fz-tag').count(), 0, 'No prompt-quality scores in the mockup');
  assert.doesNotMatch(await page.locator('#report').innerText(), /Try this next time|Specific, \d|Vague, \d|Prompt feedback|specificity|Synthetic historical feedback|Score:/i);
  assert.equal(await page.locator('.fz-cost-rows li').count(), 5);
  assert.equal(await page.locator('.fz-prompts li').count(), 3);
  assert.match(await page.locator('.fz-learning-grid').innerText(), /8,800/);
  assert.match(await page.locator('.fz-figures').innerText(), /Token budget used[\s\S]*Weighted tokens used against the attempt limit/);
  assert.equal(await page.locator('.fz-figures dt').first().evaluate(node => Number(getComputedStyle(node).fontWeight) >= 600), true);
  assert.equal(await page.locator('.fz-learning-grid').evaluate(node => node.getBoundingClientRect().bottom <= innerHeight), true, 'Activity and token cards fit in the first desktop view');
  await page.screenshot({ path: resolve(output, 'desktop-light.png'), fullPage: true });
  await page.getByRole('button', { name: 'Dark appearance' }).click();
  assert.equal(await page.locator('body.theia-dark').count(), 1);
  await page.screenshot({ path: resolve(output, 'desktop-dark.png'), fullPage: true });
  await page.locator('#report-state').selectOption('partial');
  assert.equal(await page.locator('.fz-report-sticker-percent').innerText(), '78%');
  assert.equal(await page.locator('.fz-report-check-segment').count(), 9);
  assert.equal(await page.locator('.fz-report-segment-passed').count(), 7);
  assert.equal(await page.locator('.fz-report-segment-failed').count(), 2);
  assert.deepEqual(await page.locator('.fz-report-segment-failed title').allTextContents(),
    ['Branch-local date boundary: failed', 'Evening boundary: failed']);
  await page.screenshot({ path: resolve(output, 'desktop-dark-partial.png'), fullPage: true });
  await page.getByRole('button', { name: 'See 2 failed checks', exact: true }).click();
  await checkDialog.waitFor();
  assert.match(await checkDialog.locator('.fz-report-dialog-body > :first-child').innerText(), /^Needs attention/);
  await page.screenshot({ path: resolve(output, 'desktop-dark-failed-checks.png'), fullPage: true });
  await checkDialog.getByText('Passed checks (7)', { exact: true }).click();
  assert.equal(await checkDialog.locator('.fz-report-check-passed').first().isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: 'See 2 failed checks', exact: true }).evaluate(node => node === document.activeElement), true);
  await page.locator('#report-state').selectOption('complete');
  await page.getByRole('button', { name: 'Light appearance' }).click();
  await page.getByRole('button', { name: 'View all 9 checks', exact: true }).click();
  await checkDialog.waitFor();
  await page.locator('#report-state').evaluate(node => { node.value = 'partial'; node.dispatchEvent(new Event('change')); });
  assert.equal(await checkDialog.count(), 0, 'Replacing a report closes its previous modal');
  for (const size of [{ width: 683, height: 512 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    for (const state of ['complete', 'partial', 'older', 'manual']) {
      await page.locator('#report-state').selectOption(state);
      assert.equal(await page.locator('.fz-report-advice').count(), 0);
      assert.equal(await page.locator('.fz-prompts .fz-tag').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No horizontal overflow: ${state} at ${size.width}`);
      if (state === 'partial') {
        assert.match(await page.locator('.fz-prompts').innerText(), /Counts incomplete/);
        assert.match(await page.locator('.fz-report-result').innerText(), /2 checks need attention/);
        await page.getByRole('button', { name: 'See 2 failed checks', exact: true }).click();
        await checkDialog.waitFor();
        assert.equal(await checkDialog.locator('.fz-report-check-failed').count(), 2);
        assert.match(await checkDialog.locator('.fz-report-check-failed').first().innerText(), /Expected.*branch-local/);
        assert.match(await checkDialog.locator('.fz-report-check-failed').last().innerText(), /Expected.*zero fine/);
        assert.equal(await checkDialog.evaluate(node => node.scrollWidth <= node.clientWidth), true);
        await page.screenshot({ path: resolve(output, `${size.width}-failed-checks.png`), fullPage: true });
        await checkDialog.getByRole('button', { name: 'Close details', exact: true }).click();
        assert.equal(await checkDialog.count(), 0);
        await page.getByRole('button', { name: 'See 2 failed checks', exact: true }).click();
        await checkDialog.waitFor();
        await page.mouse.click(2, 2);
        assert.equal(await checkDialog.count(), 0, 'Clicking the backdrop closes the modal');
      } else if (state === 'older') {
        assert.equal(await page.getByText('Cost not recorded', { exact: true }).count(), 3);
        assert.equal(await page.locator('.fz-prompts .fz-bar').count(), 0);
        assert.equal(await page.locator('.fz-report-segment-unknown').count(), 9);
        await page.getByRole('button', { name: 'View check details', exact: true }).click();
        await checkDialog.waitFor();
        assert.match(await checkDialog.innerText(), /Individual check details were not recorded/);
        await checkDialog.getByRole('button', { name: 'Close details', exact: true }).click();
      } else if (state === 'manual') {
        assert.equal(await page.locator('.fz-prompts').count(), 0);
      }
      await page.screenshot({ path: resolve(output, `${size.width}-${state}.png`), fullPage: true });
    }
  }
  // Prompt content is rendered as text, even when local storage contains HTML.
  await page.evaluate(() => localStorage.setItem('factoryze:prompt:mock-report-p1', '<img src=x onerror="window.previewInjected=true">'));
  await page.locator('#report-state').selectOption('complete');
  assert.equal(await page.locator('.fz-prompts img').count(), 0);
  assert.match(await page.locator('.fz-prompts .fz-text').first().innerText(), /<img/);
  assert.equal(await page.evaluate(() => window.previewInjected), undefined);
  // Keyboard navigation reaches the controls, and the preview makes no external requests.
  await page.locator('#report-state').focus(); await page.keyboard.press('Tab');
  assert.equal(await page.locator('#theme').evaluate(node => node === document.activeElement), true);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const result = { passed: true, platform: process.platform, browser: await browser.version(),
    states: ['complete', 'partial', 'older', 'manual'], widths: [1280, 683, 390], lightAndDark: true,
    schemaValidation: true, legacyCostsUnknown: true, promptHtmlEscaped: true, keyboardControls: true,
    suggestionsRemoved: true, promptScoringRemoved: true, summaryLabelsExplained: true, analysisInFirstDesktopView: true,
    segmentedTestPerimeter: true, oneSegmentPerCheck: true, individualCheckStatuses: true, accuratePassRate: true,
    stableResultCardSize: true, stableFollowingContent: true, layoutComparisonWidths: [1254, 1280, 683, 390],
    checkDetailsModal: true, failureReasons: true, failuresShownFirst: true, passedChecksExpandable: true,
    modalEscapeAndFocusReturn: true, modalBackdropClose: true,
    productionReportRenderers: true, scoredHistoryHidden: true, legacyCheckDetailsUnknown: true,
    narrowPaneLayout: true, modalClosesOnReportReplacement: true,
    externalRequests: 0, consoleErrors: 0 };
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally { await browser.close(); }

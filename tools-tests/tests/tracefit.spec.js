import { test, expect, download, jsonDownload, parseCsv, noOverflow } from './helpers.js';

async function fitted(page) {
  await expect(page.locator('#fit-status')).toHaveText(/^(Converged|已收敛) · \d+ iterations$/, { timeout: 20_000 });
  await expect(page.locator('#export-json')).toBeEnabled();
}
async function open(page) { await page.goto('/tracefit/'); await fitted(page); }
async function fit(page) { await page.locator('#fit-button').click(); await fitted(page); }

test('Tracefit synthetic examples recover Gaussian, doublet and Lorentzian peak locations', async ({ page }) => {
  await open(page);
  await expect(page.locator('#metric-samples')).toHaveText('161');
  const gaussian = await jsonDownload(page, 'export-json');
  expect(gaussian.parameters.peaks[0].center).toBeCloseTo(545, 0);
  expect(Math.abs(gaussian.parameters.peaks[0].width - 18)).toBeLessThan(0.6);
  expect(gaussian.statistics.rmse).toBeLessThan(0.02);
  for (const [example, model, centres] of [['doublet', 'gaussian', [525, 574]], ['lorentzian', 'lorentzian', [563]]]) {
    await page.locator(`#sample-${example}`).click();
    await expect(page.locator('#export-json')).toBeDisabled();
    await fit(page);
    const report = await jsonDownload(page, 'export-json');
    expect(report.model).toBe(model);
    expect(report.parameters.peaks).toHaveLength(centres.length);
    for (let i = 0; i < centres.length; i += 1) expect(Math.abs(report.parameters.peaks[i].center - centres[i])).toBeLessThan(1.5);
    expect(report.statistics.rmse).toBeLessThan(0.02);
    expect(report.covariance.valid).toBe(true);
  }
});

test('Tracefit fits an uploaded known-sigma trace and exports original observations and residuals', async ({ page }) => {
  await open(page);
  const points = Array.from({ length: 101 }, (_, i) => {
    const x = -5 + i / 10;
    return { x, y: 0.3 + 0.02 * x + 2 * Math.exp(-0.5 * ((x - 0.8) / 0.6) ** 2) };
  });
  const text = ['label,signal,x,error', ...points.map(({ x, y }, i) => `sample-${i},${y},${x},0.05`)].join('\n');
  await page.locator('#csv-upload').setInputFiles({ name: 'known-gaussian.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
  await expect(page.locator('#export-json')).toBeDisabled();
  await page.locator('#x-column').selectOption('x');
  await page.locator('#y-column').selectOption('signal');
  await page.locator('#sigma-column').selectOption('error');
  await fit(page);
  const report = await jsonDownload(page, 'export-json');
  expect(report.source).toBe('known-gaussian.csv');
  expect(report.columns).toEqual({ x: 'x', y: 'signal', sigma: 'error' });
  expect(report.converged).toBe(true);
  expect(report.covariance.valid).toBe(true);
  expect(report.covariance.mode).toBe('known-sigma');
  expect(report.statistics.dof).toBe(96);
  const peak = report.parameters.peaks[0];
  expect(peak.center).toBeCloseTo(0.8, 6);
  expect(peak.width).toBeCloseTo(0.6, 6);
  expect(peak.amplitude).toBeCloseTo(2, 6);
  expect(report.parameters.offset).toBeCloseTo(0.3, 6);
  expect(report.parameters.slope).toBeCloseTo(0.02, 6);
  const csv = await download(page, 'export-csv');
  expect(csv.filename).toBe('tracefit-fitted.csv');
  const rows = parseCsv(csv.bytes, 'x,y,sigma,fitted,residual,source_line');
  expect(rows).toHaveLength(points.length);
  for (let i = 0; i < rows.length; i += 1) {
    expect(rows[i][0]).toBe(points[i].x);
    expect(rows[i][1]).toBe(points[i].y);
    expect(rows[i][2]).toBe(0.05);
    expect(rows[i][1] - rows[i][3]).toBeCloseTo(rows[i][4], 12);
    expect(Math.abs(rows[i][4])).toBeLessThan(1e-6);
    expect(rows[i][5]).toBe(i + 2);
  }
});

test('Tracefit rejects duplicate coordinates and invalid sigma, then recovers with a valid example', async ({ page }) => {
  await open(page);
  await page.locator('#csv-upload').setInputFiles({ name: 'duplicate.csv', mimeType: 'text/csv', buffer: Buffer.from('x,y\n0,1\n0,2\n1,3\n2,4\n3,5\n4,6\n5,7\n6,8') });
  await expect(page.locator('#fit-status')).toHaveClass(/error/);
  await expect(page.locator('#fit-status')).toContainText('Duplicate x');
  await expect(page.locator('#fit-button')).toBeDisabled();
  await expect(page.locator('#export-json')).toBeDisabled();
  await page.locator('#csv-upload').setInputFiles({ name: 'invalid-sigma.csv', mimeType: 'text/csv', buffer: Buffer.from('x,y,sigma\n0,1,0\n1,2,1\n2,3,1\n3,2,1\n4,1,1\n5,0,1\n6,0,1\n7,0,1') });
  await page.locator('#sigma-column').selectOption('sigma');
  await expect(page.locator('#fit-status')).toHaveClass(/error/);
  await expect(page.locator('#fit-status')).toContainText(/sigma|σ|positive/i);
  await expect(page.locator('#fit-button')).toBeDisabled();
  await page.locator('#sample-gaussian').click();
  await fit(page);
  await expect(page.locator('#metric-covariance')).toHaveText('VALID');
});

test('Tracefit disables stale exports while fitting and ignores obsolete worker errors after input changes', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, transfer) {
      if (window.holdFit) window.failOldFit = () => this.dispatchEvent(new MessageEvent('message', { data: { id: message.id, error: 'Obsolete worker error' } }));
      else return original.call(this, message, transfer);
    };
  });
  await open(page);
  await page.evaluate(() => { window.holdFit = true; });
  await page.locator('#fit-button').click();
  await expect(page.locator('#fit-status')).toHaveText('Fitting…');
  await expect(page.locator('#export-csv')).toBeDisabled();
  await expect(page.locator('#export-json')).toBeDisabled();
  await expect(page.locator('#parameter-table tbody tr')).toHaveCount(0);
  await page.locator('#model').selectOption('lorentzian');
  await page.evaluate(() => window.failOldFit());
  await expect(page.locator('#fit-status')).toHaveText('Ready to fit. Parameters have changed.');
  await expect(page.locator('#export-json')).toBeDisabled();
  await page.evaluate(() => { window.holdFit = false; });
  await page.locator('#model').selectOption('gaussian');
  await fit(page);
});

test('Tracefit mobile charts fit the viewport and Chinese preference survives reload @mobile', async ({ page }) => {
  await open(page);
  await noOverflow(page);
  await page.locator('#language-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await fitted(page);
  await expect(page.locator('#fit-button')).toContainText('开始拟合');
  await noOverflow(page);
  await page.reload();
  await fitted(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await noOverflow(page);
});

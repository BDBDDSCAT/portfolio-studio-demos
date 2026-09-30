import { test, expect, download, jsonDownload, parseCsv, noOverflow } from './helpers.js';

async function ready(page) {
  await expect(page.locator('#status')).toHaveText(/^(扫描完成|Scan complete)$/);
  await expect(page.locator('#export-result')).toBeEnabled();
}
async function open(page) { await page.goto('/thinfilm/'); await ready(page); }
async function preset(page, value) { await page.locator('#preset').selectOption(value); await ready(page); }
async function compute(page) { await page.locator('#compute').click(); await ready(page); }

test('Thinfilm AR, interface, Bragg and absorber examples produce distinct passive optical responses', async ({ page }) => {
  await open(page);
  for (const [name, reflectance, transmission, absorption] of [
    ['ar', 0, 1, 0], ['interface', 0.04, 0.96, 0],
    ['bragg', 0.9929074271, 0.0070925729, 0], ['absorber', 0.1344632482, 0.0285836423, 0.8369531095],
  ]) {
    await preset(page, name);
    const report = await jsonDownload(page, 'export-result');
    expect(report.schema).toBe('thinfilm.result.v1');
    expect(report.reference.R).toBeCloseTo(reflectance, 8);
    expect(report.reference.T).toBeCloseTo(transmission, 8);
    expect(report.reference.A).toBeCloseTo(absorption, 8);
    expect(report.scan.rows).toHaveLength(401);
    expect(report.scan.rows.every(row => [row.R, row.T, row.A].every(Number.isFinite) && row.R >= 0 && row.T >= 0 && row.A >= 0 && Math.abs(row.R + row.T + row.A - 1) < 1e-10)).toBe(true);
  }
});

test('Thinfilm angle scans export raw Fresnel coefficients and resolve the Brewster minimum', async ({ page }) => {
  await open(page);
  await preset(page, 'interface');
  await page.locator('#scan-mode').selectOption('angle');
  await page.locator('#start').fill('50');
  await page.locator('#stop').fill('62');
  await page.locator('#points').fill('121');
  await page.locator('#polarization').selectOption('p');
  await compute(page);
  const file = await download(page, 'download-csv');
  expect(file.filename).toBe('thinfilm-angle-p.csv');
  const rows = parseCsv(file.bytes, 'wavelength_nm,angle_deg,R,T,A,r_re,r_im,t_re,t_im');
  expect(rows).toHaveLength(121);
  expect(rows[0][1]).toBe(50);
  expect(rows.at(-1)[1]).toBe(62);
  for (const [wavelength, degrees, R, T, A, rRe, rIm] of rows) {
    const angle = degrees * Math.PI / 180;
    const transmittedCos = Math.sqrt(1 - (Math.sin(angle) / 1.5) ** 2);
    const expectedR = ((1.5 * Math.cos(angle) - transmittedCos) / (1.5 * Math.cos(angle) + transmittedCos)) ** 2;
    expect(wavelength).toBe(550);
    expect(R).toBeCloseTo(expectedR, 11);
    expect(R).toBeCloseTo(rRe ** 2 + rIm ** 2, 11);
    expect(R + T + A).toBeCloseTo(1, 11);
  }
  const minimum = rows.reduce((best, row) => row[2] < best[2] ? row : best);
  expect(Math.abs(minimum[1] - Math.atan(1.5) * 180 / Math.PI)).toBeLessThan(0.05);
  expect(minimum[2]).toBeLessThan(1e-7);
  await page.locator('#polarization').selectOption('s');
  await ready(page);
  const s = await jsonDownload(page, 'export-result');
  expect(s.scan.rows.find(row => Math.abs(row.angleDeg - minimum[1]) < 1e-9).R).toBeGreaterThan(0.1);
});

test('Thinfilm result JSON restores edited media, scan settings and original numerical rows', async ({ page }) => {
  await open(page);
  const stack = { incident: 1.1, substrate: 1.6, layers: [{ n: 1.7, k: 0.1, dNm: 200.123456 }] };
  await page.locator('#import-file').setInputFiles({ name: 'coating.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(stack)) });
  await ready(page);
  await page.locator('#start').fill('450');
  await page.locator('#stop').fill('650');
  await page.locator('#points').fill('21');
  await page.locator('#angle').fill('23');
  await page.locator('#polarization').selectOption('s');
  await compute(page);
  const raw = await download(page, 'download-csv');
  const resultFile = await download(page, 'export-result');
  const original = JSON.parse(resultFile.bytes.toString('utf8'));
  expect(original.stack).toEqual(stack);
  expect(original.scan.kind).toBe('wavelength');
  expect(original.config).toMatchObject({ startNm: 450, stopNm: 650, points: 21, angleDeg: 23, polarization: 's' });
  expect(await jsonDownload(page, 'export-stack')).toEqual(stack);
  await preset(page, 'interface');
  await page.locator('#import-file').setInputFiles({ name: resultFile.filename, mimeType: 'application/json', buffer: resultFile.bytes });
  await ready(page);
  for (const [id, value] of Object.entries({ incident: '1.1', substrate: '1.6', start: '450', stop: '650', points: '21', angle: '23', polarization: 's' })) await expect(page.locator(`#${id}`)).toHaveValue(value);
  expect((await download(page, 'download-csv')).bytes.equals(raw.bytes)).toBe(true);
  await page.locator('#add-layer').click();
  await ready(page);
  await expect(page.locator('#layer-table tbody tr')).toHaveCount(2);
  expect((await jsonDownload(page, 'export-stack')).layers[1]).toEqual({ n: 1.5, k: 0, dNm: 100 });
  await page.locator('[data-remove="1"]').click();
  await ready(page);
  expect((await download(page, 'download-csv')).bytes.equals(raw.bytes)).toBe(true);
});

test('Thinfilm rejects non-passive layers and malformed imports without keeping stale numerical exports', async ({ page }) => {
  await open(page);
  await preset(page, 'ar');
  const loss = page.locator('#layer-table input[data-field="k"]');
  await loss.fill('-0.1');
  await expect(page.locator('#status')).toHaveText(/^(参数错误|Invalid parameters)$/);
  await expect(loss).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#download-csv')).toBeDisabled();
  await expect(page.locator('#export-result')).toBeDisabled();
  await expect(page.locator('#stat-r')).toHaveText('—');
  await loss.fill('0');
  await compute(page);
  await page.locator('#import-file').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.locator('#status')).toHaveText(/^(参数错误|Invalid parameters)$/);
  await expect(page.locator('#chart-empty')).toBeVisible();
  await expect(page.locator('#export-result')).toBeDisabled();
  await preset(page, 'ar');
  expect((await jsonDownload(page, 'export-result')).reference.R).toBeLessThan(1e-20);
});

test('Thinfilm mobile layer tables fit the viewport and retain the selected language @mobile', async ({ page }) => {
  await open(page);
  await preset(page, 'bragg');
  await expect(page.locator('#layer-table tbody tr')).toHaveCount(16);
  await noOverflow(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.locator('#language').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#compute')).toContainText('Run scan');
  await noOverflow(page);
  await page.reload();
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await noOverflow(page);
});

test('Thinfilm restores its own maximum-size unpolarized scan and original rows', async ({ page }) => {
  await open(page);
  await preset(page, 'bragg');
  await page.locator('#points').fill('2001');
  await page.locator('#polarization').selectOption('unpolarized');
  await compute(page);
  const file = await download(page, 'export-result');
  expect(file.bytes.length).toBeGreaterThan(1048576);
  const original = JSON.parse(file.bytes.toString('utf8'));
  expect(original.scan.rows).toHaveLength(2001);
  await preset(page, 'interface');
  await page.locator('#import-file').setInputFiles({ name: file.filename, mimeType: 'application/json', buffer: file.bytes });
  await ready(page);
  await expect(page.locator('#points')).toHaveValue('2001');
  await expect(page.locator('#layer-table tbody tr')).toHaveCount(16);
  const restored = await jsonDownload(page, 'export-result');
  expect(restored.config).toEqual(original.config);
  expect(restored.scan.rows).toEqual(original.scan.rows);
});

test('Thinfilm rejects declared result configurations that would silently change the experiment', async ({ page }) => {
  await open(page);
  await page.locator('#points').fill('11');
  await compute(page);
  const valid = await jsonDownload(page, 'export-result');
  for (const mutate of [
    file => { file.config.polarization = 'pp'; },
    file => { file.scan.kind = 'other'; },
    file => { delete file.config; },
    file => { file.reference.angleDeg = 30; },
  ]) {
    const file = structuredClone(valid); mutate(file);
    await page.locator('#import-file').setInputFiles({ name: 'invalid-result.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
    await expect(page.locator('#status')).toHaveText(/^(参数错误|Invalid parameters)$/);
    await expect(page.locator('#export-result')).toBeDisabled();
    await expect(page.locator('#download-csv')).toBeDisabled();
  }
});

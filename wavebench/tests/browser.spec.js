import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const presets = ['double', 'single', 'grating', 'circle', 'annulus', 'vortex', 'custom'];

async function ready(page) {
  await expect(page.locator('#status')).toHaveText(/^(Experiment ready|实验已就绪)$/);
  await expect(page.locator('#exportPng')).toBeEnabled();
  await expect(page.locator('#notice')).not.toHaveClass(/error/);
}

async function openBench(page) {
  await page.goto('/');
  await ready(page);
}

async function selectPreset(page, preset) {
  await page.locator(`[data-preset="${preset}"]`).click();
  await ready(page);
  await expect(page.locator(`[data-preset="${preset}"]`)).toHaveAttribute('aria-pressed', 'true');
}

async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await ready(page);
  await expect(page.locator(`#${id}`)).toHaveValue(String(value));
}

// Hash actual canvas pixels, so a restored session must reproduce the rendered
// experiment rather than merely redisplay its saved controls.
async function canvasHash(page, id) {
  return page.locator(`#${id}`).evaluate(canvas => {
    const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
    return hash >>> 0;
  });
}

async function downloadBytes(page, buttonId) {
  const pending = page.waitForEvent('download');
  await page.locator(`#${buttonId}`).click();
  const download = await pending;
  expect(await download.failure()).toBeNull();
  return { filename: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

function csvRows(bytes) {
  const [header, ...lines] = bytes.toString('utf8').trim().split('\n');
  expect(header).toBe('x_mm,normalized_intensity');
  return lines.map(line => {
    const cells = line.split(',');
    expect(cells).toHaveLength(2);
    const row = cells.map(Number);
    expect(row.every(Number.isFinite)).toBe(true);
    expect(row[1]).toBeGreaterThanOrEqual(0);
    expect(row[1]).toBeLessThanOrEqual(1.000001);
    return row;
  });
}

test('all seven apertures finish computing and render without browser errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await openBench(page);

  const images = new Set();
  for (const preset of presets) {
    await selectPreset(page, preset);
    await expect(page.locator('#area-value')).not.toContainText(/NaN|Infinity|—/);
    await expect(page.locator('#measure-value')).not.toContainText(/NaN|Infinity|—/);
    await expect(page.locator('#experiment-note')).not.toBeEmpty();
    await expect(page.locator('#screen-scale')).toHaveText('4.00 × 4.00 mm');
    const opaque = await page.locator('#diffraction').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 255) return false;
      return true;
    });
    expect(opaque).toBe(true);
    images.add(await canvasHash(page, 'diffraction'));
  }
  expect(images.size).toBe(presets.length);
  await expect(page.locator('#notice')).toContainText('The aperture is empty.');
  expect(errors).toEqual([]);
});

test('wavelength and lens controls change the physical scale and visible pattern', async ({ page }) => {
  await openBench(page);
  const aperture = await canvasHash(page, 'aperture');
  const original = await canvasHash(page, 'diffraction');
  await expect(page.locator('#measure-value')).toHaveText('0.266 mm');

  await setRange(page, 'focalLengthMm', 1000);
  await expect(page.locator('#measure-value')).toHaveText('0.532 mm');
  const longerLens = await canvasHash(page, 'diffraction');
  expect(longerLens).not.toBe(original);
  expect(await canvasHash(page, 'aperture')).toBe(aperture);

  await setRange(page, 'wavelengthNm', 650);
  await expect(page.locator('#measure-value')).toHaveText('0.650 mm');
  expect(await canvasHash(page, 'diffraction')).not.toBe(longerLens);
  expect(await canvasHash(page, 'aperture')).toBe(aperture);
  await page.locator('#viewSpanMm').selectOption('8');
  await expect(page.locator('#screen-scale')).toHaveText('8.00 × 8.00 mm');
  await expect(page.locator('#chart-left')).toHaveText('−4.00 mm');
  await expect(page.locator('#chart-right')).toHaveText('+4.00 mm');
});

test('pointer drawing survives a downloaded session round trip and an empty mask stays stable', async ({ page }) => {
  await openBench(page);
  await selectPreset(page, 'custom');
  await expect(page.locator('#share')).toBeDisabled();
  await page.locator('#aperture').scrollIntoViewIfNeeded();
  const box = await page.locator('#aperture').boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.62, { steps: 12 });
  await page.mouse.up();
  await ready(page);
  await expect(page.locator('#draw-overlay')).toBeHidden();
  const area = await page.locator('#area-value').textContent();
  expect(parseFloat(area)).toBeGreaterThan(0);
  const aperture = await canvasHash(page, 'aperture');
  const pattern = await canvasHash(page, 'diffraction');
  const profile = await canvasHash(page, 'profile');

  await page.locator('.session-menu summary').click();
  const session = await downloadBytes(page, 'saveSession');
  expect(session.filename).toBe('wavebench-custom.json');
  const parsed = JSON.parse(session.bytes.toString('utf8'));
  expect(parsed.version).toBe(1);
  expect(parsed.params.preset).toBe('custom');
  const mask = Buffer.from(parsed.mask, 'base64');
  expect(mask.length).toBe(512 * 512);
  expect(mask.includes(255)).toBe(true);
  expect(mask.includes(0)).toBe(true);

  await page.locator('#clear').click();
  await ready(page);
  await expect(page.locator('#area-value')).toHaveText('0.000 mm²');
  await expect(page.locator('#measure-value')).toHaveText('0');
  await expect(page.locator('#notice')).toContainText('The aperture is empty.');
  const empty = await canvasHash(page, 'diffraction');
  expect(empty).not.toBe(pattern);
  const emptyRows = csvRows((await downloadBytes(page, 'exportCsv')).bytes);
  expect(emptyRows.length).toBeGreaterThan(100);
  expect(emptyRows.every(([, intensity]) => intensity === 0)).toBe(true);

  await page.locator('#sessionFile').setInputFiles({ name: session.filename, mimeType: 'application/json', buffer: session.bytes });
  await ready(page);
  await expect(page.locator('#notice')).toHaveText('Session loaded.');
  await expect(page.locator('#area-value')).toHaveText(area);
  expect(await canvasHash(page, 'aperture')).toBe(aperture);
  expect(await canvasHash(page, 'diffraction')).toBe(pattern);
  expect(await canvasHash(page, 'profile')).toBe(profile);
});

test('PNG and CSV exports contain a real image and physically spaced intensity data', async ({ page }) => {
  await openBench(page);
  const png = await downloadBytes(page, 'exportPng');
  expect(png.filename).toBe('wavebench-double-532nm.png');
  expect([...png.bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(png.bytes.toString('ascii', 12, 16)).toBe('IHDR');
  expect(png.bytes.readUInt32BE(16)).toBe(1500);
  expect(png.bytes.readUInt32BE(20)).toBe(1160);
  expect(png.bytes.length).toBeGreaterThan(20_000);

  const csv = await downloadBytes(page, 'exportCsv');
  expect(csv.filename).toBe('wavebench-double-532nm.csv');
  const rows = csvRows(csv.bytes);
  expect(rows.length).toBeGreaterThan(100);
  const pitchMm = 532 / 1e6 * 500 / 8;
  for (let i = 1; i < rows.length; i += 1) {
    expect(rows[i][0] - rows[i - 1][0]).toBeCloseTo(pitchMm, 10);
  }
  expect(rows[0][0]).toBeGreaterThanOrEqual(-2);
  expect(rows.at(-1)[0]).toBeLessThanOrEqual(2);
  expect(rows[0][0]).toBeCloseTo(-rows.at(-1)[0], 10);
  expect(rows.find(([x]) => x === 0)?.[1]).toBeCloseTo(1, 10);
  expect(rows.some(([, intensity]) => intensity < 0.02)).toBe(true);
});

test('share links restore geometry and view after copying to the clipboard', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async text => { window.copiedExperimentLink = text; } },
    });
  });
  await openBench(page);
  await selectPreset(page, 'grating');
  await setRange(page, 'count', 7);
  await setRange(page, 'wavelengthNm', 610);
  await setRange(page, 'focalLengthMm', 700);
  await page.locator('#displayMode').selectOption('linear');
  await page.locator('#viewSpanMm').selectOption('8');
  const pattern = await canvasHash(page, 'diffraction');
  await page.locator('#share').click();
  await expect(page.locator('#notice')).toHaveText('Experiment link copied.');
  const url = await page.evaluate(() => window.copiedExperimentLink);
  expect(url).toBe(page.url());
  expect(new URL(url).hash).toContain('v=1');

  await page.goto(url);
  await ready(page);
  await expect(page.locator('[data-preset="grating"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#count')).toHaveValue('7');
  await expect(page.locator('#wavelengthNm')).toHaveValue('610');
  await expect(page.locator('#focalLengthMm')).toHaveValue('700');
  await expect(page.locator('#displayMode')).toHaveValue('linear');
  await expect(page.locator('#viewSpanMm')).toHaveValue('8');
  expect(await canvasHash(page, 'diffraction')).toBe(pattern);
});

test('blocked clipboard access presents a selectable share link', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { throw new DOMException('Clipboard blocked', 'NotAllowedError'); } },
    });
  });
  await openBench(page);
  await page.locator('#share').click();
  await expect(page.locator('#linkDialog')).toBeVisible();
  await expect(page.locator('#linkFallback')).toHaveValue(page.url());
  const selection = await page.locator('#linkFallback').evaluate(input => ({ start: input.selectionStart, end: input.selectionEnd, length: input.value.length }));
  expect(selection.start).toBe(0);
  expect(selection.end).toBe(selection.length);
  await page.locator('#linkDialog button').click();
  await expect(page.locator('#linkDialog')).toBeHidden();
});

test('invalid experiment files leave the current controls and rendered result intact', async ({ page }) => {
  await openBench(page);
  await selectPreset(page, 'annulus');
  await setRange(page, 'wavelengthNm', 620);
  const area = await page.locator('#area-value').textContent();
  const pattern = await canvasHash(page, 'diffraction');
  const invalidFiles = [
    { content: '{broken json', error: 'Session file is not valid JSON.' },
    { content: JSON.stringify({ version: 999, params: {}, view: {} }), error: 'Unsupported session file version.' },
    { content: JSON.stringify({ version: 1, params: { preset: 'custom' }, view: {}, mask: 'AAAA' }), error: /Invalid custom mask/ },
  ];
  for (const file of invalidFiles) {
    await page.locator('#sessionFile').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(file.content) });
    await expect(page.locator('#notice')).toHaveClass(/error/);
    await expect(page.locator('#notice')).toHaveText(file.error);
    await expect(page.locator('[data-preset="annulus"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#wavelengthNm')).toHaveValue('620');
    await expect(page.locator('#area-value')).toHaveText(area);
    await expect(page.locator('#exportPng')).toBeEnabled();
    expect(await canvasHash(page, 'diffraction')).toBe(pattern);
  }
});

test('Chinese controls and notes persist after a reload', async ({ page }) => {
  await openBench(page);
  await page.locator('#language').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('#status')).toHaveText('实验已就绪');
  await expect(page.locator('[data-preset="double"]')).toContainText('双缝');
  await expect(page.locator('#experiment-note')).toContainText('两个开口');
  await expect(page.locator('#exportPng')).toContainText('导出实验 PNG');
  await page.reload();
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.locator('#language').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#status')).toHaveText('Experiment ready');
});

test('pending and failed computations cannot export a stale experiment', async ({ page }) => {
  await page.addInitScript(() => {
    const postMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, transfer) {
      if (window.holdNextCompute) {
        window.releaseCompute = () => postMessage.call(this, message, transfer);
      } else if (window.failNextCompute) {
        this.dispatchEvent(new MessageEvent('message', { data: { id: message.id, error: 'Simulated computation failure' } }));
      } else {
        return postMessage.call(this, message, transfer);
      }
    };
  });
  await openBench(page);
  await page.evaluate(() => { window.holdNextCompute = true; });
  await page.locator('#wavelengthNm').evaluate(input => {
    input.value = '600';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => typeof window.releaseCompute)).toBe('function');
  await expect(page.locator('#status')).toHaveText('Computing…');
  for (const id of ['exportPng', 'exportCsv', 'saveSession']) await expect(page.locator(`#${id}`)).toBeDisabled();
  await page.locator('#displayMode').selectOption('linear');
  await page.locator('#language').click();
  await expect(page.locator('#status')).toHaveText('正在计算…');
  for (const id of ['exportPng', 'exportCsv', 'saveSession']) await expect(page.locator(`#${id}`)).toBeDisabled();
  await page.evaluate(() => { window.holdNextCompute = false; window.releaseCompute(); });
  await ready(page);
  await expect(page.locator('#measure-value')).toHaveText('0.300 mm');

  await page.evaluate(() => { window.failNextCompute = true; });
  await page.locator('#wavelengthNm').evaluate(input => {
    input.value = '610';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#notice')).toHaveClass(/error/);
  await expect(page.locator('#notice')).toContainText('Simulated computation failure');
  await expect(page.locator('#status')).toHaveText('无法计算当前实验。');
  for (const id of ['exportPng', 'exportCsv', 'saveSession']) await expect(page.locator(`#${id}`)).toBeDisabled();
  for (const id of ['aperture', 'diffraction', 'profile']) {
    expect(await page.locator(`#${id}`).evaluate(canvas => {
      const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      return bytes.every(byte => byte === 0);
    })).toBe(true);
  }
  await page.evaluate(() => { window.failNextCompute = false; });
  await setRange(page, 'wavelengthNm', 620);
  await expect(page.locator('#measure-value')).toHaveText('0.310 mm');

  await selectPreset(page, 'custom');
  await page.evaluate(() => { window.holdNextCompute = true; window.releaseCompute = undefined; });
  await page.locator('#aperture').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  // Moving the keyboard cursor while a worker result is pending must preserve
  // the newly drawn opening instead of repainting the previous empty mask.
  expect(await page.locator('#aperture').evaluate(canvas => canvas.getContext('2d').getImageData(256, 256, 1, 1).data[1])).toBeGreaterThan(180);
  await expect.poll(() => page.evaluate(() => typeof window.releaseCompute)).toBe('function');
  await page.evaluate(() => { window.holdNextCompute = false; window.releaseCompute(); });
  await ready(page);
  expect(parseFloat(await page.locator('#area-value').textContent())).toBeGreaterThan(0);
});

test('a hidden grating count does not restrict double-slit spacing', async ({ page }) => {
  await openBench(page);
  await expect(page.locator('#widthMm')).toHaveAttribute('min', '0.125');
  await selectPreset(page, 'grating');
  await setRange(page, 'count', 7);
  await page.locator('#separationMm').evaluate(input => {
    input.value = '1.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await ready(page);
  await expect(page.locator('#separationMm')).toHaveValue('1.275');
  await selectPreset(page, 'double');
  await setRange(page, 'separationMm', 1.5);
  await expect(page.locator('#measure-value')).toHaveText('0.177 mm');
  await page.locator('.session-menu summary').click();
  const saved = JSON.parse((await downloadBytes(page, 'saveSession')).bytes.toString('utf8'));
  expect(saved.params.separationMm).toBe(1.5);
  expect(saved.params.count).toBe(7);
});

test('an asynchronous PNG keeps the filename of its captured experiment', async ({ page }) => {
  await page.addInitScript(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      return toBlob.call(this, blob => { window.releasePngBlob = () => callback(blob); }, ...args);
    };
  });
  await openBench(page);
  const pending = page.waitForEvent('download');
  await page.locator('#exportPng').click();
  await expect.poll(() => page.evaluate(() => typeof window.releasePngBlob)).toBe('function');
  await selectPreset(page, 'circle');
  await setRange(page, 'wavelengthNm', 620);
  await page.evaluate(() => window.releasePngBlob());
  const download = await pending;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toBe('wavebench-double-532nm.png');
});

test('the mobile bench stays within the viewport and accepts touch drawing @mobile', async ({ page }) => {
  await openBench(page);
  for (const preset of ['double', 'vortex', 'custom']) {
    await selectPreset(page, preset);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.locator('#aperture').tap({ position: { x: 55, y: 55 } });
  await ready(page);
  expect(parseFloat(await page.locator('#area-value').textContent())).toBeGreaterThan(0);
  await expect(page.locator('#draw-overlay')).toBeHidden();
  await page.locator('#language').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

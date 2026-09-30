import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const presets = [
  'gaussian',
  'single',
  'double',
  'grating',
  'circle',
  'annulus',
  'vortex',
  'custom',
];
const methods = ['angular-spectrum', 'fresnel', 'fraunhofer'];
const exports = ['exportPng', 'exportCsv', 'exportGrid', 'exportManifest', 'saveSession'];

async function ready(page) {
  await expect(page.locator('#status')).toHaveText(/^(Computation ready|计算已就绪)$/);
  await expect(page.locator('#exportPng')).toBeEnabled();
  await expect(page.locator('#notice')).not.toHaveClass(/error/);
}

async function openBench(page) {
  await page.goto('/');
  await ready(page);
}

async function select(page, id, value) {
  await page.locator(`#${id}`).selectOption(String(value));
  await ready(page);
  await expect(page.locator(`#${id}`)).toHaveValue(String(value));
}

async function range(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await ready(page);
  await expect(page.locator(`#${id}`)).toHaveValue(String(value));
}

async function canvasHash(page, id) {
  return page.locator(`#${id}`).evaluate((canvas) => {
    const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
    return hash >>> 0;
  });
}

async function canvasClear(page, id) {
  return page.locator(`#${id}`).evaluate((canvas) =>
    canvas
      .getContext('2d')
      .getImageData(0, 0, canvas.width, canvas.height)
      .data.every((value) => value === 0),
  );
}

async function download(page, id) {
  const pending = page.waitForEvent('download');
  await page.locator(`#${id}`).click();
  const file = await pending;
  expect(await file.failure()).toBeNull();
  return { filename: file.suggestedFilename(), bytes: await readFile(await file.path()) };
}

function readCsv(bytes, header) {
  const [first, ...lines] = bytes.toString('utf8').trim().split('\n');
  expect(first).toBe(header);
  const columns = header.split(',').length;
  const rows = lines.map((line) => line.split(',').map(Number));
  expect(rows.every((row) => row.length === columns && row.every(Number.isFinite))).toBe(true);
  return rows;
}

async function clipboard(page, blocked = false) {
  await page.addInitScript((block) => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          if (block) throw new DOMException('Clipboard blocked', 'NotAllowedError');
          window.copiedExperimentLink = text;
        },
      },
    });
  }, blocked);
}

for (const method of methods) {
  test(`all eight sources compute finite fields with ${method}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await openBench(page);
    await select(page, 'gridSize', 256);
    await select(page, 'method', method);
    for (const preset of presets) {
      await select(page, 'preset', preset);
      const input = Number(await page.locator('#power-in').textContent());
      const output = Number(await page.locator('#power-out').textContent());
      expect(Number.isFinite(input) && Number.isFinite(output)).toBe(true);
      if (preset === 'custom') {
        expect(input).toBe(0);
        expect(output).toBe(0);
        await expect(page.locator('#notice')).toContainText('Empty input');
      } else {
        expect(input).toBeGreaterThan(0);
        expect(Math.abs(output / input - 1)).toBeLessThan(0.00002);
      }
      await expect(page.locator('#output-span')).toContainText('256 samples');
      await expect(page.locator('#beam-radius')).not.toContainText(/NaN|Infinity|—/);
      if (preset !== 'gaussian') {
        await expect(page.locator('#beam-radius + small')).not.toContainText('paraxial');
      }
      await expect(page.locator('#diagnostics')).not.toBeEmpty();
      for (const id of ['aperture', 'diffraction', 'phase']) {
        expect(
          await page.locator(`#${id}`).evaluate((canvas) => {
            const pixels = canvas
              .getContext('2d')
              .getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 255) return false;
            return true;
          }),
        ).toBe(true);
      }
    }
    if (method === 'fraunhofer') {
      await expect(page.locator('#compare')).toBeDisabled();
      await expect(page.locator('#runScan')).toBeDisabled();
    }
    expect(errors).toEqual([]);
  });
}

test('Gaussian propagation matches the beam-radius formula and compares near-field models', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const postMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, transfer) {
      if (message.kind === 'compare') {
        window.releaseComparison = () => postMessage.call(this, message, transfer);
      } else return postMessage.call(this, message, transfer);
    };
  });
  await openBench(page);
  const expectedRadius = 0.2 * Math.hypot(1, ((532 / 1e6) * 250) / (Math.PI * 0.2 ** 2));
  const measuredRadius = parseFloat(await page.locator('#beam-radius').textContent());
  expect(Math.abs(measuredRadius / expectedRadius - 1)).toBeLessThan(0.002);
  expect(Number(await page.locator('#power-in').textContent())).toBeCloseTo(
    (Math.PI * 0.2 ** 2) / 2,
    6,
  );
  const image = await canvasHash(page, 'diffraction');
  await page.locator('#compare').click();
  await expect.poll(() => page.evaluate(() => typeof window.releaseComparison)).toBe('function');
  await page.locator('#displayMode').selectOption('linear');
  await page.locator('#viewSpanMm').selectOption('4');
  await page.evaluate(() => window.releaseComparison());
  await ready(page);
  await expect(page.locator('#comparison')).toBeVisible();
  const values = (await page.locator('#comparison').textContent())
    .match(/= ([\d.e+-]+)/g)
    .map((value) => Number(value.slice(2)));
  expect(values[0]).toBeGreaterThan(0);
  expect(values[0]).toBeLessThan(0.0001);
  expect(values[1]).toBeLessThan(0.0001);
  expect(await canvasHash(page, 'diffraction')).not.toBe(image);
  await expect(page.locator('#legend-left')).toHaveText('0');
  await expect(page.locator('#chart-left')).toHaveText('−2.000');
  await range(page, 'distanceMm', 500);
  const propagatedRadius = parseFloat(await page.locator('#beam-radius').textContent());
  expect(propagatedRadius).toBeGreaterThan(measuredRadius);
  await expect(page.locator('#comparison')).toBeHidden();
});

test('native-grid CSV integrates to the reported power and agrees with the result manifest', async ({
  page,
}) => {
  await openBench(page);
  await select(page, 'gridSize', 256);
  const reported = Number(await page.locator('#power-out').textContent());
  const field = await download(page, 'exportGrid');
  expect(field.filename).toBe('wavebench-gaussian-angular-spectrum-532nm-field.csv');
  const rows = readCsv(field.bytes, 'x_mm,y_mm,intensity,normalized_intensity,phase_rad');
  expect(rows).toHaveLength(256 * 256);
  const pitch = 8 / 256;
  expect(rows[0][0]).toBe(-4);
  expect(rows[0][1]).toBe(-4);
  expect(rows[1][0] - rows[0][0]).toBe(pitch);
  expect(rows[256][1] - rows[0][1]).toBe(pitch);
  expect(
    rows.every(
      ([, , intensity, normalized, phase]) =>
        intensity >= 0 &&
        normalized >= 0 &&
        normalized <= 1.000001 &&
        Math.abs(phase) <= Math.PI + 0.000001,
    ),
  ).toBe(true);
  const integrated = rows.reduce((sum, row) => sum + row[2], 0) * pitch ** 2;
  expect(Math.abs(integrated / reported - 1)).toBeLessThan(0.00001);
  const manifest = JSON.parse((await download(page, 'exportManifest')).bytes.toString('utf8'));
  expect(manifest.version).toBe(2);
  expect(manifest.model).toBe('angular-spectrum');
  expect(manifest.grid.size).toBe(256);
  expect(manifest.grid.outputPitchMm).toBe(pitch);
  expect(manifest.units.coordinates).toBe('mm');
  expect(manifest.units.phase).toBe('rad');
  expect(manifest.params.distanceMm).toBe(250);
  expect(Math.abs(integrated / manifest.power.output - 1)).toBeLessThan(1e-10);
  expect(Math.abs(manifest.power.relativeChange)).toBeLessThan(1e-10);
});

test('linear and log displays change only the image, preserving numerical section exports', async ({
  page,
}) => {
  await openBench(page);
  const before = await download(page, 'exportCsv');
  const raw = readCsv(before.bytes, 'x_mm,intensity,normalized_intensity,phase_rad');
  expect(raw.length).toBeGreaterThan(100);
  expect(raw.find(([x]) => x === 0)[1]).toBeLessThan(1);
  expect(raw.find(([x]) => x === 0)[2]).toBeCloseTo(1, 8);
  const image = await canvasHash(page, 'diffraction');
  const input = await canvasHash(page, 'aperture');
  const phase = await canvasHash(page, 'phase');
  const profile = await canvasHash(page, 'profile');
  const power = await page.locator('#power-out').textContent();
  await page.locator('#displayMode').selectOption('linear');
  await expect(page.locator('#legend-left')).toHaveText('0');
  expect(await canvasHash(page, 'diffraction')).not.toBe(image);
  expect(await canvasHash(page, 'aperture')).toBe(input);
  expect(await canvasHash(page, 'phase')).toBe(phase);
  expect(await canvasHash(page, 'profile')).toBe(profile);
  await expect(page.locator('#power-out')).toHaveText(power);
  expect((await download(page, 'exportCsv')).bytes.equals(before.bytes)).toBe(true);
  await page.locator('#viewSpanMm').selectOption('8');
  const wider = readCsv(
    (await download(page, 'exportCsv')).bytes,
    'x_mm,intensity,normalized_intensity,phase_rad',
  );
  expect(wider.length).toBeGreaterThan(raw.length);
  for (const row of raw) expect(wider.find(([x]) => x === row[0])).toEqual(row);
});

test('custom masks resize, import image amplitude, and reproduce fields from v2 JSON', async ({
  page,
}) => {
  await openBench(page);
  await select(page, 'gridSize', 256);
  await select(page, 'preset', 'custom');
  await range(page, 'beamWaistMm', 0);
  await expect(page.locator('#share')).toBeDisabled();
  await page.locator('#aperture').focus();
  await page.keyboard.press('Enter');
  await ready(page);
  expect(Number(await page.locator('#power-in').textContent())).toBeGreaterThan(0);
  await page.locator('#aperture').scrollIntoViewIfNeeded();
  const box = await page.locator('#aperture').boundingBox();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 6 });
  await page.mouse.up();
  await ready(page);
  const drawnPower = Number(await page.locator('#power-in').textContent());
  expect(drawnPower).toBeGreaterThan(0);
  await select(page, 'gridSize', 512);
  expect(Number(await page.locator('#power-in').textContent())).toBeCloseTo(drawnPower, 5);
  await select(page, 'gridSize', 1024);
  expect(Number(await page.locator('#power-in').textContent())).toBeCloseTo(drawnPower, 5);
  await select(page, 'gridSize', 256);
  const images = await Promise.all(
    ['aperture', 'diffraction', 'phase'].map((id) => canvasHash(page, id)),
  );
  const saved = await download(page, 'saveSession');
  expect(saved.filename).toBe('wavebench-custom.json');
  const parsed = JSON.parse(saved.bytes.toString('utf8'));
  expect(parsed.version).toBe(2);
  expect(parsed.params.gridSize).toBe(256);
  expect(Buffer.from(parsed.mask, 'base64')).toHaveLength(256 * 256);
  await page.locator('#clear').click();
  await ready(page);
  expect(Number(await page.locator('#power-in').textContent())).toBe(0);
  await page
    .locator('#sessionFile')
    .setInputFiles({ name: saved.filename, mimeType: 'application/json', buffer: saved.bytes });
  await ready(page);
  await expect(page.locator('#notice')).toHaveText('Experiment restored.');
  expect(
    await Promise.all(['aperture', 'diffraction', 'phase'].map((id) => canvasHash(page, id))),
  ).toEqual(images);
  const whitePng = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    canvas
      .getContext('2d')
      .putImageData(new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1), 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#maskFile').setInputFiles({
    name: 'white.png',
    mimeType: 'image/png',
    buffer: Buffer.from(whitePng, 'base64'),
  });
  await ready(page);
  await expect(page.locator('#notice')).toHaveText('Image imported as amplitude transmission.');
  expect(Number(await page.locator('#power-in').textContent())).toBeCloseTo(64, 8);
  expect(Number(await page.locator('#power-out').textContent())).toBeCloseTo(64, 8);
});

test('propagation sweeps export absolute intensity, global scaling, phases and physical distances', async ({
  page,
}) => {
  await openBench(page);
  await select(page, 'gridSize', 256);
  await page.locator('#scan-start').fill('10');
  await page.locator('#scan-stop').fill('410');
  await page.locator('#scan-steps').fill('5');
  await page.locator('#runScan').click();
  await expect(page.locator('#scan-status')).toHaveText('Sweep complete / 5 planes', {
    timeout: 20_000,
  });
  await expect(page.locator('#exportScan')).toBeEnabled();
  const rows = readCsv(
    (await download(page, 'exportScan')).bytes,
    'z_mm,x_mm,intensity,global_normalized_intensity,phase_rad',
  );
  expect(rows).toHaveLength(5 * 256);
  expect([...new Set(rows.map((row) => row[0]))]).toEqual([10, 110, 210, 310, 410]);
  expect(
    rows.every(
      ([, , intensity, normalized, phase]) =>
        intensity >= 0 &&
        normalized >= 0 &&
        normalized <= 1.000001 &&
        Math.abs(phase) <= Math.PI + 0.000001,
    ),
  ).toBe(true);
  const peak = Math.max(...rows.map((row) => row[2]));
  expect(rows.every((row) => Math.abs(row[3] - row[2] / peak) < 1e-10)).toBe(true);
  const centres = rows.filter(([, x]) => x === 0);
  expect(centres).toHaveLength(5);
  for (const [z, , intensity] of centres) {
    const expectedPeak = 1 / (1 + (((532 / 1e6) * z) / (Math.PI * 0.2 ** 2)) ** 2);
    expect(Math.abs(intensity - expectedPeak)).toBeLessThan(0.001);
  }
  expect(centres.at(-1)[3]).toBeLessThan(0.5);
  await range(page, 'distanceMm', 300);
  await expect(page.locator('#exportScan')).toBeDisabled();
  await expect(page.locator('#scan-status')).toHaveText('Parameters changed; rerun the sweep.');
  expect(await canvasClear(page, 'scan')).toBe(true);
});

test('invalid sweeps are rejected and a running sweep can be cancelled', async ({ page }) => {
  await openBench(page);
  await page.locator('#scan-start').fill('100');
  await page.locator('#scan-stop').fill('50');
  await page.locator('#runScan').click();
  await expect(page.locator('#notice')).toHaveClass(/error/);
  await expect(page.locator('#notice')).toContainText('0.1 ≤ start < stop ≤ 2000');
  await expect(page.locator('#cancelScan')).toBeHidden();
  await expect(page.locator('#exportScan')).toBeDisabled();
  await range(page, 'distanceMm', 260);
  await page.locator('#scan-start').fill('10');
  await page.locator('#scan-stop').fill('800');
  await page.locator('#scan-steps').fill('3');
  await page.locator('#runScan').click();
  await expect(page.locator('#scan-status')).toHaveText('Sweep complete / 3 planes');
  expect(await canvasClear(page, 'scan')).toBe(false);
  await page.locator('#scan-steps').fill('61');
  await page.locator('#runScan').click();
  await expect(page.locator('#cancelScan')).toBeVisible();
  await page.locator('#cancelScan').click();
  await expect(page.locator('#scan-status')).toHaveText('Sweep cancelled');
  await expect(page.locator('#cancelScan')).toBeHidden();
  await expect(page.locator('#runScan')).toBeEnabled();
  await expect(page.locator('#exportScan')).toBeDisabled();
  expect(await canvasClear(page, 'scan')).toBe(true);
});

test('snapshots and v2 share links preserve model, grid, geometry and display', async ({
  page,
}) => {
  await clipboard(page);
  await openBench(page);
  await select(page, 'preset', 'circle');
  await select(page, 'method', 'fresnel');
  await select(page, 'gridSize', 256);
  await range(page, 'beamWaistMm', 0.4);
  await range(page, 'distanceMm', 310);
  await range(page, 'wavelengthNm', 610);
  await page.locator('#displayMode').selectOption('linear');
  await page.locator('#viewSpanMm').selectOption('4');
  const image = await canvasHash(page, 'diffraction');
  const png = await download(page, 'exportPng');
  expect(png.filename).toBe('wavebench-circle-fresnel-610nm.png');
  expect([...png.bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(png.bytes.readUInt32BE(16)).toBe(1600);
  expect(png.bytes.readUInt32BE(20)).toBe(1100);
  expect(png.bytes.length).toBeGreaterThan(20_000);
  await page.locator('#share').click();
  await expect(page.locator('#notice')).toHaveText('Experiment link copied.');
  const url = await page.evaluate(() => window.copiedExperimentLink);
  expect(url).toBe(page.url());
  expect(new URL(url).hash).toContain('v=2');
  await page.goto(url);
  await ready(page);
  for (const [id, value] of Object.entries({
    preset: 'circle',
    method: 'fresnel',
    gridSize: '256',
    beamWaistMm: '0.4',
    distanceMm: '310',
    wavelengthNm: '610',
    displayMode: 'linear',
    viewSpanMm: '4',
  })) {
    await expect(page.locator(`#${id}`)).toHaveValue(value);
  }
  expect(await canvasHash(page, 'diffraction')).toBe(image);
  await page.goto('/#v=1&p=single&sw=0.225&w=600&f=700&m=log&z=4');
  await ready(page);
  await expect(page.locator('#method')).toHaveValue('fraunhofer');
  await expect(page.locator('#preset')).toHaveValue('single');
  await expect(page.locator('#wavelengthNm')).toHaveValue('600');
  await expect(page.locator('#focalLengthMm')).toHaveValue('700');
  await expect(page.locator('#beamWaistMm')).toHaveValue('0');
  await expect(page.locator('#gridSize')).toHaveValue('512');
});

test('blocked clipboard offers a selected link and invalid imports preserve the current field', async ({
  page,
}) => {
  await clipboard(page, true);
  await openBench(page);
  await page.locator('#share').click();
  await expect(page.locator('#linkDialog')).toBeVisible();
  await expect(page.locator('#linkFallback')).toHaveValue(page.url());
  expect(
    await page
      .locator('#linkFallback')
      .evaluate((input) => input.selectionStart === 0 && input.selectionEnd === input.value.length),
  ).toBe(true);
  await page.locator('#linkDialog button').click();
  const image = await canvasHash(page, 'diffraction');
  const power = await page.locator('#power-out').textContent();
  for (const content of [
    '{broken',
    JSON.stringify({ version: 999 }),
    JSON.stringify({
      version: 2,
      params: { preset: 'custom', gridSize: 256 },
      view: {},
      mask: 'AAAA',
    }),
  ]) {
    await page.locator('#sessionFile').setInputFiles({
      name: 'invalid.json',
      mimeType: 'application/json',
      buffer: Buffer.from(content),
    });
    await expect(page.locator('#notice')).toHaveClass(/error/);
    await expect(page.locator('#preset')).toHaveValue('gaussian');
    await expect(page.locator('#method')).toHaveValue('angular-spectrum');
    await expect(page.locator('#power-out')).toHaveText(power);
    expect(await canvasHash(page, 'diffraction')).toBe(image);
    await expect(page.locator('#exportPng')).toBeEnabled();
  }
});

test('pending and failed worker computations disable exports and can recover', async ({ page }) => {
  await page.addInitScript(() => {
    const postMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, transfer) {
      if (window.holdCompute)
        window.releaseCompute = () => postMessage.call(this, message, transfer);
      else if (window.failCompute)
        this.dispatchEvent(
          new MessageEvent('message', {
            data: { id: message.id, error: 'Injected computation failure' },
          }),
        );
      else return postMessage.call(this, message, transfer);
    };
  });
  await openBench(page);
  await page.evaluate(() => {
    window.holdCompute = true;
  });
  await page.locator('#distanceMm').evaluate((input) => {
    input.value = '400';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => typeof window.releaseCompute)).toBe('function');
  await expect(page.locator('#status')).toHaveText('Computing field…');
  for (const id of exports) await expect(page.locator(`#${id}`)).toBeDisabled();
  await page.locator('#displayMode').selectOption('linear');
  await page.locator('#language').click();
  for (const id of exports) await expect(page.locator(`#${id}`)).toBeDisabled();
  await page.evaluate(() => {
    window.holdCompute = false;
    window.releaseCompute();
  });
  await ready(page);
  await page.locator('#language').click();
  await page.evaluate(() => {
    window.failCompute = true;
  });
  await page.locator('#distanceMm').evaluate((input) => {
    input.value = '410';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#status')).toHaveText('Computation failed');
  await expect(page.locator('#notice')).toHaveClass(/error/);
  await expect(page.locator('#notice')).toHaveText('Injected computation failure');
  for (const id of exports) await expect(page.locator(`#${id}`)).toBeDisabled();
  for (const id of ['aperture', 'diffraction', 'phase', 'profile']) {
    expect(
      await page.locator(`#${id}`).evaluate((canvas) =>
        canvas
          .getContext('2d')
          .getImageData(0, 0, canvas.width, canvas.height)
          .data.every((value) => value === 0),
      ),
    ).toBe(true);
  }
  await page.evaluate(() => {
    window.failCompute = false;
  });
  await range(page, 'distanceMm', 420);
});

test('mobile controls fit the viewport, support touch masks and persist Chinese @mobile', async ({
  page,
}) => {
  await openBench(page);
  for (const preset of ['gaussian', 'vortex', 'custom']) {
    await select(page, 'preset', preset);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await range(page, 'beamWaistMm', 0);
  await page.locator('#aperture').tap({ position: { x: 55, y: 55 } });
  await ready(page);
  expect(Number(await page.locator('#power-in').textContent())).toBeGreaterThan(0);
  await page.locator('#language').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('#method')).toHaveValue('angular-spectrum');
});

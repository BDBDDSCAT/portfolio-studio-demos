import { readFile } from 'node:fs/promises';
import { test as base, expect } from '@playwright/test';

// Every case also verifies that numerical failures stay in the UI rather than
// escaping as browser exceptions or failed module/worker requests.
export const test = base.extend({
  browserHealth: [async ({ page }, use) => {
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => requests.push(`${request.url()}: ${request.failure()?.errorText}`));
    await use();
    expect(errors, 'uncaught browser errors').toEqual([]);
    expect(requests, 'failed browser requests').toEqual([]);
  }, { auto: true }],
});
export { expect };

export async function download(page, id) {
  const pending = page.waitForEvent('download');
  await page.locator(`#${id}`).click();
  const file = await pending;
  expect(await file.failure()).toBeNull();
  return { filename: file.suggestedFilename(), bytes: await readFile(await file.path()) };
}

export function parseCsv(bytes, header) {
  const [first, ...lines] = bytes.toString('utf8').trim().split(/\r?\n/);
  expect(first).toBe(header);
  return lines.map(line => line.split(',').map(cell => cell === '' ? null : Number(cell)));
}

export async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

export async function jsonDownload(page, id) {
  return JSON.parse((await download(page, id)).bytes.toString('utf8'));
}

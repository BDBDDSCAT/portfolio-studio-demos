import { createHash } from 'node:crypto';
import { test, expect, download, jsonDownload, noOverflow } from './helpers.js';

async function done(page, passed = true) {
  await expect(page.locator('#status-message')).toHaveText(new RegExp(`^${passed ? 'PASS' : 'FAIL'} ·`));
  await expect(page.locator('#download-json')).toBeEnabled();
}
async function open(page) { await page.goto('/runcheck/'); await done(page); }
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('Runcheck reports exact clean and broken fixture counts even when issue examples are capped', async ({ page }) => {
  await open(page);
  const clean = await jsonDownload(page, 'download-json');
  expect(clean.passed).toBe(true);
  expect(clean.counts).toEqual({ records: 6, columns: 5, issues: 0, invalidRecords: 0 });
  expect(clean.profiles.find(profile => profile.column === 'R').mean).toBeCloseTo(0.16, 12);
  await page.locator('#sample-broken').click();
  await done(page, false);
  const broken = await jsonDownload(page, 'download-json');
  expect(broken.counts).toEqual({ records: 6, columns: 5, issues: 5, invalidRecords: 4 });
  expect(broken.issueCounts).toEqual({ unique: 1, monotonic: 2, type: 1, sum: 1 });
  expect(broken.issues.find(issue => issue.code === 'unique').startLine).toBe(4);
  await page.locator('#max-issues').fill('1');
  await expect(page.locator('#download-json')).toBeDisabled();
  await page.locator('#audit-button').click();
  await done(page, false);
  const capped = await jsonDownload(page, 'download-json');
  expect(capped.counts).toEqual(broken.counts);
  expect(capped.issues).toHaveLength(1);
  expect(capped.issuesTruncated).toBe(true);
  await expect(page.locator('#issues-table tbody tr')).toHaveCount(1);
});

test('Runcheck imports explicit-delimiter files and hashes original BOM and CRLF bytes', async ({ page }) => {
  await open(page);
  const csv = Buffer.from('\uFEFFx;note\r\n1;"first\r\nsecond"\r\n2;last\r\n');
  const schema = Buffer.from(JSON.stringify({ version: 1, columns: { x: { type: 'integer' }, note: { type: 'string' } } }, null, 2) + '\r\n');
  await page.locator('#csv-file').setInputFiles({ name: 'original.csv', mimeType: 'text/csv', buffer: csv });
  await expect(page.locator('#input-meta')).toContainText('original.csv');
  await page.locator('#schema-file').setInputFiles({ name: 'original-schema.json', mimeType: 'application/json', buffer: schema });
  await expect(page.locator('#schema-meta')).toContainText('original-schema.json');
  await page.locator('#delimiter').selectOption('semicolon');
  await page.locator('#audit-button').click();
  await done(page);
  const report = await jsonDownload(page, 'download-json');
  expect(report.hashes.inputSha256).toBe(sha256(csv));
  expect(report.hashes.schemaSha256).toBe(sha256(schema));
  expect(report.delimiter).toBe(';');
  expect(report.counts.records).toBe(2);
  const profile = report.profiles.find(profile => profile.column === 'x');
  expect(profile.mean).toBe(1.5);
  expect(profile.stddev).toBeCloseTo(Math.SQRT1_2, 12);
  expect(profile.min).toBe(1);
  expect(profile.max).toBe(2);
  const html = await download(page, 'download-html');
  expect(html.filename).toBe('runcheck-report.html');
  expect(html.bytes.toString('utf8')).toContain(report.hashes.inputSha256);
  expect(html.bytes.toString('utf8')).toContain('PASS');
});

test('Runcheck preserves multiline source locations and exports escaped HTML for untrusted values', async ({ page }) => {
  await open(page);
  const schema = { version: 1, columns: { note: { type: 'string' }, x: { type: 'number', enum: [1] } } };
  await page.locator('#schema-input').fill(JSON.stringify(schema));
  await page.locator('#csv-input').fill('note,x\n"first\nsecond",1\n"<img src=x onerror=alert(1)>",2\n');
  await page.locator('#audit-button').click();
  await done(page, false);
  const report = await jsonDownload(page, 'download-json');
  expect(report.issues).toHaveLength(1);
  expect(report.issues[0]).toMatchObject({ record: 2, startLine: 4, column: 'x', code: 'enum' });
  await page.locator('#schema-input').fill(JSON.stringify({ version: 1, columns: { '<img src=x onerror=alert(1)>': { type: 'number' } } }));
  await page.locator('#csv-input').fill('<img src=x onerror=alert(1)>\nNaN\n');
  await page.locator('#audit-button').click();
  await done(page, false);
  const html = (await download(page, 'download-html')).bytes.toString('utf8');
  expect(html).toContain('&lt;img');
  expect(await page.evaluate(text => {
    const document = new DOMParser().parseFromString(text, 'text/html');
    return document.querySelectorAll('img, script').length;
  }, html)).toBe(0);
  await expect(page.locator('#issues-table img')).toHaveCount(0);
});

test('Runcheck hides stale reports after edits and rejects schema and CSV syntax errors', async ({ page }) => {
  await open(page);
  await page.locator('#schema-input').fill('{broken');
  await expect(page.locator('#report-area')).toBeHidden();
  await expect(page.locator('#download-json')).toBeDisabled();
  await page.locator('#audit-button').click();
  await expect(page.locator('#status-message')).toContainText('SchemaError');
  await expect(page.locator('#status-message')).toHaveClass('error');
  await page.locator('#schema-input').fill(JSON.stringify({ version: 1, columns: { x: { type: 'number' } } }));
  await page.locator('#csv-input').fill('x\n"unterminated');
  await page.locator('#audit-button').click();
  await expect(page.locator('#status-message')).toContainText('CSVParseError');
  await expect(page.locator('#download-html')).toBeDisabled();
  await page.locator('#sample-clean').click();
  await done(page);
  await expect(page.locator('#profiles-table tbody tr')).toHaveCount(5);
});

test('Runcheck mobile tables stay within the page and language survives reload @mobile', async ({ page }) => {
  await open(page);
  await noOverflow(page);
  await page.locator('#language').selectOption('zh');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('#audit-button')).toHaveText('检查数据');
  await page.locator('#sample-broken').click();
  await done(page, false);
  await noOverflow(page);
  await page.reload();
  await done(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await noOverflow(page);
});

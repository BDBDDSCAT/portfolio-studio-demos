import { test, expect, noOverflow } from './helpers.js';

test('the hub exposes four working instruments and preserves its language choice', async ({ page, request }) => {
  await page.goto('/tools/');
  const expected = ['wavebench', 'thinfilm', 'tracefit', 'runcheck'];
  await expect(page.locator('.tool')).toHaveCount(4);
  const links = page.locator('.tool h2 a');
  for (let index = 0; index < expected.length; index += 1) {
    const href = await links.nth(index).getAttribute('href');
    expect(href).toBe(`../${expected[index]}/`);
    const response = await request.get(new URL(href, page.url()).href);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain('<html');
  }
  await noOverflow(page);
  await page.locator('#language').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('h1')).toHaveText('计算光场。拟合光谱。检查实验。');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.locator('#language').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('the mobile hub shows all instruments in both languages without overflow @mobile', async ({ page }) => {
  await page.goto('/tools/');
  await expect(page.locator('.tool')).toHaveCount(4);
  await noOverflow(page);
  await page.locator('#language').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await noOverflow(page);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await noOverflow(page);
});

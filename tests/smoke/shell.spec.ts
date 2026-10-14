import { test, expect } from '@playwright/test';

for (const [width, columns] of [[360, 1], [767, 1], [768, 2], [1199, 2], [1200, 3], [1280, 3]] as const) {
  test(`shell and real Worker at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'План питания начинается здесь' })).toBeVisible();
    const button = page.getByRole('button', { name: 'Проверить Worker' });
    await expect(button).toHaveCSS('background-color', 'rgb(39, 99, 56)');
    expect(await button.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
    expect(await page.getByTestId('shell-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(columns);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await button.click();
    await expect(page.getByRole('status')).toHaveText('Worker готов · BigInt доступен');
    await button.click();
    await expect(page.getByRole('status')).toHaveText('Worker готов · BigInt доступен');
    await page.reload();
    await expect(page.getByRole('status')).toHaveText('Проверка ещё не запускалась');
    expect(errors).toEqual([]);
  });
}

test('failed Worker load can be retried', async ({ page }) => {
  await page.route('**/assets/probe.worker-*.js', (route) => route.abort());
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Проверить Worker' });
  await button.click();
  await expect(page.getByRole('status')).toHaveText('Не удалось связаться с Worker. Повторите проверку.', { timeout: 10000 });
  await expect(button).toBeEnabled();
  await page.unroute('**/assets/probe.worker-*.js');
  await button.click();
  await expect(page.getByRole('status')).toHaveText('Worker готов · BigInt доступен');
});

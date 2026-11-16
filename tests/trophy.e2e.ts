import { test, expect } from '@playwright/test';

test('an administrator can choose and remove a trophy image', async ({ page, request }) => {
  const name = `Trophy ${Date.now()}`;
  await request.post('/api/tournaments', { data: { name, pin: '1234' } });
  await page.goto('/');
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByLabel('Administrator PIN', { exact: true }).last().fill('1234');
  await page.getByRole('button', { name: 'Unlock setup' }).click();
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64');
  await page.getByLabel('Choose image').setInputFiles({ name: 'trophy.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByAltText('Current trophy')).toBeVisible();
  await page.getByRole('button', { name: 'Remove image' }).click();
  await expect(page.getByAltText('Current trophy')).toHaveCount(0);
});

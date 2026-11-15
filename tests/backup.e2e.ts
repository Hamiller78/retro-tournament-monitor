import { test, expect } from '@playwright/test';

test('downloads and restores a separate tournament copy', async ({ page }) => {
  const name = `Backup ${Date.now()}`;
  await page.goto('/');
  await page.getByLabel('Tournament name').fill(name);
  await page.getByLabel('Administrator PIN').fill('1234');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByLabel('Display name').fill('Racer');
  await page.getByLabel('Real name (optional)').fill('Alex');
  await page.getByRole('button', { name: 'Add participant' }).click();
  await expect(page.getByText('Racer').first()).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const download = await downloadEvent; const backupPath = await download.path();
  await page.getByLabel('Backup file').setInputFiles(backupPath);
  await page.getByLabel('Backup PIN').fill('1234');
  await page.getByRole('button', { name: 'Restore copy' }).click();
  await expect(page.getByRole('heading', { name: `${name} (restored)` })).toBeVisible();
  await expect(page.getByText('Racer').first()).toBeVisible();
  await expect(page.getByText('Alex', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
});

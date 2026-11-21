import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('organizer configures a fixed station game without confirmation', async ({ page, request }) => {
  const name = `Fixed game ${randomUUID()}`;
  const event = await (await request.post('/api/tournaments', { data: { name, pin: '1234' } })).json();
  const root = `/api/tournaments/${event.id}`, headers = { Authorization: `Bearer ${event.token}` };
  await request.post(`${root}/stages`, { headers, data: { name: 'Round', kind: 'two-station', participantCount: 1 } });
  await page.goto('/'); await page.getByRole('button', { name, exact: true }).click();
  await page.getByLabel('Administrator PIN', { exact: true }).last().fill('1234');
  await page.getByRole('button', { name: 'Unlock setup' }).click();
  await page.getByRole('button', { name: 'Game settings Round' }).click();
  await page.getByLabel('Number of stations').fill('1');
  await page.getByLabel('Game selection').selectOption('fixed');
  await page.getByRole('button', { name: 'Add game to station 1' }).click();
  await page.getByLabel('Game name', { exact: true }).fill('Pong');
  await page.getByRole('button', { name: 'Save game settings' }).click();
  const nav = page.getByRole('navigation', { name: 'Tournament views' });
  await nav.getByRole('button', { name: 'Game 1' }).click();
  await expect(page.getByRole('button', { name: 'Spin', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirm game' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Station 1 game' }).getByText('Pong')).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Wheel 2' })).toHaveCount(0);
  await nav.getByRole('button', { name: 'Setup', exact: true }).click();
  await page.getByRole('button', { name: 'Game settings Round' }).click();
  await expect(page.getByLabel('Number of stations')).toBeEnabled();
});

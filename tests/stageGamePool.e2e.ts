import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('an elimination stage can spin its own pool on the TV and play the selected game', async ({ page, request, browser }) => {
  const name = `Stage wheel ${randomUUID()}`;
  const event = await (await request.post('/api/tournaments', { data: { name, pin: '1234' } })).json();
  const root = `/api/tournaments/${event.id}`, headers = { Authorization: `Bearer ${event.token}` };
  for (const displayName of ['Alice', 'Bob']) await request.post(`${root}/participants`, { headers, data: { displayName } });
  const stage = (await (await request.post(`${root}/stages`, { headers, data: { name: 'Final', kind: 'elimination', participantCount: 2 } })).json()).id;
  await request.put(`${root}/stages/${stage}/settings`, { headers, data: { game: '', gameSelection: 'pool', gamePool: [{ name: 'Pong', developer: 'Atari' }] } });
  await page.goto('/'); await page.getByRole('button', { name, exact: true }).click();
  const tv = await browser.newPage(); await tv.goto(`/display/${event.id}`);
  await page.getByRole('navigation', { name: 'Tournament views' }).getByRole('button', { name: 'Final', exact: true }).click();
  await page.getByRole('button', { name: 'Choose game' }).click();
  await expect(tv.getByRole('region', { name: 'Final wheel' })).toBeVisible();
  await page.getByRole('button', { name: 'Spin', exact: true }).click();
  await expect(page.getByText('Drawn: Pong')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm game' }).click();
  await expect(tv.getByText('Selected: Pong')).toBeVisible();
  await expect(tv.getByRole('region', { name: 'Selected game information' })).toContainText('Atari');
  await page.getByRole('button', { name: 'Hide game selection' }).click();
  await expect(tv.getByRole('region', { name: 'Final ranking' })).toBeVisible();
  await page.getByRole('button', { name: 'Eliminate Bob' }).click();
  await expect(tv.getByRole('main', { name: 'Tournament winner' }).getByText('Alice')).toBeVisible();
  await tv.close();
});

import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('third station has a wheel, TV view, and leaderboard column', async ({ page, request, browser }) => {
  const name = `Three stations ${randomUUID()}`;
  const event = await (await request.post('/api/tournaments', { data: { name, pin: '1234' } })).json();
  const root = `/api/tournaments/${event.id}`, headers = { Authorization: `Bearer ${event.token}` };
  await request.post(`${root}/participants`, { headers, data: { displayName: 'Alice' } });
  const stage = (await (await request.post(`${root}/stages`, { headers, data: { name: 'Round', kind: 'two-station', participantCount: 1 } })).json()).id;
  const stations = ['One', 'Two', 'Three'].map(name => ({ games: [{ name, resultKind: 'score', higherIsBetter: true, attempts: 1 }] }));
  expect((await request.put(`${root}/stages/${stage}/settings`, { headers, data: { stations, points: [1] } })).ok()).toBe(true);
  await page.goto('/'); await page.getByRole('button', { name, exact: true }).click();
  const tv = await browser.newPage(); await tv.goto(`/display/${event.id}`);
  const nav = page.getByRole('navigation', { name: 'Tournament views' });
  await nav.getByRole('combobox', { name: 'Station', exact: true }).selectOption('2');
  await nav.getByRole('button', { name: 'Wheel for selected station' }).click();
  await expect(tv.getByRole('region', { name: 'Station 3 wheel' })).toBeVisible();
  await page.getByRole('button', { name: 'Spin', exact: true }).click();
  await expect(page.getByText('Drawn: Three')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm game' }).click();
  await page.getByRole('button', { name: 'Leaderboard', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Station 3' })).toBeVisible();
  await tv.close();
});

import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('closes a complete round and displays qualifiers in the next stage', async ({ page, request }) => {
  const name = `Progress ${Date.now()}`;
  const created = await (await request.post('/api/tournaments', { data: { name, pin: '1234' } })).json();
  const root = `/api/tournaments/${created.id}`, headers = { Authorization: `Bearer ${created.token}` };
  const players: string[] = [];
  for (const displayName of ['Alice', 'Bob']) players.push((await (await request.post(`${root}/participants`, { headers, data: { displayName } })).json()).id);
  const first = (await (await request.post(`${root}/stages`, { headers, data: { name: 'First round', kind: 'two-station', participantCount: 2 } })).json()).id;
  await request.post(`${root}/stages`, { headers, data: { name: 'Semi-final', kind: 'elimination', participantCount: 1 } });
  const base = `${root}/stages/${first}`;
  await request.put(`${base}/settings`, { headers, data: { stations: [{ games: [{ name: 'Game one', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }, { games: [{ name: 'Game two', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }], points: [5, 2] } });
  for (const number of [0, 1]) {
    const station = `${base}/stations/${number}`, draw = await (await request.post(`${station}/spin`)).json();
    await request.post(`${station}/confirm`, { data: { drawId: draw.drawId } });
    const owner = { 'X-Station-Token': (await (await request.post(`${station}/claim`)).json()).token };
    for (let i = 0; i < players.length; i++) {
      await request.put(`${station}/active`, { headers: owner, data: { participantIds: [players[i]] } });
      await request.post(`${station}/attempts/batch`, { headers: owner, data: { requestId: randomUUID(), results: [{ participantId: players[i], value: i === 0 ? 100 : 50 }] } });
    }
  }
  await page.goto('/'); await page.getByRole('button', { name, exact: true }).click();
  await page.getByLabel('Administrator PIN', { exact: true }).last().fill('1234');
  await page.getByRole('button', { name: 'Unlock setup' }).click();
  await page.getByRole('button', { name: 'Progression', exact: true }).click();
  await page.getByRole('button', { name: 'Close First round' }).click();
  await expect(page.getByText('First round closed and players advanced.')).toBeVisible();
  const semi = page.locator('li').filter({ hasText: 'Semi-final' });
  await expect(semi.getByText('Active', { exact: true })).toBeVisible();
  await expect(semi.getByRole('listitem').filter({ hasText: /^Alice$/ })).toBeVisible();
  await expect(semi.getByText('Bob', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reopen First round' }).click();
  await expect(page.getByText('First round reopened.')).toBeVisible();
  await expect(semi.getByText('Waiting for previous stage')).toBeVisible();
});

import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('any station user can close each completed station and advance qualifiers', async ({ page, request }) => {
  const name = `Station close ${Date.now()}`;
  const created = await (await request.post('/api/tournaments', { data: { name, pin: '1234' } })).json();
  const root = `/api/tournaments/${created.id}`, admin = { Authorization: `Bearer ${created.token}` };
  const players: string[] = [];
  for (const displayName of ['Alice', 'Bob']) players.push((await (await request.post(`${root}/participants`, { headers: admin, data: { displayName } })).json()).id);
  const first = (await (await request.post(`${root}/stages`, { headers: admin, data: { name: 'Qualifiers', kind: 'two-station', participantCount: 2 } })).json()).id;
  await request.post(`${root}/stages`, { headers: admin, data: { name: 'Semi-final', kind: 'elimination', participantCount: 1 } });
  const base = `${root}/stages/${first}`;
  await request.put(`${base}/settings`, { headers: admin, data: { stations: [{ games: [{ name: 'One', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }, { games: [{ name: 'Two', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }], points: [5, 2] } });
  const owners: { 'X-Station-Token': string }[] = [];
  for (const n of [0, 1]) {
    const station = `${base}/stations/${n}`, draw = await (await request.post(`${station}/spin`)).json();
    await request.post(`${station}/confirm`, { data: { drawId: draw.drawId } });
    owners.push({ 'X-Station-Token': (await (await request.post(`${station}/claim`)).json()).token });
    for (let i = 0; i < players.length; i++) {
      if (n === 0 && i === 1) continue;
      await request.put(`${station}/active`, { headers: owners[n], data: { participantIds: [players[i]] } });
      await request.post(`${station}/attempts/batch`, { headers: owners[n], data: { requestId: randomUUID(), results: [{ participantId: players[i], value: i === 0 ? 100 : 50 }] } });
    }
  }
  await page.goto('/'); await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: 'Station 1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close station' })).toBeDisabled();
  await expect(page.getByText('1 player still needs results at this station.')).toBeVisible();
  await request.put(`${base}/stations/0/active`, { headers: owners[0], data: { participantIds: [players[1]] } });
  await request.post(`${base}/stations/0/attempts/batch`, { headers: owners[0], data: { requestId: randomUUID(), results: [{ participantId: players[1], value: 50 }] } });
  await expect(page.getByRole('button', { name: 'Close station' })).toBeEnabled();
  await page.getByRole('button', { name: 'Close station' }).click();
  await expect(page.getByText('Waiting for the other station.')).toBeVisible();
  await page.getByRole('button', { name: 'Station 2', exact: true }).click();
  await page.getByRole('button', { name: 'Close station' }).click();
  await expect(page.getByText('Station closed. The stage is complete and the players have advanced.')).toBeVisible();
  await page.getByRole('button', { name: 'Progression', exact: true }).click();
  const semi = page.locator('li').filter({ has: page.getByText('2. Semi-final', { exact: true }) });
  await expect(semi.getByText('Active', { exact: true })).toBeVisible();
  await expect(semi.getByRole('listitem').filter({ hasText: /^Alice$/ })).toBeVisible();
});

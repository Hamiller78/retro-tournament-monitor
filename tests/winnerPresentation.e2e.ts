import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('celebrates a scoring final decided by a tie-breaker on another view', async ({ page, request }) => {
  const name = `Progress ${Date.now()}`;
  const created = await (await request.post('/api/tournaments', { data: { name, pin: '1234' } })).json();
  const root = `/api/tournaments/${created.id}`, headers = { Authorization: `Bearer ${created.token}` };
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=';
  expect((await request.put(`${root}/trophy`, { headers, data: { image } })).ok()).toBe(true);
  const players: string[] = [];
  for (const displayName of ['Alice', 'Bob', 'Cara']) players.push((await (await request.post(`${root}/participants`, { headers, data: { displayName } })).json()).id);
  const first = (await (await request.post(`${root}/stages`, { headers, data: { name: 'First round', kind: 'two-station', participantCount: 3 } })).json()).id;
  const tie = (await (await request.post(`${root}/stages`, { headers, data: { name: 'Tie-breaker', kind: 'tie-breaker', participantCount: null } })).json()).id;
  await request.put(`${root}/stages/${tie}/settings`, { headers, data: { game: 'Pong' } });
  const base = `${root}/stages/${first}`;
  await request.put(`${base}/settings`, { headers, data: { stations: [{ games: [{ name: 'Game one', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }, { games: [{ name: 'Game two', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }], points: [5, 2] } });
  for (const number of [0, 1]) {
    const station = `${base}/stations/${number}`, draw = await (await request.post(`${station}/spin`)).json();
    await request.post(`${station}/confirm`, { data: { drawId: draw.drawId } });
    const owner = { 'X-Station-Token': (await (await request.post(`${station}/claim`)).json()).token };
    for (let i = 0; i < players.length; i++) {
      await request.put(`${station}/active`, { headers: owner, data: { participantIds: [players[i]] } });
      await request.post(`${station}/attempts/batch`, { headers: owner, data: { requestId: randomUUID(), results: [{ participantId: players[i], value: i < 2 ? 100 : 50 }] } });
    }
  }
  const tv = await page.context().browser()!.newPage();
  await tv.goto(`/display/${created.id}`);
  await expect(tv.getByRole('main', { name: 'Tournament winner' })).toHaveCount(0);
  await page.goto('/'); await page.getByRole('button', { name, exact: true }).click();
  const monitor = await page.context().browser()!.newPage();
  await monitor.goto('/'); await monitor.getByRole('button', { name, exact: true }).click();
  const monitorNav = monitor.getByRole('navigation', { name: 'Tournament views' });
  await monitorNav.getByRole('button', { name: 'Leaderboard', exact: true }).click();
  await expect(monitor.getByRole('dialog', { name: 'We have a winner!' })).toHaveCount(0);
  await request.post(`${base}/stations/0/close`); await request.post(`${base}/stations/1/close`);
  const nav = page.getByRole('navigation', { name: 'Tournament views' });
  await nav.getByRole('button', { name: 'Tie-breaker', exact: true }).click();
  await page.getByRole('button', { name: 'Winner Bob' }).click();
  const celebration = monitor.getByRole('dialog', { name: 'We have a winner!' });
  await expect(celebration.getByText('Bob', { exact: true })).toBeVisible();
  await expect(celebration.getByAltText('Tournament trophy')).toBeVisible();
  await expect(tv.getByRole('main', { name: 'Tournament winner' }).getByText('Bob')).toBeVisible();
  await expect(tv.getByAltText('Tournament trophy')).toBeVisible();
  await tv.reload();
  await expect(tv.getByRole('main', { name: 'Tournament winner' }).getByText('Bob')).toBeVisible();
  await tv.close();
  await celebration.getByRole('button', { name: 'Continue' }).click();
  await expect(monitor.getByRole('button', { name: 'Tournament winner: Bob' })).toBeVisible();
  await monitor.close();
});

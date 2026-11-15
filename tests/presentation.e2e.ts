import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('marks qualifying places and a contested cutoff', async ({ page, request }) => {
  const name = `Progress ${Date.now()}`;
  const created = await (await request.post('/api/tournaments', { data: { name, pin: '1234' } })).json();
  const root = `/api/tournaments/${created.id}`, headers = { Authorization: `Bearer ${created.token}` };
  const players: string[] = [];
  for (const displayName of ['Alice', 'Bob', 'Cara']) players.push((await (await request.post(`${root}/participants`, { headers, data: { displayName } })).json()).id);
  const first = (await (await request.post(`${root}/stages`, { headers, data: { name: 'First round', kind: 'two-station', participantCount: 3 } })).json()).id;
  const tie = (await (await request.post(`${root}/stages`, { headers, data: { name: 'Tie-breaker', kind: 'tie-breaker', participantCount: null } })).json()).id;
  await request.put(`${root}/stages/${tie}/settings`, { headers, data: { game: 'Pong' } });
  await request.post(`${root}/stages`, { headers, data: { name: 'Semi-final', kind: 'elimination', participantCount: 2 } });
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
  const nav = page.getByRole('navigation', { name: 'Tournament views' });
  await nav.getByRole('button', { name: 'Leaderboard', exact: true }).click();
  const board = page.getByRole('region', { name: 'Combined leaderboard' });
  await expect(board.getByText('Qualifying place', { exact: true })).toHaveCount(1);
  await expect(board.getByText('Tie at cutoff', { exact: true })).toHaveCount(2);
  await request.post(`${base}/stations/0/close`); await request.post(`${base}/stations/1/close`);
  await nav.getByRole('button', { name: 'Tie-breaker', exact: true }).click();
  await page.getByRole('button', { name: 'Winner Cara' }).click();
  await expect(page.getByText('Tie-breaker order')).toBeVisible();
  await page.getByRole('button', { name: 'Close Tie-breaker' }).click();
  await nav.getByRole('button', { name: 'Leaderboard', exact: true }).click();
  await expect(board.getByText('Qualifiers confirmed')).toBeVisible();
  await expect(board.getByText('Qualified', { exact: true })).toHaveCount(2);
  await expect(board.getByText('Tie at cutoff', { exact: true })).toHaveCount(0);
});

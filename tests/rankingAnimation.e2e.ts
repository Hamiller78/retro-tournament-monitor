import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function recordAnimations(page: Page) {
  await page.addInitScript(() => {
    const observed = window as unknown as { rankingAnimations: string[] };
    observed.rankingAnimations = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      if (this instanceof HTMLTableRowElement && this.dataset.rankingId && Array.isArray(keyframes) && keyframes.some(frame => 'transform' in frame)) observed.rankingAnimations.push(this.dataset.rankingId);
      return animate.call(this, keyframes, options);
    };
  });
}

test('slides ranking rows and highlights changed scores, including without a rank change', async ({ browser, page, request }) => {
  const name = `Animation ${randomUUID()}`;
  const event = await (await request.post('/api/tournaments', { data: { name, pin: '1234' } })).json();
  const root = `/api/tournaments/${event.id}`, admin = { Authorization: `Bearer ${event.token}` };
  const players: string[] = [];
  for (const displayName of ['Alice', 'Bob']) players.push((await (await request.post(`${root}/participants`, { headers: admin, data: { displayName } })).json()).id);
  const stage = (await (await request.post(`${root}/stages`, { headers: admin, data: { name: 'Round', kind: 'two-station', participantCount: 2 } })).json()).id;
  await request.post(`${root}/stages`, { headers: admin, data: { name: 'Final', kind: 'elimination', participantCount: 1 } });
  const base = `${root}/stages/${stage}`, station = `${base}/stations/0`;
  await request.put(`${base}/settings`, { headers: admin, data: { stations: [{ games: [{ name: 'Arcade', resultKind: 'score', higherIsBetter: true, attempts: 3 }] }, { games: [] }], points: [5, 2] } });
  const draw = (await (await request.post(`${station}/spin`)).json()).drawId;
  await request.post(`${station}/confirm`, { data: { drawId: draw } });
  const owner = { 'X-Station-Token': (await (await request.post(`${station}/claim`)).json()).token };
  async function add(player: string, value: number) {
    await request.put(`${station}/active`, { headers: owner, data: { participantIds: [player] } });
    expect((await request.post(`${station}/attempts/batch`, { headers: owner, data: { requestId: randomUUID(), results: [{ participantId: player, value }] } })).ok()).toBeTruthy();
  }
  await add(players[0], 100); await add(players[1], 50);
  await recordAnimations(page);
  const monitor = await browser.newPage(); await recordAnimations(monitor);
  for (const screen of [page, monitor]) { await screen.goto('/'); await screen.getByRole('button', { name, exact: true }).click(); }
  await page.getByRole('button', { name: 'Leaderboard', exact: true }).click();
  await monitor.getByRole('button', { name: 'Station 1', exact: true }).click();
  const board = page.getByRole('region', { name: 'Combined leaderboard' });
  const stationView = monitor.getByRole('region', { name: 'Station 1 results' });
  await expect(board.getByRole('row', { name: /Alice/ })).toBeVisible();
  await expect(stationView.getByRole('row', { name: /Bob/ })).toBeVisible();
  await expect(board.locator('[data-ranking-updated]')).toHaveCount(0);
  await expect(stationView.locator('[data-ranking-updated]')).toHaveCount(0);
  await expect(board.getByRole('row', { name: /Alice/ })).toHaveCSS('background-color', 'rgb(20, 53, 47)');
  await expect(board.getByRole('row', { name: /Bob/ })).toHaveCSS('background-color', 'rgb(22, 23, 53)');
  await add(players[1], 200);
  await expect(board.getByRole('row', { name: /Bob/ })).toHaveAttribute('data-ranking-updated', 'true');
  await expect(stationView.getByRole('row', { name: /Bob/ })).toHaveAttribute('data-ranking-updated', 'true');
  await expect(board.locator('tbody tr').first()).toContainText('Bob');
  await expect(stationView.locator('tbody tr').first()).toContainText('Bob');
  await expect.poll(() => page.evaluate(() => (window as unknown as { rankingAnimations: string[] }).rankingAnimations)).toContain(players[1]);
  await expect.poll(() => monitor.evaluate(() => (window as unknown as { rankingAnimations: string[] }).rankingAnimations)).toContain(players[1]);
  await expect(board.locator('[data-ranking-updated]')).toHaveCount(0, { timeout: 4000 });
  await expect(stationView.locator('[data-ranking-updated]')).toHaveCount(0, { timeout: 4000 });
  await expect(board.getByRole('row', { name: /Bob/ })).toHaveCSS('background-color', 'rgb(20, 53, 47)');
  await expect(board.getByRole('row', { name: /Alice/ })).toHaveCSS('background-color', 'rgb(22, 23, 53)');
  await expect(board.getByRole('row', { name: /Bob/ })).toHaveCSS('filter', 'none');
  await expect(board.getByRole('row', { name: /Bob/ }).locator('td').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await monitor.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { (window as unknown as { rankingAnimations: string[] }).rankingAnimations = []; });
  await monitor.evaluate(() => { (window as unknown as { rankingAnimations: string[] }).rankingAnimations = []; });
  await add(players[1], 25);
  await expect(board.getByRole('row', { name: /Bob/ })).toHaveAttribute('data-ranking-updated', 'true');
  await expect(stationView.getByRole('row', { name: /Bob/ })).toHaveAttribute('data-ranking-updated', 'true');
  await expect(board.getByRole('row', { name: /Alice/ })).not.toHaveAttribute('data-ranking-updated');
  await expect(board.getByRole('row', { name: /Bob/ })).toHaveCSS('background-color', 'rgb(20, 53, 47)');
  await expect(board.getByRole('row', { name: /Bob/ }).locator('td').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  expect(await page.evaluate(() => (window as unknown as { rankingAnimations: string[] }).rankingAnimations)).toEqual([]);
  expect(await monitor.evaluate(() => (window as unknown as { rankingAnimations: string[] }).rankingAnimations)).toEqual([]);
  await monitor.close();
});

test('restores qualification colors after consecutive ranking changes', async ({ page, request }) => {
  const name = `Colors ${randomUUID()}`;
  const event = await (await request.post('/api/tournaments', { data: { name, pin: '1234' } })).json();
  const root = `/api/tournaments/${event.id}`, admin = { Authorization: `Bearer ${event.token}` }, players: string[] = [];
  for (const displayName of ['Alice', 'Bob']) players.push((await (await request.post(`${root}/participants`, { headers: admin, data: { displayName } })).json()).id);
  const stage = (await (await request.post(`${root}/stages`, { headers: admin, data: { name: 'Round', kind: 'two-station', participantCount: 2 } })).json()).id;
  await request.post(`${root}/stages`, { headers: admin, data: { name: 'Final', kind: 'elimination', participantCount: 1 } });
  const base = `${root}/stages/${stage}`, station = `${base}/stations/0`;
  await request.put(`${base}/settings`, { headers: admin, data: { stations: [{ games: [{ name: 'Arcade', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }, { games: [] }], points: [5, 2] } });
  const draw = (await (await request.post(`${station}/spin`)).json()).drawId; await request.post(`${station}/confirm`, { data: { drawId: draw } });
  const owner = { 'X-Station-Token': (await (await request.post(`${station}/claim`)).json()).token };
  for (const [index, player] of players.entries()) {
    await request.put(`${station}/active`, { headers: owner, data: { participantIds: [player] } });
    await request.post(`${station}/attempts/batch`, { headers: owner, data: { requestId: randomUUID(), results: [{ participantId: player, value: index ? 50 : 100 }] } });
  }
  await page.goto('/'); await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: 'Leaderboard', exact: true }).click();
  const board = page.getByRole('region', { name: 'Combined leaderboard' }), alice = board.getByRole('row', { name: /Alice/ }), bob = board.getByRole('row', { name: /Bob/ });
  await expect(alice).toHaveCSS('background-color', 'rgb(20, 53, 47)');
  expect((await request.put(`${station}/attempts/${players[1]}/1`, { headers: admin, data: { value: 200 } })).ok()).toBeTruthy();
  await expect(bob).toHaveAttribute('data-ranking-updated', 'true');
  expect((await request.put(`${station}/attempts/${players[0]}/1`, { headers: admin, data: { value: 250 } })).ok()).toBeTruthy();
  await expect(board.locator('tbody tr').first()).toContainText('Alice');
  await expect(board.locator('[data-ranking-updated]')).toHaveCount(0, { timeout: 5000 });
  await expect(alice).toHaveCSS('background-color', 'rgb(20, 53, 47)');
  await expect(bob).toHaveCSS('background-color', 'rgb(22, 23, 53)');
  for (const row of [alice, bob]) {
    await expect(row).toHaveCSS('filter', 'none');
    await expect(row.locator('td').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  }
});

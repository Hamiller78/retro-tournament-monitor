import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('shows the current stage and follows progression without controls', async ({ page, request }) => {
  const name = `Display ${randomUUID()}`;
  const event = await (await request.post('/api/tournaments', { data: { name, pin: '1234' } })).json();
  const root = `/api/tournaments/${event.id}`, headers = { Authorization: `Bearer ${event.token}` }, players: string[] = [];
  for (const displayName of ['Alice', 'Bob', 'Cara']) players.push((await (await request.post(`${root}/participants`, { headers, data: { displayName } })).json()).id);
  const add = async (name: string, kind: string, participantCount: number | null) => (await (await request.post(`${root}/stages`, { headers, data: { name, kind, participantCount } })).json()).id;
  const first = await add('Qualifiers', 'two-station', 3), tie = await add('Tie-breaker', 'tie-breaker', null), semi = await add('Semi-final', 'elimination', 2), final = await add('Final', 'duel', 2);
  const base = `${root}/stages/${first}`;
  await request.put(`${base}/settings`, { headers, data: { stations: [{ games: [{ name: 'Game one', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }, { games: [{ name: 'Game two', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }], points: [5, 2] } });
  await request.put(`${root}/stages/${tie}/settings`, { headers, data: { game: 'Pong' } });
  await request.put(`${root}/stages/${semi}/settings`, { headers, data: { game: 'Survival' } });
  await request.put(`${root}/stages/${final}/settings`, { headers, data: { game: 'Fighter', bestOf: 1 } });
  const stations = [];
  for (const n of [0, 1]) {
    const path = `${base}/stations/${n}`, draw = (await (await request.post(`${path}/spin`)).json()).drawId;
    await request.post(`${path}/confirm`, { data: { drawId: draw } });
    const owner = { 'X-Station-Token': (await (await request.post(`${path}/claim`)).json()).token };
    for (let i = 0; i < players.length; i++) { await request.put(`${path}/active`, { headers: owner, data: { participantIds: [players[i]] } }); await request.post(`${path}/attempts/batch`, { headers: owner, data: { requestId: randomUUID(), results: [{ participantId: players[i], value: i === 0 ? 100 : 50 }] } }); }
    stations.push(path);
  }
  await page.goto(`/display/${event.id}`);
  await expect(page.getByRole('heading', { name: 'Qualifiers' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Combined leaderboard' }).getByRole('row', { name: /Alice/ })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0); await expect(page.getByRole('button')).toHaveCount(0);
  expect((await request.put(`${stations[0]}/attempts/${players[0]}/1`, { headers, data: { value: 110 } })).ok()).toBeTruthy();
  await expect(page.getByRole('row', { name: /Alice/ })).toHaveAttribute('data-ranking-updated', 'true');
  await request.put(`${root}/display-view`, { data: { mode: 'wheel', stageId: first, station: 0 } });
  await expect(page.getByRole('region', { name: 'Station 1 wheel' })).toBeVisible();
  await request.post(`${stations[0]}/close`); await request.post(`${stations[1]}/close`);
  await expect(page.getByRole('heading', { name: 'Tie-breaker' })).toBeVisible();
  expect((await (await request.get(root)).json()).displayWheel).toBeNull();
  await expect(page.getByRole('region', { name: 'Tie-breaker ranking' }).getByText('Bob')).toBeVisible();
  await request.post(`${root}/stages/${tie}/outcome`, { data: { participantId: players[2], requestId: randomUUID() } });
  await expect(page.getByRole('row', { name: /Cara/ })).toContainText('1');
  await request.post(`${root}/stages/${tie}/close`);
  await expect(page.getByRole('heading', { name: 'Semi-final' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Alice/ })).toContainText('Playing');
  await request.post(`${root}/stages/${semi}/outcome`, { data: { participantId: players[2], requestId: randomUUID() } });
  await expect(page.getByRole('row', { name: /Alice/ })).toContainText('Winner');
  await request.post(`${root}/stages/${semi}/close`);
  await expect(page.getByRole('heading', { name: 'Final' })).toBeVisible();
  const resultId = randomUUID();
  await request.post(`${root}/stages/${final}/outcome`, { data: { participantId: players[0], requestId: resultId } });
  await expect(page.getByRole('main', { name: 'Tournament winner' }).getByText('Alice')).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('main', { name: 'Tournament winner' }).getByText('Alice')).toBeVisible();
  expect((await request.delete(`${root}/stages/${final}/outcome/${resultId}`, { headers })).ok()).toBe(true);
  await expect(page.getByRole('region', { name: 'Final ranking' })).toBeVisible();
  await request.post(`${root}/stages/${final}/outcome`, { data: { participantId: players[0], requestId: randomUUID() } });
  await expect(page.getByRole('main', { name: 'Tournament winner' }).getByText('Alice')).toBeVisible();
  await request.post(`${root}/stages/${final}/close`, { headers });
  await page.reload(); await expect(page.getByRole('main', { name: 'Tournament winner' }).getByText('Alice')).toBeVisible();
});

test('fits twenty participants on a 1080p display and links from setup', async ({ page, request }) => {
  const name = `Field ${randomUUID()}`;
  const event = await (await request.post('/api/tournaments', { data: { name, pin: '1234' } })).json();
  const root = `/api/tournaments/${event.id}`, headers = { Authorization: `Bearer ${event.token}` };
  await request.post(`${root}/stages`, { headers, data: { name: 'Qualifiers', kind: 'two-station', participantCount: 20 } });
  for (let i = 1; i <= 20; i++) await request.post(`${root}/participants`, { headers, data: { displayName: `Player ${i}` } });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/'); await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open TV display' })).toHaveAttribute('href', `/display/${event.id}`);
  await page.goto(`/display/${event.id}`);
  await expect(page.locator('tbody tr')).toHaveCount(20);
  const dimensions = await page.evaluate(() => ({ bottom: document.querySelector('tbody tr:last-child')!.getBoundingClientRect().bottom, height: window.innerHeight }));
  expect(dimensions.bottom).toBeLessThanOrEqual(dimensions.height);
});

import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function mockAudio(page: Page) {
  await page.addInitScript(() => {
    const tracked = window as unknown as { audioNotes: number[]; AudioContext: unknown };
    tracked.audioNotes = [];
    class FakeAudioContext {
      state = 'suspended'; currentTime = 0; destination = {};
      createGain() { return { gain: { value: 0, setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
      createOscillator() { return { type: '', frequency: { setValueAtTime(value: number) { tracked.audioNotes.push(value); } }, onended: null, connect() {}, disconnect() {}, start() {}, stop() {} }; }
      resume() { this.state = 'running'; return Promise.resolve(); }
      close() { this.state = 'closed'; return Promise.resolve(); }
    }
    tracked.AudioContext = FakeAudioContext;
  });
}
const notes = (page: Page) => page.evaluate(() => (window as unknown as { audioNotes: number[] }).audioNotes);

test('sound starts off per device and responds to wheel and new ranking results', async ({ browser, page, request }) => {
  await mockAudio(page);
  const other = await browser.newPage(); await mockAudio(other);
  const name = `Sound ${Date.now()}-${randomUUID()}`;
  const event = await (await request.post('/api/tournaments', { data: { name, pin: '1234' } })).json();
  const root = `/api/tournaments/${event.id}`, admin = { Authorization: `Bearer ${event.token}` };
  const player = (await (await request.post(`${root}/participants`, { headers: admin, data: { displayName: 'Player' } })).json()).id;
  const stage = (await (await request.post(`${root}/stages`, { headers: admin, data: { name: 'Qualifiers', kind: 'two-station', participantCount: null } })).json()).id;
  const base = `${root}/stages/${stage}`;
  const games = ['One', 'Two', 'Three', 'Four'].map(name => ({ name, resultKind: 'score', higherIsBetter: true, attempts: 2 }));
  await request.put(`${base}/settings`, { headers: admin, data: { stations: [{ games }, { games: [] }], points: [5, 3] } });
  await page.goto('/'); await page.getByRole('button', { name, exact: true }).click();
  await other.goto('/'); await other.getByRole('button', { name, exact: true }).click();
  await expect(page.getByLabel('Sound volume')).toHaveValue('0');
  await expect(other.getByLabel('Sound volume')).toHaveValue('0');
  await page.getByRole('button', { name: 'Enable sound' }).click();
  await expect(page.getByRole('button', { name: 'Mute sound' })).toBeVisible();
  await expect(page.getByLabel('Sound volume')).toHaveValue('30');
  await expect(other.getByLabel('Sound volume')).toHaveValue('0');
  await page.getByRole('button', { name: 'Wheel 1', exact: true }).click();
  const wheel = page.getByLabel('Station 1 wheel');
  await wheel.getByRole('button', { name: 'Spin', exact: true }).click();
  await expect(wheel.getByText('Spinning…')).toBeVisible();
  await expect(wheel.getByText(/^Drawn:/)).toBeVisible({ timeout: 8000 });
  const wheelNotes = await notes(page);
  expect(wheelNotes.filter(note => note === 550).length).toBeGreaterThan(2);
  expect(wheelNotes.slice(-3)).toEqual([523, 659, 784]);
  expect(await notes(other)).toEqual([]);
  await wheel.getByRole('button', { name: 'Confirm game' }).click();
  await page.getByRole('button', { name: 'Leaderboard', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Combined leaderboard' }).getByRole('cell', { name: 'Player' })).toBeVisible();
  const before = (await notes(page)).length;
  const station = `${base}/stations/0`, owner = { 'X-Station-Token': (await (await request.post(`${station}/claim`)).json()).token };
  await request.put(`${station}/active`, { headers: owner, data: { participantIds: [player] } });
  await request.post(`${station}/attempts/batch`, { headers: owner, data: { requestId: randomUUID(), results: [{ participantId: player, value: 100 }] } });
  await expect.poll(async () => (await notes(page)).length).toBe(before + 2);
  expect((await notes(page)).slice(-2)).toEqual([660, 880]);
  expect(await notes(other)).toEqual([]);
  const boardRefreshed = page.waitForResponse(async response => response.url().includes('/leaderboard') && response.ok() && (await response.json()).resultIds?.length === 2);
  await request.post(`${station}/attempts/batch`, { headers: owner, data: { requestId: randomUUID(), results: [{ participantId: player, value: 50 }] } });
  await boardRefreshed;
  expect((await notes(page)).length).toBe(before + 2);
  await page.reload(); await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByLabel('Sound volume')).toHaveValue('30');
  await expect(page.getByRole('button', { name: 'Enable sound' })).toBeVisible();
  await page.getByRole('button', { name: 'Enable sound' }).click();
  await expect(page.getByRole('button', { name: 'Mute sound' })).toBeVisible();
  await page.getByRole('button', { name: 'Mute sound' }).click();
  await expect(page.getByLabel('Sound volume')).toHaveValue('0');
  await other.close();
});

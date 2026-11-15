import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/src/app';

async function setup(tied: number, slots: number) {
  const app = await createApp(':memory:');
  const { id, token } = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Event', pin: '1234' } })).json();
  const root = `/api/tournaments/${id}`, admin = { authorization: `Bearer ${token}` };
  const names = ['Alice', 'Bob', 'Cara', 'Dana']; const players: string[] = [];
  for (const displayName of names.slice(0, tied + 1)) players.push((await app.inject({ method: 'POST', url: `${root}/participants`, headers: admin, payload: { displayName } })).json().id);
  const addStage = async (name: string, kind: string, participantCount: number | null) => (await app.inject({ method: 'POST', url: `${root}/stages`, headers: admin, payload: { name, kind, participantCount } })).json().id;
  const first = await addStage('Qualifiers', 'two-station', null), tie = await addStage('Tie-breaker', 'tie-breaker', null), next = await addStage('Second round', 'two-station', slots);
  const base = `${root}/stages/${first}`, tieBase = `${root}/stages/${tie}`;
  await app.inject({ method: 'PUT', url: `${base}/settings`, headers: admin, payload: { stations: [{ games: [{ name: 'One', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }, { games: [{ name: 'Two', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }], points: [5, 3, 1, 0] } });
  await app.inject({ method: 'PUT', url: `${tieBase}/settings`, headers: admin, payload: { game: 'Pong' } });
  for (const n of [0, 1]) {
    const station = `${base}/stations/${n}`, draw = (await app.inject({ method: 'POST', url: `${station}/spin` })).json();
    await app.inject({ method: 'POST', url: `${station}/confirm`, payload: { drawId: draw.drawId } });
    const owner = { 'x-station-token': (await app.inject({ method: 'POST', url: `${station}/claim` })).json().token };
    for (let i = 0; i < players.length; i++) {
      await app.inject({ method: 'PUT', url: `${station}/active`, headers: owner, payload: { participantIds: [players[i]] } });
      await app.inject({ method: 'POST', url: `${station}/attempts/batch`, headers: owner, payload: { requestId: randomUUID(), results: [{ participantId: players[i], value: 100 - i * 10 }] } });
    }
  }
  return { app, root, admin, players, first, tie, next, base, tieBase };
}
describe('replacement players', () => {
  it('adds the next eligible player, preserves them in backups and reverses an unused replacement', async () => {
    const f = await setup(3, 2);
    try {
      await f.app.inject({ method: 'POST', url: `${f.base}/stations/0/close` });
      expect((await f.app.inject({ method: 'POST', url: `${f.base}/stations/1/close` })).json().advanced).toBe(true);
      const withdraw = `${f.root}/participants/${f.players[1]}/withdrawal`;
      const result = await f.app.inject({ method: 'POST', url: withdraw, headers: f.admin });
      expect(result.statusCode).toBe(200); expect(result.json().replacementName).toBe('Cara');
      let details = (await f.app.inject({ method: 'GET', url: f.root })).json();
      expect(details.stages.find((s: { id: string }) => s.id === f.next).entrants.map((p: { displayName: string }) => p.displayName)).toEqual(['Alice', 'Bob', 'Cara']);
      const backup = (await f.app.inject({ method: 'GET', url: `${f.root}/backup`, headers: f.admin })).json();
      expect(backup.withdrawalReplacements).toHaveLength(1);
      const restored = await f.app.inject({ method: 'POST', url: '/api/tournaments/restore', payload: { backup, pin: '1234' } });
      expect(restored.statusCode).toBe(201);
      expect((await f.app.inject({ method: 'DELETE', url: withdraw, headers: f.admin })).statusCode).toBe(200);
      details = (await f.app.inject({ method: 'GET', url: f.root })).json();
      expect(details.stages.find((s: { id: string }) => s.id === f.next).entrants.map((p: { displayName: string }) => p.displayName)).toEqual(['Alice', 'Bob']);
    } finally { await f.app.close(); }
  });
  it('keeps a replacement with results until an administrator deletes them', async () => {
    const f = await setup(3, 2);
    try {
      await f.app.inject({ method: 'POST', url: `${f.base}/stations/0/close` });
      await f.app.inject({ method: 'POST', url: `${f.base}/stations/1/close` });
      const withdraw = `${f.root}/participants/${f.players[1]}/withdrawal`;
      await f.app.inject({ method: 'POST', url: withdraw, headers: f.admin });
      const second = `${f.root}/stages/${f.next}`, station = `${second}/stations/0`;
      const settings = { stations: [{ games: [{ name: 'Next', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }, { games: [] }], points: [5, 2] };
      await f.app.inject({ method: 'PUT', url: `${second}/settings`, headers: f.admin, payload: settings });
      const draw = (await f.app.inject({ method: 'POST', url: `${station}/spin` })).json();
      await f.app.inject({ method: 'POST', url: `${station}/confirm`, payload: { drawId: draw.drawId } });
      const owner = { 'x-station-token': (await f.app.inject({ method: 'POST', url: `${station}/claim` })).json().token };
      await f.app.inject({ method: 'PUT', url: `${station}/active`, headers: owner, payload: { participantIds: [f.players[2]] } });
      expect((await f.app.inject({ method: 'POST', url: `${station}/attempts/batch`, headers: owner, payload: { requestId: randomUUID(), results: [{ participantId: f.players[2], value: 42 }] } })).statusCode).toBe(201);
      expect((await f.app.inject({ method: 'DELETE', url: withdraw, headers: f.admin })).statusCode).toBe(409);
      expect((await f.app.inject({ method: 'DELETE', url: `${station}/attempts/${f.players[2]}/1`, headers: f.admin })).statusCode).toBe(200);
      expect((await f.app.inject({ method: 'DELETE', url: withdraw, headers: f.admin })).statusCode).toBe(200);
    } finally { await f.app.close(); }
  });
});

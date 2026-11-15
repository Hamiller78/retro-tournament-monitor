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
  const first = await addStage('Qualifiers', 'two-station', null), tie = await addStage('Tie-breaker', 'tie-breaker', null), next = await addStage('Semi-final', 'elimination', slots);
  const base = `${root}/stages/${first}`, tieBase = `${root}/stages/${tie}`;
  await app.inject({ method: 'PUT', url: `${base}/settings`, headers: admin, payload: { stations: [{ games: [{ name: 'One', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }, { games: [{ name: 'Two', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }], points: [5, 3, 1, 0] } });
  await app.inject({ method: 'PUT', url: `${tieBase}/settings`, headers: admin, payload: { game: 'Pong' } });
  for (const n of [0, 1]) {
    const station = `${base}/stations/${n}`, draw = (await app.inject({ method: 'POST', url: `${station}/spin` })).json();
    await app.inject({ method: 'POST', url: `${station}/confirm`, payload: { drawId: draw.drawId } });
    const owner = { 'x-station-token': (await app.inject({ method: 'POST', url: `${station}/claim` })).json().token };
    for (let i = 0; i < players.length; i++) {
      await app.inject({ method: 'PUT', url: `${station}/active`, headers: owner, payload: { participantIds: [players[i]] } });
      await app.inject({ method: 'POST', url: `${station}/attempts/batch`, headers: owner, payload: { requestId: randomUUID(), results: [{ participantId: players[i], value: i === 0 ? 100 : 50 }] } });
    }
  }
  return { app, root, admin, players, first, tie, next, base, tieBase };
}
describe('withdrawal during a tie-breaker', () => {
  it('keeps a recorded result, reactivates before closing, and advances when the tie disappears', async () => {
    const f = await setup(2, 2);
    try {
      await f.app.inject({ method: 'POST', url: `${f.base}/stations/0/close` });
      await f.app.inject({ method: 'POST', url: `${f.base}/stations/1/close` });
      expect((await f.app.inject({ method: 'POST', url: `${f.tieBase}/outcome`, payload: { participantId: f.players[1], requestId: randomUUID() } })).statusCode).toBe(201);
      const url = `${f.root}/participants/${f.players[1]}/withdrawal`;
      expect((await f.app.inject({ method: 'POST', url, headers: f.admin })).statusCode).toBe(200);
      let outcome = (await f.app.inject({ method: 'GET', url: `${f.tieBase}/outcome` })).json();
      expect(outcome.needsTie).toBe(false); expect(outcome.complete).toBe(true); expect(outcome.results).toHaveLength(1);
      const backup = (await f.app.inject({ method: 'GET', url: `${f.root}/backup`, headers: f.admin })).json();
      expect((await f.app.inject({ method: 'POST', url: '/api/tournaments/restore', payload: { backup, pin: '1234' } })).statusCode).toBe(201);
      expect((await f.app.inject({ method: 'DELETE', url, headers: f.admin })).statusCode).toBe(200);
      outcome = (await f.app.inject({ method: 'GET', url: `${f.tieBase}/outcome` })).json();
      expect(outcome.needsTie).toBe(true); expect(outcome.ranking[0]).toBe(f.players[1]);
      expect((await f.app.inject({ method: 'POST', url, headers: f.admin })).statusCode).toBe(200);
      expect((await f.app.inject({ method: 'POST', url: `${f.tieBase}/close` })).statusCode).toBe(200);
      const details = (await f.app.inject({ method: 'GET', url: f.root })).json();
      expect(details.stages.find((s: { id: string }) => s.id === f.next).entrants.map((p: { displayName: string }) => p.displayName)).toEqual(['Alice', 'Cara']);
    } finally { await f.app.close(); }
  });
  it('continues with the remaining tied players when the tie still affects advancement', async () => {
    const f = await setup(3, 2);
    try {
      await f.app.inject({ method: 'POST', url: `${f.base}/stations/0/close` });
      await f.app.inject({ method: 'POST', url: `${f.base}/stations/1/close` });
      expect((await f.app.inject({ method: 'POST', url: `${f.root}/participants/${f.players[1]}/withdrawal`, headers: f.admin })).statusCode).toBe(200);
      const outcome = (await f.app.inject({ method: 'GET', url: `${f.tieBase}/outcome` })).json();
      expect(outcome.needsTie).toBe(true); expect(outcome.eligibleIds).toEqual([f.players[2], f.players[3]]);
      expect((await f.app.inject({ method: 'POST', url: `${f.tieBase}/outcome`, payload: { participantId: f.players[3], requestId: randomUUID() } })).statusCode).toBe(201);
      expect((await f.app.inject({ method: 'POST', url: `${f.tieBase}/close` })).statusCode).toBe(200);
      const details = (await f.app.inject({ method: 'GET', url: f.root })).json();
      expect(details.stages.find((s: { id: string }) => s.id === f.next).entrants.map((p: { displayName: string }) => p.displayName)).toEqual(['Alice', 'Dana']);
    } finally { await f.app.close(); }
  });
});

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
describe('conditional tie-breakers', () => {
  it('activates only tied players, preserves state in backups, and advances the winner', async () => {
    const f = await setup(2, 2);
    try {
      let details = (await f.app.inject({ method: 'GET', url: f.root })).json();
      expect(details.stages.map((stage: { name: string }) => stage.name)).toEqual(['Qualifiers', 'Semi-final']);
      await f.app.inject({ method: 'POST', url: `${f.base}/stations/0/close` });
      const close = await f.app.inject({ method: 'POST', url: `${f.base}/stations/1/close` });
      expect(close.statusCode).toBe(200); expect(close.json().tieBreakerActivated).toBe(true);
      details = (await f.app.inject({ method: 'GET', url: f.root })).json();
      expect(details.stages.map((stage: { status: string }) => stage.status)).toEqual(['closed', 'active', 'pending']);
      expect(details.stages[1].entrants.map((person: { displayName: string }) => person.displayName)).toEqual(['Bob', 'Cara']);
      expect((await f.app.inject({ method: 'POST', url: `${f.tieBase}/close` })).statusCode).toBe(409);
      expect((await f.app.inject({ method: 'POST', url: `${f.tieBase}/outcome`, payload: { participantId: f.players[2], requestId: randomUUID() } })).statusCode).toBe(201);
      const saved = (await f.app.inject({ method: 'GET', url: `${f.root}/backup`, headers: f.admin })).json();
      expect(saved.tieResolutions).toHaveLength(1); expect(saved.stageResults).toHaveLength(1);
      const restored = await f.app.inject({ method: 'POST', url: '/api/tournaments/restore', payload: { backup: saved, pin: '1234' } });
      expect(restored.statusCode).toBe(201);
      const copyRoot = `/api/tournaments/${restored.json().id}`, copy = (await f.app.inject({ method: 'GET', url: copyRoot })).json();
      expect(copy.stages[1].status).toBe('active');
      expect((await f.app.inject({ method: 'POST', url: `${copyRoot}/stages/${copy.stages[1].id}/close` })).statusCode).toBe(200);
      const restoredAfter = (await f.app.inject({ method: 'GET', url: copyRoot })).json();
      expect(restoredAfter.stages[2].entrants.map((person: { displayName: string }) => person.displayName)).toEqual(['Alice', 'Cara']);
      expect((await f.app.inject({ method: 'POST', url: `${f.tieBase}/close` })).statusCode).toBe(200);
      details = (await f.app.inject({ method: 'GET', url: f.root })).json();
      expect(details.stages[2].entrants.map((person: { displayName: string }) => person.displayName)).toEqual(['Alice', 'Cara']);
      expect((await f.app.inject({ method: 'POST', url: `${f.base}/reopen`, headers: f.admin })).statusCode).toBe(409);
      expect((await f.app.inject({ method: 'POST', url: `${f.tieBase}/reopen`, headers: f.admin })).statusCode).toBe(200);
      const outcome = (await f.app.inject({ method: 'GET', url: `${f.tieBase}/outcome` })).json();
      expect((await f.app.inject({ method: 'PUT', url: `${f.tieBase}/outcome/${outcome.results[0].id}`, headers: f.admin, payload: { participantId: f.players[1] } })).statusCode).toBe(200);
      expect((await f.app.inject({ method: 'POST', url: `${f.tieBase}/close` })).statusCode).toBe(200);
      details = (await f.app.inject({ method: 'GET', url: f.root })).json();
      expect(details.stages[2].entrants.map((person: { displayName: string }) => person.displayName)).toEqual(['Alice', 'Bob']);
    } finally { await f.app.close(); }
  });
  it('uses the finishing order when three players contest two places', async () => {
    const f = await setup(3, 3);
    try {
      await f.app.inject({ method: 'POST', url: `${f.base}/stations/0/close` });
      expect((await f.app.inject({ method: 'POST', url: `${f.base}/stations/1/close` })).json().tieBreakerActivated).toBe(true);
      for (const participantId of [f.players[3], f.players[1], f.players[2]]) expect((await f.app.inject({ method: 'POST', url: `${f.tieBase}/outcome`, payload: { participantId, requestId: randomUUID() } })).statusCode).toBe(201);
      expect((await f.app.inject({ method: 'POST', url: `${f.tieBase}/close` })).statusCode).toBe(200);
      const details = (await f.app.inject({ method: 'GET', url: f.root })).json();
      expect(details.stages[2].entrants.map((person: { displayName: string }) => person.displayName)).toEqual(['Alice', 'Dana', 'Bob']);
    } finally { await f.app.close(); }
  });
});

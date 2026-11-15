import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/src/app';

describe('semifinal and final', () => {
  it('advances elimination order into a best-of-three final and restores its results', async () => {
    const app = await createApp(':memory:');
    try {
      const { id, token } = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Event', pin: '1234' } })).json();
      const root = `/api/tournaments/${id}`, admin = { authorization: `Bearer ${token}` };
      const players: string[] = [];
      for (const displayName of ['Alice', 'Bob', 'Cara']) players.push((await app.inject({ method: 'POST', url: `${root}/participants`, headers: admin, payload: { displayName } })).json().id);
      const makeStage = async (name: string, kind: string, participantCount: number) => (await app.inject({ method: 'POST', url: `${root}/stages`, headers: admin, payload: { name, kind, participantCount } })).json().id;
      const first = await makeStage('Round', 'two-station', 3), semi = await makeStage('Semi', 'elimination', 3), final = await makeStage('Final', 'duel', 2);
      const initial = `${root}/stages/${first}`;
      const settings = { stations: [{ games: [{ name: 'One', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }, { games: [{ name: 'Two', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }], points: [5, 3, 1] };
      await app.inject({ method: 'PUT', url: `${initial}/settings`, headers: admin, payload: settings });
      await app.inject({ method: 'PUT', url: `${root}/stages/${semi}/settings`, headers: admin, payload: { game: 'Survival' } });
      await app.inject({ method: 'PUT', url: `${root}/stages/${final}/settings`, headers: admin, payload: { game: 'Fighter', bestOf: 3 } });
      for (const number of [0, 1]) {
        const station = `${initial}/stations/${number}`, draw = (await app.inject({ method: 'POST', url: `${station}/spin` })).json();
        await app.inject({ method: 'POST', url: `${station}/confirm`, payload: { drawId: draw.drawId } });
        const owner = { 'x-station-token': (await app.inject({ method: 'POST', url: `${station}/claim` })).json().token };
        for (let i = 0; i < players.length; i++) { await app.inject({ method: 'PUT', url: `${station}/active`, headers: owner, payload: { participantId: players[i] } }); await app.inject({ method: 'POST', url: `${station}/attempts/batch`, headers: owner, payload: { requestId: randomUUID(), results: [{ participantId: players[i], value: 100 - i * 10 }] } }); }
      }
      expect((await app.inject({ method: 'POST', url: `${initial}/close`, headers: admin })).statusCode).toBe(200);
      const semiBase = `${root}/stages/${semi}`;
      const record = (url: string, participantId: string, requestId = randomUUID()) => app.inject({ method: 'POST', url: `${url}/outcome`, payload: { participantId, requestId } });
      expect((await app.inject({ method: 'POST', url: `${semiBase}/close` })).statusCode).toBe(409);
      const requestId = randomUUID(); expect((await record(semiBase, players[2], requestId)).statusCode).toBe(201);
      expect((await record(semiBase, players[2], requestId)).statusCode).toBe(200);
      const semiEntry = (await app.inject({ method: 'GET', url: `${semiBase}/outcome` })).json().results[0].id;
      expect((await app.inject({ method: 'PUT', url: `${semiBase}/outcome/${semiEntry}`, payload: { participantId: players[1] } })).statusCode).toBe(401);
      expect((await app.inject({ method: 'PUT', url: `${semiBase}/outcome/${semiEntry}`, headers: admin, payload: { participantId: players[1] } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'PUT', url: `${semiBase}/outcome/${semiEntry}`, headers: admin, payload: { participantId: players[2] } })).statusCode).toBe(200);
      expect((await record(semiBase, players[2])).statusCode).toBe(409);
      await record(semiBase, players[1]);
      const semiResult = (await app.inject({ method: 'GET', url: `${semiBase}/outcome` })).json();
      expect(semiResult.ranking).toEqual(players); expect(semiResult.complete).toBe(true);
      expect((await app.inject({ method: 'POST', url: `${semiBase}/close` })).statusCode).toBe(200);
      const finalBase = `${root}/stages/${final}`;
      let outcome = (await app.inject({ method: 'GET', url: `${finalBase}/outcome` })).json();
      expect(outcome.entrants.map((p: { displayName: string }) => p.displayName)).toEqual(['Alice', 'Bob']);
      await record(finalBase, players[1]); await record(finalBase, players[0]); await record(finalBase, players[0]);
      outcome = (await app.inject({ method: 'GET', url: `${finalBase}/outcome` })).json(); expect(outcome.complete).toBe(true); expect(outcome.ranking[0]).toBe(players[0]);
      expect((await app.inject({ method: 'PUT', url: `${finalBase}/outcome/${outcome.results[0].id}`, headers: admin, payload: { participantId: players[0] } })).statusCode).toBe(409);
      expect((await app.inject({ method: 'PUT', url: `${finalBase}/outcome/${outcome.results[2].id}`, headers: admin, payload: { participantId: players[1] } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'PUT', url: `${finalBase}/outcome/${outcome.results[2].id}`, headers: admin, payload: { participantId: players[0] } })).statusCode).toBe(200);
      expect((await record(finalBase, players[1])).statusCode).toBe(409);
      const done = await app.inject({ method: 'POST', url: `${finalBase}/close`, headers: admin }); expect(done.statusCode).toBe(200); expect(done.json().winnerId).toBe(players[0]);
      const backup = (await app.inject({ method: 'GET', url: `${root}/backup`, headers: admin })).json(); expect(backup.stageResults).toHaveLength(5);
      const restored = await app.inject({ method: 'POST', url: '/api/tournaments/restore', payload: { backup, pin: '1234' } }); expect(restored.statusCode).toBe(201);
      const copy = (await app.inject({ method: 'GET', url: `/api/tournaments/${restored.json().id}` })).json();
      const restoredFinal = (await app.inject({ method: 'GET', url: `/api/tournaments/${restored.json().id}/stages/${copy.stages[2].id}/outcome` })).json();
      expect(restoredFinal.complete).toBe(true); expect(restoredFinal.entrants.find((p: { id: string }) => p.id === restoredFinal.ranking[0]).displayName).toBe('Alice');
      expect((await app.inject({ method: 'POST', url: `${semiBase}/reopen`, headers: admin })).statusCode).toBe(409);
    } finally { await app.close(); }
  });
});

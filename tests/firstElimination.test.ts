import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/src/app';

describe('first-stage elimination', () => {
  it('includes all registered players, advances them, and preserves the stage in a backup', async () => {
    const app = await createApp(':memory:');
    try {
      const event = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Elimination', pin: '1234' } })).json();
      const root = `/api/tournaments/${event.id}`, headers = { authorization: `Bearer ${event.token}` }, players: string[] = [];
      for (const displayName of ['Alice', 'Bob', 'Cara']) players.push((await app.inject({ method: 'POST', url: `${root}/participants`, headers, payload: { displayName } })).json().id);
      const first = (await app.inject({ method: 'POST', url: `${root}/stages`, headers, payload: { name: 'First', kind: 'elimination', participantCount: 1 } })).json().id;
      const next = (await app.inject({ method: 'POST', url: `${root}/stages`, headers, payload: { name: 'Final', kind: 'duel', participantCount: 2 } })).json().id;
      await app.inject({ method: 'PUT', url: `${root}/stages/${first}/settings`, headers, payload: { game: 'Survival' } });
      const base = `${root}/stages/${first}`, before = (await app.inject({ method: 'GET', url: `${base}/outcome` })).json();
      expect(before.entrants.map((p: { id: string }) => p.id)).toEqual(players);
      const key = randomUUID(), firstResult = await app.inject({ method: 'POST', url: `${base}/outcome`, payload: { participantId: players[2], requestId: key } });
      expect(firstResult.statusCode).toBe(201);
      expect((await app.inject({ method: 'POST', url: `${base}/outcome`, payload: { participantId: players[2], requestId: key } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST', url: `${root}/participants`, headers, payload: { displayName: 'Late' } })).statusCode).toBe(409);
      expect((await app.inject({ method: 'POST', url: `${base}/outcome`, payload: { participantId: players[1], requestId: randomUUID() } })).statusCode).toBe(201);
      expect((await app.inject({ method: 'GET', url: `${root}/winner` })).json().winner).toBeNull();
      expect((await app.inject({ method: 'POST', url: `${base}/close` })).statusCode).toBe(200);
      const state = (await app.inject({ method: 'GET', url: root })).json();
      expect(state.stages.find((s: { id: string }) => s.id === next).entrants.map((p: { id: string }) => p.id)).toEqual([players[0], players[1]]);
      const backup = (await app.inject({ method: 'GET', url: `${root}/backup`, headers })).json();
      expect(backup.entrants.filter((e: { stageId: string }) => e.stageId === first)).toHaveLength(3);
      const restored = await app.inject({ method: 'POST', url: '/api/tournaments/restore', payload: { backup, pin: '1234' } });
      expect(restored.statusCode).toBe(201);
      const copy = (await app.inject({ method: 'GET', url: `/api/tournaments/${restored.json().id}` })).json();
      const outcome = (await app.inject({ method: 'GET', url: `/api/tournaments/${copy.id}/stages/${copy.stages[0].id}/outcome` })).json();
      expect(outcome.complete).toBe(true); expect(outcome.entrants).toHaveLength(3);
    } finally { await app.close(); }
  });
  it('saves participants when withdrawal decides the first and only stage without an elimination', async () => {
    const app = await createApp(':memory:');
    try {
      const event = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Two players', pin: '1234' } })).json();
      const root = `/api/tournaments/${event.id}`, headers = { authorization: `Bearer ${event.token}` };
      const alice = (await app.inject({ method: 'POST', url: `${root}/participants`, headers, payload: { displayName: 'Alice' } })).json().id;
      const bob = (await app.inject({ method: 'POST', url: `${root}/participants`, headers, payload: { displayName: 'Bob' } })).json().id;
      const first = (await app.inject({ method: 'POST', url: `${root}/stages`, headers, payload: { name: 'Final', kind: 'elimination', participantCount: 2 } })).json().id;
      await app.inject({ method: 'PUT', url: `${root}/stages/${first}/settings`, headers, payload: { game: 'Survival' } });
      await app.inject({ method: 'POST', url: `${root}/participants/${bob}/withdrawal`, headers });
      expect((await app.inject({ method: 'GET', url: `${root}/winner` })).json().winner.id).toBe(alice);
      expect((await app.inject({ method: 'POST', url: `${root}/stages/${first}/close` })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: `${root}/winner` })).json().winner.id).toBe(alice);
      const backup = (await app.inject({ method: 'GET', url: `${root}/backup`, headers })).json();
      expect((await app.inject({ method: 'POST', url: '/api/tournaments/restore', payload: { backup, pin: '1234' } })).statusCode).toBe(201);
    } finally { await app.close(); }
  });
});

import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/src/app';

describe('simultaneous station games', () => {
  it('saves two results atomically, supports different attempt numbers and one player alone', async () => {
    const app = await createApp(':memory:');
    try {
      const { id, token } = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Party', pin: '1234' } })).json();
      const root = `/api/tournaments/${id}`, admin = { authorization: `Bearer ${token}` };
      const add = async (displayName: string) => (await app.inject({ method: 'POST', url: `${root}/participants`, headers: admin, payload: { displayName } })).json().id;
      const alice = await add('Alice'), bob = await add('Bob');
      const stage = (await app.inject({ method: 'POST', url: `${root}/stages`, headers: admin, payload: { name: 'Round', kind: 'two-station', participantCount: null } })).json().id;
      const base = `${root}/stages/${stage}`, station = `${base}/stations/0`;
      const settings = { stations: [{ games: [{ name: 'Race', resultKind: 'time', higherIsBetter: false, attempts: 2, players: 2 }] }, { games: [] }], points: [5, 2] };
      expect((await app.inject({ method: 'PUT', url: `${base}/settings`, headers: admin, payload: settings })).statusCode).toBe(200);
      const draw = (await app.inject({ method: 'POST', url: `${station}/spin` })).json();
      await app.inject({ method: 'POST', url: `${station}/confirm`, payload: { drawId: draw.drawId } });
      const owner = { 'x-station-token': (await app.inject({ method: 'POST', url: `${station}/claim` })).json().token };
      const active = (participantIds: string[]) => app.inject({ method: 'PUT', url: `${station}/active`, headers: owner, payload: { participantIds } });
      const batch = (results: { participantId: string; value: number }[], requestId = randomUUID()) => app.inject({ method: 'POST', url: `${station}/attempts/batch`, headers: owner, payload: { requestId, results } });
      expect((await active([alice])).statusCode).toBe(200);
      expect((await batch([{ participantId: alice, value: 90 }])).statusCode).toBe(201);
      expect((await active([alice, bob])).statusCode).toBe(200);
      expect((await batch([{ participantId: alice, value: 80 }])).statusCode).toBe(409);
      expect((await app.inject({ method: 'GET', url: station })).json().entries).toHaveLength(1);
      const requestId = randomUUID(), pair = [{ participantId: alice, value: 80 }, { participantId: bob, value: 85 }];
      expect((await batch(pair, requestId)).statusCode).toBe(201);
      expect((await batch(pair, requestId)).statusCode).toBe(200);
      let snapshot = (await app.inject({ method: 'GET', url: station })).json();
      expect(snapshot.activeParticipants).toEqual([alice, bob]); expect(snapshot.entries).toHaveLength(3);
      expect(snapshot.ranking.find((p: { participantId: string }) => p.participantId === alice).attempts).toEqual([90, 80]);
      expect((await batch([{ participantId: bob, value: 70 }])).statusCode).toBe(201);
      snapshot = (await app.inject({ method: 'GET', url: station })).json();
      expect(snapshot.ranking[0].displayName).toBe('Bob'); expect(snapshot.ranking[0].best).toBe(70);
    } finally { await app.close(); }
  });
  it('removes only the forfeiting player from a pair', async () => {
    const app = await createApp(':memory:');
    try {
      const { id, token } = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Party', pin: '1234' } })).json();
      const root = `/api/tournaments/${id}`, admin = { authorization: `Bearer ${token}` };
      const a = (await app.inject({ method: 'POST', url: `${root}/participants`, headers: admin, payload: { displayName: 'Alice' } })).json().id;
      const b = (await app.inject({ method: 'POST', url: `${root}/participants`, headers: admin, payload: { displayName: 'Bob' } })).json().id;
      const stage = (await app.inject({ method: 'POST', url: `${root}/stages`, headers: admin, payload: { name: 'Round', kind: 'two-station', participantCount: null } })).json().id;
      const base = `${root}/stages/${stage}`, station = `${base}/stations/0`;
      await app.inject({ method: 'PUT', url: `${base}/settings`, headers: admin, payload: { stations: [{ games: [{ name: 'Race', resultKind: 'score', higherIsBetter: true, attempts: 1, players: 2 }] }, { games: [] }], points: [1] } });
      const draw = (await app.inject({ method: 'POST', url: `${station}/spin` })).json(); await app.inject({ method: 'POST', url: `${station}/confirm`, payload: { drawId: draw.drawId } });
      const owner = { 'x-station-token': (await app.inject({ method: 'POST', url: `${station}/claim` })).json().token };
      await app.inject({ method: 'PUT', url: `${station}/active`, headers: owner, payload: { participantIds: [a, b] } });
      await app.inject({ method: 'POST', url: `${base}/forfeits/${a}`, headers: admin });
      expect((await app.inject({ method: 'GET', url: station })).json().activeParticipants).toEqual([b]);
    } finally { await app.close(); }
  });
});

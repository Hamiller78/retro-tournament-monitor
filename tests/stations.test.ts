import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/src/app';

describe('station play', () => {
  it('locks entry to one device, records best attempts and protects corrections', async () => {
    const app = await createApp(':memory:');
    try {
      const { id, token } = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Play', pin: '1234' } })).json();
      const admin = { authorization: `Bearer ${token}` }, root = `/api/tournaments/${id}`;
      const add = async (displayName: string) => (await app.inject({ method: 'POST', url: `${root}/participants`, headers: admin, payload: { displayName } })).json().id;
      const first = await add('Alice'), second = await add('Bob');
      const stage = (await app.inject({ method: 'POST', url: `${root}/stages`, headers: admin, payload: { name: 'Round', kind: 'two-station', participantCount: null } })).json().id;
      const base = `${root}/stages/${stage}`, station = `${base}/stations/0`;
      const config = { stations: [{ games: [{ name: 'Race', resultKind: 'time', higherIsBetter: false, attempts: 2 }] }, { games: [] }], points: [3, 2] };
      await app.inject({ method: 'PUT', url: `${base}/settings`, headers: admin, payload: config });
      const draw = (await app.inject({ method: 'POST', url: `${station}/spin` })).json();
      await app.inject({ method: 'POST', url: `${station}/confirm`, payload: { drawId: draw.drawId } });
      const lock = (await app.inject({ method: 'POST', url: `${station}/claim` })).json().token;
      const owner = { 'x-station-token': lock };
      expect((await app.inject({ method: 'POST', url: `${station}/claim` })).statusCode).toBe(409);
      expect((await app.inject({ method: 'PUT', url: `${station}/active`, payload: { participantId: first } })).statusCode).toBe(403);
      await app.inject({ method: 'PUT', url: `${station}/active`, headers: owner, payload: { participantId: first } });
      const requestId = randomUUID(), attempt = { participantId: first, value: 21.5, requestId };
      expect((await app.inject({ method: 'POST', url: `${station}/attempts`, headers: owner, payload: attempt })).statusCode).toBe(201);
      expect((await app.inject({ method: 'POST', url: `${station}/attempts`, headers: owner, payload: attempt })).statusCode).toBe(200);
      await app.inject({ method: 'POST', url: `${station}/attempts`, headers: owner, payload: { participantId: first, value: 19, requestId: randomUUID() } });
      await app.inject({ method: 'PUT', url: `${station}/active`, headers: owner, payload: { participantId: second } });
      await app.inject({ method: 'POST', url: `${station}/attempts`, headers: owner, payload: { participantId: second, value: 19, requestId: randomUUID() } });
      let snapshot = (await app.inject({ method: 'GET', url: station })).json();
      expect(snapshot.ranking.map((row: { rank: number }) => row.rank)).toEqual([1, 1]);
      expect(snapshot.entries).toHaveLength(3);
      expect((await app.inject({ method: 'POST', url: `${station}/unlock`, headers: admin })).statusCode).toBe(409);
      expect((await app.inject({ method: 'DELETE', url: `${root}/participants/${first}`, headers: admin })).statusCode).toBe(409);
      expect((await app.inject({ method: 'PUT', url: `${base}/settings`, headers: admin, payload: config })).statusCode).toBe(409);
      expect((await app.inject({ method: 'DELETE', url: `${station}/attempts/${first}/2` })).statusCode).toBe(401);
      expect((await app.inject({ method: 'DELETE', url: `${station}/attempts/${first}/2`, headers: admin })).statusCode).toBe(200);
      snapshot = (await app.inject({ method: 'GET', url: station })).json();
      expect(snapshot.ranking[0].displayName).toBe('Bob'); expect(snapshot.ranking[1].best).toBe(21.5);
      expect((await app.inject({ method: 'POST', url: `${station}/release`, headers: admin })).statusCode).toBe(200);
      expect((await app.inject({ method: 'PUT', url: `${station}/active`, headers: owner, payload: { participantId: first } })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
});

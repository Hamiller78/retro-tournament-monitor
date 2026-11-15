import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/src/app';

describe('stage forfeits', () => {
  it('preserves results, moves other players up, and restores results when reversed', async () => {
    const app = await createApp(':memory:');
    try {
      const { id, token } = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Party', pin: '1234' } })).json();
      const root = `/api/tournaments/${id}`, admin = { authorization: `Bearer ${token}` };
      const add = async (displayName: string) => (await app.inject({ method: 'POST', url: `${root}/participants`, headers: admin, payload: { displayName } })).json().id;
      const alice = await add('Alice'), bob = await add('Bob'), pending = await add('Cara');
      const stage = (await app.inject({ method: 'POST', url: `${root}/stages`, headers: admin, payload: { name: 'Round', kind: 'two-station', participantCount: null } })).json().id;
      const base = `${root}/stages/${stage}`, station = `${base}/stations/0`;
      const config = { stations: [{ games: [{ name: 'Score', resultKind: 'score', higherIsBetter: true, attempts: 2 }] }, { games: [] }], points: [5, 2] };
      await app.inject({ method: 'PUT', url: `${base}/settings`, headers: admin, payload: config });
      const draw = (await app.inject({ method: 'POST', url: `${station}/spin` })).json();
      await app.inject({ method: 'POST', url: `${station}/confirm`, payload: { drawId: draw.drawId } });
      const lock = (await app.inject({ method: 'POST', url: `${station}/claim` })).json().token;
      const owner = { 'x-station-token': lock };
      for (const [participantId, value] of [[alice, 100], [bob, 50]] as const) {
        await app.inject({ method: 'PUT', url: `${station}/active`, headers: owner, payload: { participantId } });
        await app.inject({ method: 'POST', url: `${station}/attempts`, headers: owner, payload: { participantId, value, requestId: randomUUID() } });
      }
      const forfeit = `${base}/forfeits/${alice}`;
      expect((await app.inject({ method: 'POST', url: forfeit })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: forfeit, headers: admin })).statusCode).toBe(200);
      let board = (await app.inject({ method: 'GET', url: `${base}/leaderboard` })).json().rows;
      expect(board.map((r: { displayName: string }) => r.displayName)).toEqual(['Bob', 'Cara', 'Alice']);
      expect(board[0].total).toBe(5); expect(board[2].total).toBe(0); expect(board[2].forfeited).toBe(true); expect(board[2].rank).toBeNull();
      let snapshot = (await app.inject({ method: 'GET', url: station })).json();
      expect(snapshot.ranking.find((r: { participantId: string }) => r.participantId === alice).forfeited).toBe(true);
      expect(snapshot.entries.find((r: { participantId: string }) => r.participantId === alice).value).toBe(100);
      expect((await app.inject({ method: 'PUT', url: `${station}/active`, headers: owner, payload: { participantId: alice } })).statusCode).toBe(409);
      expect((await app.inject({ method: 'DELETE', url: forfeit })).statusCode).toBe(401);
      expect((await app.inject({ method: 'DELETE', url: forfeit, headers: admin })).statusCode).toBe(200);
      board = (await app.inject({ method: 'GET', url: `${base}/leaderboard` })).json().rows;
      expect(board.map((r: { displayName: string }) => r.displayName)).toEqual(['Alice', 'Bob', 'Cara']);
      expect(board[0].total).toBe(5); expect(board[1].total).toBe(2);
      snapshot = (await app.inject({ method: 'GET', url: station })).json();
      expect(snapshot.ranking[0].best).toBe(100); expect(snapshot.ranking[0].forfeited).toBe(false);
      expect((await app.inject({ method: 'POST', url: `${base}/forfeits/${pending}`, headers: admin })).statusCode).toBe(200);
      expect((await app.inject({ method: 'DELETE', url: `${root}/participants/${pending}`, headers: admin })).statusCode).toBe(409);
    } finally { await app.close(); }
  });
});

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/src/app';

describe('configurable station count', () => {
  it('records and combines three stations, advances only after all close, and restores a backup', async () => {
    const app = await createApp(':memory:');
    try {
      const event = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Three stations', pin: '1234' } })).json();
      const root = `/api/tournaments/${event.id}`, headers = { authorization: `Bearer ${event.token}` };
      const player = (await app.inject({ method: 'POST', url: `${root}/participants`, headers, payload: { displayName: 'Alice' } })).json().id;
      const stage = (await app.inject({ method: 'POST', url: `${root}/stages`, headers, payload: { name: 'Scoring', kind: 'two-station', participantCount: 1 } })).json().id;
      const base = `${root}/stages/${stage}`, games = ['One', 'Two', 'Three'].map(name => ({ games: [{ name, resultKind: 'score', higherIsBetter: true, attempts: 1 }] }));
      const settings = { stations: games, points: [5] };
      expect((await app.inject({ method: 'PUT', url: `${base}/settings`, headers, payload: settings })).statusCode).toBe(200);
      for (const n of [0, 1, 2]) {
        const station = `${base}/stations/${n}`, spin = (await app.inject({ method: 'POST', url: `${station}/spin` })).json();
        expect((await app.inject({ method: 'POST', url: `${station}/confirm`, payload: { drawId: spin.drawId } })).statusCode).toBe(200);
        const owner = { 'x-station-token': (await app.inject({ method: 'POST', url: `${station}/claim` })).json().token };
        await app.inject({ method: 'PUT', url: `${station}/active`, headers: owner, payload: { participantIds: [player] } });
        expect((await app.inject({ method: 'POST', url: `${station}/attempts/batch`, headers: owner, payload: { requestId: randomUUID(), results: [{ participantId: player, value: 100 }] } })).statusCode).toBe(201);
        const closed = (await app.inject({ method: 'POST', url: `${station}/close` })).json();
        expect(closed.advanced).toBe(n === 2);
      }
      const board = (await app.inject({ method: 'GET', url: `${base}/leaderboard` })).json();
      expect(board.stations).toHaveLength(3); expect(board.rows[0].stationPoints).toEqual([5, 5, 5]); expect(board.rows[0].total).toBe(15);
      const backup = (await app.inject({ method: 'GET', url: `${root}/backup`, headers })).json();
      expect(backup.gameSelectionStarted).toBe(true);
      const restored = await app.inject({ method: 'POST', url: '/api/tournaments/restore', payload: { backup, pin: '1234' } });
      expect(restored.statusCode).toBe(201);
    } finally { await app.close(); }
  });
});

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
describe('qualification and winner presentation', () => {
  it('marks a contested cutoff and then the actual qualifiers', async () => {
    const f = await setup(2, 2);
    try {
      let board = (await f.app.inject({ method: 'GET', url: `${f.base}/leaderboard` })).json();
      expect(board.qualificationPlaces).toBe(2);
      expect(board.rows.map((r: { displayName: string; qualification: string }) => [r.displayName, r.qualification])).toEqual([['Alice', 'position'], ['Bob', 'contested'], ['Cara', 'contested']]);
      await f.app.inject({ method: 'POST', url: `${f.base}/stations/0/close` });
      await f.app.inject({ method: 'POST', url: `${f.base}/stations/1/close` });
      await f.app.inject({ method: 'POST', url: `${f.tieBase}/outcome`, payload: { participantId: f.players[2], requestId: randomUUID() } });
      await f.app.inject({ method: 'POST', url: `${f.tieBase}/close` });
      board = (await f.app.inject({ method: 'GET', url: `${f.base}/leaderboard` })).json();
      expect(board.qualificationSettled).toBe(true);
      expect(board.rows.map((r: { displayName: string; qualification: string }) => [r.displayName, r.qualification])).toEqual([['Alice', 'qualified'], ['Bob', null], ['Cara', 'qualified']]);
    } finally { await f.app.close(); }
  });
  it('does not declare a scoring winner for a tie until the final tie-breaker has a winner', async () => {
    const f = await setup(2, 2);
    try {
      expect((await f.app.inject({ method: 'DELETE', url: `${f.root}/stages/${f.next}`, headers: f.admin })).statusCode).toBe(200);
      let winner = (await f.app.inject({ method: 'GET', url: `${f.root}/winner` })).json();
      expect(winner.winner.name).toBe('Alice');
      const station = `${f.base}/stations/0`;
      expect((await f.app.inject({ method: 'PUT', url: `${station}/attempts/${f.players[1]}/1`, headers: f.admin, payload: { value: 100 } })).statusCode).toBe(200);
      const second = `${f.base}/stations/1`;
      expect((await f.app.inject({ method: 'PUT', url: `${second}/attempts/${f.players[1]}/1`, headers: f.admin, payload: { value: 100 } })).statusCode).toBe(200);
      winner = (await f.app.inject({ method: 'GET', url: `${f.root}/winner` })).json(); expect(winner.winner).toBeNull();
      await f.app.inject({ method: 'POST', url: `${station}/close` });
      await f.app.inject({ method: 'POST', url: `${second}/close` });
      expect((await f.app.inject({ method: 'GET', url: `${f.root}/winner` })).json().winner).toBeNull();
      expect((await f.app.inject({ method: 'POST', url: `${f.tieBase}/outcome`, payload: { participantId: f.players[1], requestId: randomUUID() } })).statusCode).toBe(201);
      winner = (await f.app.inject({ method: 'GET', url: `${f.root}/winner` })).json(); expect(winner.winner.name).toBe('Bob');
    } finally { await f.app.close(); }
  });
});

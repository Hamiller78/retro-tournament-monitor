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
describe('tournament withdrawals', () => {
  it('preserves scores, updates standings, restores backups, and reverses before advancement', async () => {
    const f = await setup(2, 2);
    try {
      const url = `${f.root}/participants/${f.players[1]}/withdrawal`;
      expect((await f.app.inject({ method: 'POST', url })).statusCode).toBe(401);
      expect((await f.app.inject({ method: 'POST', url, headers: f.admin })).statusCode).toBe(200);
      let board = (await f.app.inject({ method: 'GET', url: `${f.base}/leaderboard` })).json().rows;
      expect(board.find((row: { displayName: string }) => row.displayName === 'Bob').withdrawn).toBe(true);
      const station = (await f.app.inject({ method: 'GET', url: `${f.base}/stations/0` })).json();
      expect(station.entries.find((e: { participantId: string }) => e.participantId === f.players[1]).value).toBe(50);
      const backup = (await f.app.inject({ method: 'GET', url: `${f.root}/backup`, headers: f.admin })).json();
      expect(backup.withdrawals).toHaveLength(1);
      const restored = await f.app.inject({ method: 'POST', url: '/api/tournaments/restore', payload: { backup, pin: '1234' } });
      expect(restored.statusCode).toBe(201);
      const details = (await f.app.inject({ method: 'GET', url: `/api/tournaments/${restored.json().id}` })).json();
      expect(details.participants.find((p: { displayName: string }) => p.displayName === 'Bob').withdrawn).toBe(true);
      expect((await f.app.inject({ method: 'DELETE', url, headers: f.admin })).statusCode).toBe(200);
      board = (await f.app.inject({ method: 'GET', url: `${f.base}/leaderboard` })).json().rows;
      expect(board.find((row: { displayName: string }) => row.displayName === 'Bob').withdrawn).toBe(false);
      expect((await f.app.inject({ method: 'POST', url, headers: f.admin })).statusCode).toBe(200);
      await f.app.inject({ method: 'POST', url: `${f.base}/stations/0/close` });
      expect((await f.app.inject({ method: 'POST', url: `${f.base}/stations/1/close` })).json().advanced).toBe(true);
      expect((await f.app.inject({ method: 'DELETE', url, headers: f.admin })).statusCode).toBe(409);
      const after = (await f.app.inject({ method: 'GET', url: f.root })).json();
      expect(after.stages.find((s: { name: string }) => s.name === 'Semi-final').entrants.map((p: { displayName: string }) => p.displayName)).toEqual(['Alice', 'Cara']);
    } finally { await f.app.close(); }
  });
  it('treats a withdrawal from a simultaneous elimination as ineligible and lets the survivor advance', async () => {
    const f = await setup(2, 2);
    try {
      await f.app.inject({ method: 'POST', url: `${f.root}/participants/${f.players[1]}/withdrawal`, headers: f.admin });
      await f.app.inject({ method: 'POST', url: `${f.base}/stations/0/close` });
      await f.app.inject({ method: 'POST', url: `${f.base}/stations/1/close` });
      const url = `${f.root}/participants/${f.players[0]}/withdrawal`;
      expect((await f.app.inject({ method: 'POST', url, headers: f.admin })).statusCode).toBe(200);
      const outcome = (await f.app.inject({ method: 'GET', url: `${f.root}/stages/${f.next}/outcome` })).json();
      expect(outcome.complete).toBe(true); expect(outcome.ranking).toEqual([f.players[2]]);
      expect((await f.app.inject({ method: 'POST', url: `${f.root}/stages/${f.next}/close` })).statusCode).toBe(200);
    } finally { await f.app.close(); }
  });
});

import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/src/app';

async function fixture(path: string) {
  const app = await createApp(path);
  const { id, token } = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Event', pin: '1234' } })).json();
  const root = `/api/tournaments/${id}`, admin = { authorization: `Bearer ${token}` };
  const players: string[] = [];
  for (const displayName of ['Alice', 'Bob']) players.push((await app.inject({ method: 'POST', url: `${root}/participants`, headers: admin, payload: { displayName } })).json().id);
  const first = (await app.inject({ method: 'POST', url: `${root}/stages`, headers: admin, payload: { name: 'Qualifiers', kind: 'two-station', participantCount: 2 } })).json().id;
  const next = (await app.inject({ method: 'POST', url: `${root}/stages`, headers: admin, payload: { name: 'Semi', kind: 'elimination', participantCount: 1 } })).json().id;
  const base = `${root}/stages/${first}`;
  await app.inject({ method: 'PUT', url: `${base}/settings`, headers: admin, payload: { stations: [{ games: [{ name: 'One', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }, { games: [{ name: 'Two', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }], points: [5, 2] } });
  const owners: { 'x-station-token': string }[] = [];
  for (const n of [0, 1]) {
    const station = `${base}/stations/${n}`, draw = (await app.inject({ method: 'POST', url: `${station}/spin` })).json();
    await app.inject({ method: 'POST', url: `${station}/confirm`, payload: { drawId: draw.drawId } });
    owners.push({ 'x-station-token': (await app.inject({ method: 'POST', url: `${station}/claim` })).json().token });
  }
  async function result(station: number, player: string, value: number) {
    const url = `${base}/stations/${station}`, headers = owners[station];
    expect((await app.inject({ method: 'PUT', url: `${url}/active`, headers, payload: { participantId: player } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `${url}/attempts/batch`, headers, payload: { requestId: randomUUID(), results: [{ participantId: player, value }] } })).statusCode).toBe(201);
  }
  return { app, root, admin, players, base, first, next, result, owners };
}
describe('station completion', () => {
  it('closes stations without a PIN and advances only after both are complete', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'retromania-stations-')); const f = await fixture(join(dir, 'data.sqlite'));
    try {
      expect((await f.app.inject({ method: 'POST', url: `${f.base}/stations/0/close` })).statusCode).toBe(409);
      await f.result(0, f.players[0], 100);
      expect((await f.app.inject({ method: 'POST', url: `${f.base}/stations/0/close` })).statusCode).toBe(409);
      await f.result(0, f.players[1], 50);
      const firstClose = await f.app.inject({ method: 'POST', url: `${f.base}/stations/0/close` });
      expect(firstClose.statusCode).toBe(200); expect(firstClose.json().advanced).toBe(false);
      expect((await f.app.inject({ method: 'PUT', url: `${f.base}/stations/0/active`, headers: f.owners[0], payload: { participantId: f.players[0] } })).statusCode).toBe(409);
      const backup = (await f.app.inject({ method: 'GET', url: `${f.root}/backup`, headers: f.admin })).json();
      expect(backup.stationCompletions).toHaveLength(1);
      const broken = structuredClone(backup); broken.attempts.pop();
      expect((await f.app.inject({ method: 'POST', url: '/api/tournaments/restore', payload: { backup: broken, pin: '1234' } })).statusCode).toBe(400);
      const restored = await f.app.inject({ method: 'POST', url: '/api/tournaments/restore', payload: { backup, pin: '1234' } }); expect(restored.statusCode).toBe(201);
      const copy = (await f.app.inject({ method: 'GET', url: `/api/tournaments/${restored.json().id}` })).json();
      const restoredStation = (await f.app.inject({ method: 'GET', url: `/api/tournaments/${restored.json().id}/stages/${copy.stages[0].id}/stations/0` })).json();
      expect(restoredStation.stationClosed).toBe(true); expect(restoredStation.bothStationsClosed).toBe(false);
      await f.result(1, f.players[0], 100); await f.result(1, f.players[1], 50);
      const closed = await f.app.inject({ method: 'POST', url: `${f.base}/stations/1/close` });
      expect(closed.statusCode).toBe(200); expect(closed.json().advanced).toBe(true); expect(closed.json().warning).toBeUndefined();
      const details = (await f.app.inject({ method: 'GET', url: f.root })).json();
      expect(details.stages[0].status).toBe('closed'); expect(details.stages[1].status).toBe('active'); expect(details.stages[1].entrants[0].displayName).toBe('Alice');
      expect(readdirSync(join(dir, 'backups'))).toHaveLength(1);
      expect((await f.app.inject({ method: 'POST', url: `${f.base}/stations/0/close` })).statusCode).toBe(409);
      expect((await f.app.inject({ method: 'POST', url: `${f.base}/reopen`, headers: f.admin })).statusCode).toBe(200);
      expect((await f.app.inject({ method: 'GET', url: `${f.base}/stations/0` })).json().stationClosed).toBe(false);
    } finally { await f.app.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it('keeps both stations closed and explains a cutoff tie until it can advance', async () => {
    const f = await fixture(':memory:');
    try {
      for (const n of [0, 1]) { await f.result(n, f.players[0], 50); await f.result(n, f.players[1], 50); }
      await f.app.inject({ method: 'POST', url: `${f.base}/stations/0/close` });
      const closed = await f.app.inject({ method: 'POST', url: `${f.base}/stations/1/close` });
      expect(closed.statusCode).toBe(200); expect(closed.json().advanced).toBe(false); expect(closed.json().warning).toContain('tie');
      expect((await f.app.inject({ method: 'GET', url: `${f.base}/stations/1` })).json().bothStationsClosed).toBe(true);
      const adjusted = await f.app.inject({ method: 'PUT', url: `${f.base}/stations/0/attempts/${f.players[1]}/1`, headers: f.admin, payload: { value: 10 } }); expect(adjusted.statusCode).toBe(200);
      const retry = await f.app.inject({ method: 'POST', url: `${f.base}/stations/1/close` }); expect(retry.json().advanced).toBe(true);
    } finally { await f.app.close(); }
  });
  it('reopens a completed station when a late participant is added', async () => {
    const f = await fixture(':memory:');
    try {
      await f.result(0, f.players[0], 100); await f.result(0, f.players[1], 50);
      await f.app.inject({ method: 'POST', url: `${f.base}/stations/0/close` });
      expect((await f.app.inject({ method: 'GET', url: `${f.base}/stations/0` })).json().stationClosed).toBe(true);
      expect((await f.app.inject({ method: 'POST', url: `${f.root}/participants`, headers: f.admin, payload: { displayName: 'Late arrival' } })).statusCode).toBe(201);
      const state = (await f.app.inject({ method: 'GET', url: `${f.base}/stations/0` })).json();
      expect(state.stationClosed).toBe(false); expect(state.pending).toBe(1);
    } finally { await f.app.close(); }
  });
  it('reopens a station if a missing result becomes required again', async () => {
    const f = await fixture(':memory:');
    try {
      await f.result(0, f.players[0], 100);
      await f.app.inject({ method: 'POST', url: `${f.base}/forfeits/${f.players[1]}`, headers: f.admin });
      expect((await f.app.inject({ method: 'POST', url: `${f.base}/stations/0/close` })).statusCode).toBe(200);
      expect((await f.app.inject({ method: 'POST', url: `${f.base}/stations/0/reopen` })).statusCode).toBe(401);
      await f.app.inject({ method: 'DELETE', url: `${f.base}/forfeits/${f.players[1]}`, headers: f.admin });
      let state = (await f.app.inject({ method: 'GET', url: `${f.base}/stations/0` })).json(); expect(state.stationClosed).toBe(false); expect(state.pending).toBe(1);
      await f.result(0, f.players[1], 50); await f.app.inject({ method: 'POST', url: `${f.base}/stations/0/close` });
      await f.app.inject({ method: 'DELETE', url: `${f.base}/stations/0/attempts/${f.players[0]}/1`, headers: f.admin });
      state = (await f.app.inject({ method: 'GET', url: `${f.base}/stations/0` })).json(); expect(state.stationClosed).toBe(false); expect(state.pending).toBe(1);
    } finally { await f.app.close(); }
  });
});

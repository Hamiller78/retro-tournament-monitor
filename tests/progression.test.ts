import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/src/app';

describe('stage advancement', () => {
  it('requires complete results and no cutoff tie, saves qualifiers and supports safe reopening', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'retromania-progress-')); const app = await createApp(join(dir, 'data.sqlite'));
    try {
      const { id, token } = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Event', pin: '1234' } })).json();
      const root = `/api/tournaments/${id}`, admin = { authorization: `Bearer ${token}` };
      const players: string[] = [];
      for (const displayName of ['Alice', 'Bob', 'Cara']) players.push((await app.inject({ method: 'POST', url: `${root}/participants`, headers: admin, payload: { displayName } })).json().id);
      const first = (await app.inject({ method: 'POST', url: `${root}/stages`, headers: admin, payload: { name: 'Round', kind: 'two-station', participantCount: 3 } })).json().id;
      const next = (await app.inject({ method: 'POST', url: `${root}/stages`, headers: admin, payload: { name: 'Semi', kind: 'two-station', participantCount: 2 } })).json().id;
      const settings = { stations: [{ games: [{ name: 'One', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }, { games: [{ name: 'Two', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }], points: [5, 3, 1] };
      const base = `${root}/stages/${first}`;
      await app.inject({ method: 'PUT', url: `${base}/settings`, headers: admin, payload: settings });
      await app.inject({ method: 'PUT', url: `${root}/stages/${next}/settings`, headers: admin, payload: settings });
      expect((await app.inject({ method: 'POST', url: `${base}/close` })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: `${base}/close`, headers: admin })).statusCode).toBe(409);
      for (const number of [0, 1]) {
        const station = `${base}/stations/${number}`;
        const draw = (await app.inject({ method: 'POST', url: `${station}/spin` })).json(); await app.inject({ method: 'POST', url: `${station}/confirm`, payload: { drawId: draw.drawId } });
        const owner = { 'x-station-token': (await app.inject({ method: 'POST', url: `${station}/claim` })).json().token };
        for (let i = 0; i < players.length; i++) {
          await app.inject({ method: 'PUT', url: `${station}/active`, headers: owner, payload: { participantId: players[i] } });
          await app.inject({ method: 'POST', url: `${station}/attempts/batch`, headers: owner, payload: { requestId: randomUUID(), results: [{ participantId: players[i], value: i === 0 ? 100 : 50 }] } });
        }
      }
      const tie = await app.inject({ method: 'POST', url: `${base}/close`, headers: admin });
      expect(tie.statusCode).toBe(409); expect(tie.json().error).toContain('tie');
      await app.inject({ method: 'PUT', url: `${base}/stations/1/attempts/${players[2]}/1`, headers: admin, payload: { value: 20 } });
      const closed = await app.inject({ method: 'POST', url: `${base}/close`, headers: admin });
      expect(closed.statusCode).toBe(200); expect(closed.json().warning).toBeUndefined();
      let details = (await app.inject({ method: 'GET', url: root, headers: admin })).json();
      expect(details.stages[0].status).toBe('closed'); expect(details.stages[1].status).toBe('active');
      expect((await app.inject({ method: 'POST', url: `${root}/participants`, headers: admin, payload: { displayName: 'Late arrival' } })).statusCode).toBe(409);
      expect(details.stages[1].entrants.map((p: { displayName: string }) => p.displayName)).toEqual(['Alice', 'Bob']);
      expect((await app.inject({ method: 'PUT', url: `${base}/stations/1/attempts/${players[2]}/1`, headers: admin, payload: { value: 90 } })).statusCode).toBe(409);
      const backups = readdirSync(join(dir, 'backups')); expect(backups).toHaveLength(1);
      const backup = JSON.parse(readFileSync(join(dir, 'backups', backups[0]), 'utf8'));
      expect(backup.entrants).toHaveLength(2); expect(backup.progress).toHaveLength(2);
      const restored = await app.inject({ method: 'POST', url: '/api/tournaments/restore', payload: { backup, pin: '1234' } });
      expect(restored.statusCode).toBe(201);
      const copy = (await app.inject({ method: 'GET', url: `/api/tournaments/${restored.json().id}` })).json();
      expect(copy.stages[0].status).toBe('closed'); expect(copy.stages[1].entrants.map((p: { displayName: string }) => p.displayName)).toEqual(['Alice', 'Bob']);
      const update = (count: number) => app.inject({ method: 'PUT', url: `${root}/stages/${next}`, headers: admin, payload: { name: 'Semi', kind: 'two-station', participantCount: count } });
      expect((await update(1)).statusCode).toBe(200); details = (await app.inject({ method: 'GET', url: root })).json(); expect(details.stages[1].entrants).toHaveLength(1);
      expect((await update(2)).statusCode).toBe(200);
      const later = `${root}/stages/${next}/stations/0`;
      const draw = (await app.inject({ method: 'POST', url: `${later}/spin` })).json(); await app.inject({ method: 'POST', url: `${later}/confirm`, payload: { drawId: draw.drawId } });
      const owner = { 'x-station-token': (await app.inject({ method: 'POST', url: `${later}/claim` })).json().token };
      expect((await app.inject({ method: 'PUT', url: `${later}/active`, headers: owner, payload: { participantId: players[2] } })).statusCode).toBe(400);
      await app.inject({ method: 'PUT', url: `${later}/active`, headers: owner, payload: { participantId: players[0] } });
      await app.inject({ method: 'POST', url: `${later}/attempts/batch`, headers: owner, payload: { requestId: randomUUID(), results: [{ participantId: players[0], value: 42 }] } });
      expect((await app.inject({ method: 'POST', url: `${base}/reopen`, headers: admin })).statusCode).toBe(409);
      await app.inject({ method: 'DELETE', url: `${later}/attempts/${players[0]}/1`, headers: admin });
      expect((await app.inject({ method: 'POST', url: `${base}/reopen`, headers: admin })).statusCode).toBe(200);
      details = (await app.inject({ method: 'GET', url: root })).json();
      expect(details.stages[0].status).toBe('active'); expect(details.stages[1].status).toBe('pending'); expect(details.stages[1].entrants).toEqual([]);
    } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it('closes the stage and warns if its automatic backup fails', async () => {
    const app = await createApp(':memory:');
    try {
      const { id, token } = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Backup warning', pin: '1234' } })).json();
      const root = `/api/tournaments/${id}`, admin = { authorization: `Bearer ${token}` };
      const person = (await app.inject({ method: 'POST', url: `${root}/participants`, headers: admin, payload: { displayName: 'Alice' } })).json().id;
      const first = (await app.inject({ method: 'POST', url: `${root}/stages`, headers: admin, payload: { name: 'Round', kind: 'two-station', participantCount: 1 } })).json().id;
      await app.inject({ method: 'POST', url: `${root}/stages`, headers: admin, payload: { name: 'Next', kind: 'elimination', participantCount: 1 } });
      const base = `${root}/stages/${first}`;
      await app.inject({ method: 'PUT', url: `${base}/settings`, headers: admin, payload: { stations: [{ games: [{ name: 'One', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }, { games: [{ name: 'Two', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }], points: [1] } });
      for (const n of [0, 1]) {
        const station = `${base}/stations/${n}`, draw = (await app.inject({ method: 'POST', url: `${station}/spin` })).json();
        await app.inject({ method: 'POST', url: `${station}/confirm`, payload: { drawId: draw.drawId } });
        const owner = { 'x-station-token': (await app.inject({ method: 'POST', url: `${station}/claim` })).json().token };
        await app.inject({ method: 'PUT', url: `${station}/active`, headers: owner, payload: { participantId: person } });
        await app.inject({ method: 'POST', url: `${station}/attempts/batch`, headers: owner, payload: { requestId: randomUUID(), results: [{ participantId: person, value: 5 }] } });
      }
      const result = await app.inject({ method: 'POST', url: `${base}/close`, headers: admin });
      expect(result.statusCode).toBe(200); expect(result.json().warning).toContain('backup failed');
      const tournament = (await app.inject({ method: 'GET', url: root })).json(); expect(tournament.stages[0].status).toBe('closed'); expect(tournament.stages[1].entrants).toHaveLength(1);
    } finally { await app.close(); }
  });
});

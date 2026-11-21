import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/src/app';

describe('deleting a tournament', () => {
  it('requires the right administrator and removes related data without affecting another tournament', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'retromania-delete-')), path = join(dir, 'event.sqlite');
    const app = await createApp(path);
    try {
      const create = async (name: string) => (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name, pin: '1234' } })).json();
      const first = await create('Delete me'), second = await create('Keep me');
      const root = `/api/tournaments/${first.id}`, headers = { authorization: `Bearer ${first.token}` }, otherHeaders = { authorization: `Bearer ${second.token}` };
      const players: string[] = [];
      for (const displayName of ['Alice', 'Bob']) players.push((await app.inject({ method: 'POST', url: `${root}/participants`, headers, payload: { displayName } })).json().id);
      const add = async (name: string, kind: string) => (await app.inject({ method: 'POST', url: `${root}/stages`, headers, payload: { name, kind, participantCount: 2 } })).json().id;
      const stage = await add('Scoring', 'two-station'), tie = await add('Tie', 'tie-breaker'), final = await add('Final', 'duel');
      const settings = { stations: [{ mode: 'fixed', games: [{ name: 'Pong', resultKind: 'score', higherIsBetter: true, attempts: 1 }] }], points: [1] };
      await app.inject({ method: 'PUT', url: `${root}/stages/${stage}/settings`, headers, payload: settings });
      await app.inject({ method: 'PUT', url: `${root}/trophy`, headers, payload: { image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=' } });
      const data = new DatabaseSync(path); data.exec('PRAGMA foreign_keys = ON');
      try {
        data.prepare("INSERT INTO stage_progress VALUES (?, 'closed', NULL)").run(stage);
        data.prepare("INSERT INTO stage_progress VALUES (?, 'active', ?)").run(tie, stage);
        data.prepare('INSERT INTO stage_entrants VALUES (?, ?, 0)').run(tie, players[0]);
        data.prepare('INSERT INTO stage_entrants VALUES (?, ?, 1)').run(tie, players[1]);
        data.prepare('INSERT INTO stage_results VALUES (?, ?, 0, ?)').run(randomUUID(), tie, players[0]);
        data.prepare('INSERT INTO tie_resolutions VALUES (?, ?, ?, 1)').run(tie, stage, final);
        data.prepare('INSERT INTO attempts VALUES (?, ?, 0, ?, 1, 10)').run(randomUUID(), stage, players[0]);
        data.prepare('INSERT INTO attempt_batches VALUES (?, ?, 0, ?)').run(randomUUID(), stage, '[]');
        data.prepare('INSERT INTO stage_forfeits VALUES (?, ?)').run(stage, players[1]);
        data.prepare('INSERT INTO withdrawals VALUES (?, ?)').run(players[1], stage);
        data.prepare('INSERT INTO withdrawal_replacements VALUES (?, ?, ?)').run(players[1], stage, players[0]);
        data.prepare('INSERT INTO station_completions VALUES (?, 0)').run(stage);
        data.prepare('INSERT INTO station_sessions (stage_id, station, token, active_participant) VALUES (?, 0, ?, ?)').run(stage, 'device', players[0]);
        data.prepare('INSERT INTO display_wheels VALUES (?, ?, 0)').run(first.id, stage);
      } finally { data.close(); }
      expect((await app.inject({ method: 'DELETE', url: root })).statusCode).toBe(401);
      expect((await app.inject({ method: 'DELETE', url: root, headers: otherHeaders })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: root })).statusCode).toBe(200);
      const fault = new DatabaseSync(path);
      try { fault.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON stage_results BEGIN SELECT RAISE(ABORT, 'test failure'); END;"); } finally { fault.close(); }
      expect((await app.inject({ method: 'DELETE', url: root, headers })).statusCode).toBe(500);
      const afterFailure = new DatabaseSync(path);
      try { expect(afterFailure.prepare('SELECT COUNT(*) AS count FROM tie_resolutions').get()?.count).toBe(1); expect(afterFailure.prepare('SELECT COUNT(*) AS count FROM withdrawal_replacements').get()?.count).toBe(1); afterFailure.exec('DROP TRIGGER fail_delete'); } finally { afterFailure.close(); }
      expect((await app.inject({ method: 'DELETE', url: root, headers })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: root })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: `/api/tournaments/${second.id}` })).statusCode).toBe(200);
      expect((await app.inject({ method: 'DELETE', url: root, headers })).statusCode).toBe(401);
      const verify = new DatabaseSync(path);
      try { expect(verify.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0); for (const table of ['participants', 'stages', 'stage_results', 'stage_entrants', 'attempts', 'stage_forfeits', 'withdrawals', 'withdrawal_replacements', 'tie_resolutions', 'stage_progress', 'station_draws', 'station_sessions', 'station_completions', 'attempt_batches', 'display_wheels', 'trophy_images']) expect(verify.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count).toBe(0); } finally { verify.close(); }
    } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/src/app';

it('migrates the old two-station tables without losing existing records', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'retromania-migration-')), path = join(dir, 'test.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE tournaments (id TEXT PRIMARY KEY, name TEXT NOT NULL, pin_salt TEXT NOT NULL, pin_hash TEXT NOT NULL);
    CREATE TABLE stages (id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE, name TEXT NOT NULL, kind TEXT NOT NULL, participant_count INTEGER, position INTEGER NOT NULL);
    CREATE TABLE station_draws (stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE, station INTEGER NOT NULL CHECK(station IN (0, 1)), draw_id TEXT NOT NULL, game_index INTEGER NOT NULL, confirmed INTEGER NOT NULL CHECK(confirmed IN (0, 1)), PRIMARY KEY(stage_id, station));
    CREATE TABLE station_completions (stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE, station INTEGER NOT NULL CHECK(station IN (0, 1)), PRIMARY KEY(stage_id, station));
    CREATE TABLE display_wheels (tournament_id TEXT PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE, stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE, station INTEGER NOT NULL CHECK(station IN (0, 1)));
    INSERT INTO tournaments VALUES ('event', 'Existing', 'salt', 'hash');
    INSERT INTO stages VALUES ('stage', 'event', 'Round', 'two-station', 2, 0);
    INSERT INTO station_draws VALUES ('stage', 1, 'old-draw', 0, 1);
    INSERT INTO station_completions VALUES ('stage', 1);
    INSERT INTO display_wheels VALUES ('event', 'stage', 1);`);
  db.close();
  const app = await createApp(path); await app.close();
  const checked = new DatabaseSync(path);
  try {
    expect(checked.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
    expect(checked.prepare('SELECT draw_id FROM station_draws WHERE station = 1').get()?.draw_id).toBe('old-draw');
    expect(checked.prepare('SELECT station FROM station_completions').get()?.station).toBe(1);
    expect(checked.prepare('SELECT station FROM display_wheels').get()?.station).toBe(1);
    expect(checked.prepare('SELECT tournament_id FROM tournament_game_locks').get()?.tournament_id).toBe('event');
    checked.prepare('INSERT INTO station_draws VALUES (?, ?, ?, ?, ?)').run('stage', 2, 'new-draw', 0, 0);
  } finally { checked.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('activates previously saved fixed games when the server is restarted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'retromania-fixed-')), path = join(dir, 'test.sqlite');
  let app = await createApp(path);
  try {
    const event = (await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'Old fixed games', pin: '1234' } })).json();
    const root = `/api/tournaments/${event.id}`, headers = { authorization: `Bearer ${event.token}` };
    const first = (await app.inject({ method: 'POST', url: `${root}/stages`, headers, payload: { name: 'Final', kind: 'elimination', participantCount: 2 } })).json().id;
    await app.inject({ method: 'PUT', url: `${root}/stages/${first}/settings`, headers, payload: { game: 'Pong', gameSelection: 'fixed' } });
    await app.close();
    const legacy = new DatabaseSync(path); legacy.prepare('DELETE FROM station_draws WHERE stage_id = ?').run(first); legacy.close();
    app = await createApp(path);
    expect((await app.inject({ method: 'GET', url: `${root}/stages/${first}/outcome` })).json().game).toBe('Pong');
    expect((await app.inject({ method: 'GET', url: root })).json().gameSelectionStarted).toBe(false);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

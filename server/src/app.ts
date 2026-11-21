import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { WebSocket } from 'ws';
import { registerStageRoutes } from './stages';
import { registerDrawRoutes } from './draws';
import { registerStationRoutes } from './stations';
import { registerLeaderboardRoutes } from './leaderboardRoutes';
import { registerForfeitRoutes } from './forfeits';
import { registerBackupRoutes } from './backups';
import { registerProgressionRoutes } from './progression';
import { registerLaterStageRoutes } from './laterStages';
import { registerWithdrawalRoutes } from './withdrawals';
import { registerWinnerRoutes } from './winner';
import { registerTrophyRoutes } from './trophy';

const text = (value: unknown, max: number): string | null => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;
const pinValid = (value: unknown): value is string => typeof value === 'string' && /^\d{4,12}$/.test(value);
const pinHash = (pin: string, salt: string) => scryptSync(pin, salt, 32).toString('hex');

export async function createApp(databasePath = 'data/retromania.sqlite') {
  if (databasePath !== ':memory:') mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS tournaments (id TEXT PRIMARY KEY, name TEXT NOT NULL, pin_salt TEXT NOT NULL, pin_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS trophy_images (tournament_id TEXT PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tournament_game_locks (tournament_id TEXT PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS participants (id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE, display_name TEXT NOT NULL, real_name TEXT);
    CREATE TABLE IF NOT EXISTS stages (id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE, name TEXT NOT NULL, kind TEXT NOT NULL, participant_count INTEGER, position INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS stage_settings (stage_id TEXT PRIMARY KEY REFERENCES stages(id) ON DELETE CASCADE, settings TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS station_draws (stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE, station INTEGER NOT NULL CHECK (station >= 0), draw_id TEXT NOT NULL, game_index INTEGER NOT NULL, confirmed INTEGER NOT NULL CHECK (confirmed IN (0, 1)), PRIMARY KEY(stage_id, station));
    CREATE TABLE IF NOT EXISTS station_sessions (stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE, station INTEGER NOT NULL, token TEXT NOT NULL, active_participant TEXT REFERENCES participants(id) ON DELETE SET NULL, PRIMARY KEY(stage_id, station));
    CREATE TABLE IF NOT EXISTS attempts (request_id TEXT PRIMARY KEY, stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE RESTRICT, station INTEGER NOT NULL, participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT, attempt INTEGER NOT NULL, value REAL NOT NULL, UNIQUE(stage_id, station, participant_id, attempt));
    CREATE TABLE IF NOT EXISTS withdrawals (participant_id TEXT PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE, stage_id TEXT REFERENCES stages(id) ON DELETE RESTRICT);
    CREATE TABLE IF NOT EXISTS stage_forfeits (stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE RESTRICT, participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT, PRIMARY KEY(stage_id, participant_id));
    CREATE TABLE IF NOT EXISTS attempt_batches (request_id TEXT PRIMARY KEY, stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE, station INTEGER NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS stage_progress (stage_id TEXT PRIMARY KEY REFERENCES stages(id) ON DELETE RESTRICT, status TEXT NOT NULL CHECK (status IN ('active', 'closed')), source_stage_id TEXT REFERENCES stages(id) ON DELETE RESTRICT);
    CREATE TABLE IF NOT EXISTS stage_entrants (stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE RESTRICT, participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT, position INTEGER NOT NULL, PRIMARY KEY(stage_id, participant_id), UNIQUE(stage_id, position));
    CREATE TABLE IF NOT EXISTS stage_results (id TEXT PRIMARY KEY, stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE RESTRICT, position INTEGER NOT NULL, participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT, UNIQUE(stage_id, position));
    CREATE TABLE IF NOT EXISTS withdrawal_replacements (participant_id TEXT PRIMARY KEY REFERENCES withdrawals(participant_id) ON DELETE CASCADE, stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE, replacement_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT);
    CREATE TABLE IF NOT EXISTS station_completions (stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE, station INTEGER NOT NULL CHECK (station >= 0), PRIMARY KEY(stage_id, station));
    CREATE TABLE IF NOT EXISTS display_wheels (tournament_id TEXT PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE, stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE, station INTEGER NOT NULL CHECK (station >= 0));
    CREATE TABLE IF NOT EXISTS tie_resolutions (tie_stage_id TEXT PRIMARY KEY REFERENCES stages(id) ON DELETE RESTRICT, source_stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE RESTRICT, target_stage_id TEXT REFERENCES stages(id) ON DELETE RESTRICT, slots INTEGER NOT NULL);
  `);
  // Older versions limited these tables to two station indices. Rebuild them atomically.
  const legacyStationSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'station_draws'").get()?.sql;
  if (typeof legacyStationSchema === 'string' && /station\s+IN\s*\(\s*0\s*,\s*1\s*\)/i.test(legacyStationSchema)) {
    try { db.exec(`PRAGMA foreign_keys = OFF; BEGIN;
      CREATE TABLE station_draws_new (stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE, station INTEGER NOT NULL CHECK (station >= 0), draw_id TEXT NOT NULL, game_index INTEGER NOT NULL, confirmed INTEGER NOT NULL CHECK (confirmed IN (0, 1)), PRIMARY KEY(stage_id, station));
      INSERT INTO station_draws_new SELECT * FROM station_draws; DROP TABLE station_draws; ALTER TABLE station_draws_new RENAME TO station_draws;
      CREATE TABLE station_completions_new (stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE, station INTEGER NOT NULL CHECK (station >= 0), PRIMARY KEY(stage_id, station));
      INSERT INTO station_completions_new SELECT * FROM station_completions; DROP TABLE station_completions; ALTER TABLE station_completions_new RENAME TO station_completions;
      CREATE TABLE display_wheels_new (tournament_id TEXT PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE, stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE, station INTEGER NOT NULL CHECK (station >= 0));
      INSERT INTO display_wheels_new SELECT * FROM display_wheels; DROP TABLE display_wheels; ALTER TABLE display_wheels_new RENAME TO display_wheels;
      INSERT OR IGNORE INTO tournament_game_locks SELECT DISTINCT stages.tournament_id FROM stages LEFT JOIN station_draws ON station_draws.stage_id = stages.id LEFT JOIN stage_progress ON stage_progress.stage_id = stages.id WHERE station_draws.confirmed = 1 OR stage_progress.status IN ('active', 'closed');
      COMMIT; PRAGMA foreign_keys = ON;`); } catch (error) { try { db.exec('ROLLBACK; PRAGMA foreign_keys = ON;'); } finally { db.close(); } throw error; }
  }
  // Older fixed-game configurations may not yet have an automatic selection.
  const configuredStages = db.prepare('SELECT stage_id, settings FROM stage_settings').all();
  const fixedDraw = db.prepare('INSERT OR IGNORE INTO station_draws (stage_id, station, draw_id, game_index, confirmed) VALUES (?, ?, ?, 0, 1)');
  db.exec('BEGIN');
  try {
    for (const row of configuredStages) {
      const settings = JSON.parse(String(row.settings));
      if (Array.isArray(settings.stations)) settings.stations.forEach((station: { mode?: string; games?: unknown[] }, index: number) => { if (station.mode === 'fixed' && station.games?.length === 1) fixedDraw.run(String(row.stage_id), index, randomUUID()); });
      else if (settings.gameSelection === 'fixed' && typeof settings.game === 'string' && settings.game.trim()) fixedDraw.run(String(row.stage_id), 0, randomUUID());
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  const columns = db.prepare('PRAGMA table_info(station_sessions)').all();
  if (!columns.some(column => column.name === 'active_participant2')) db.exec('ALTER TABLE station_sessions ADD COLUMN active_participant2 TEXT REFERENCES participants(id) ON DELETE SET NULL');
  const app = Fastify({ logger: true, bodyLimit: 8_000_000 });
  const sessions = new Map<string, string>();
  const sockets = new Set<WebSocket>();
  app.addHook('onClose', async () => { for (const socket of sockets) socket.terminate(); db.close(); });
  await app.register(websocket);
  function authorized(header: string | undefined, id: string) { return !!header && sessions.get(header.replace(/^Bearer /, '')) === id; }
  function changed(id: string) { for (const socket of sockets) if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'tournament-changed', id })); }
  function removed(id: string) { for (const socket of sockets) if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'tournament-deleted', id })); }
  function details(id: string, admin: boolean) {
    const tournament = db.prepare('SELECT id, name FROM tournaments WHERE id = ?').get(id);
    if (!tournament) return null;
    const participants = db.prepare('SELECT id, display_name AS displayName, real_name AS realName, EXISTS(SELECT 1 FROM withdrawals WHERE participant_id = participants.id) AS withdrawn FROM participants WHERE tournament_id = ? ORDER BY rowid').all(id);
    const stages = db.prepare("SELECT stages.id, stages.name, stages.kind, stages.participant_count AS participantCount, stage_settings.settings FROM stages LEFT JOIN stage_settings ON stages.id = stage_settings.stage_id WHERE stages.tournament_id = ? AND (? = 1 OR stages.kind != 'tie-breaker' OR EXISTS (SELECT 1 FROM stage_progress WHERE stage_progress.stage_id = stages.id)) ORDER BY stages.position").all(id, admin ? 1 : 0);
    const first = db.prepare("SELECT id FROM stages WHERE tournament_id = ? AND kind != 'tie-breaker' ORDER BY position LIMIT 1").get(id);
    const display = db.prepare('SELECT stage_id, station FROM display_wheels WHERE tournament_id = ?').get(id);
    const activeId = stages.find(stage => db.prepare('SELECT status FROM stage_progress WHERE stage_id = ?').get(stage.id as string)?.status === 'active')?.id ?? (first && !db.prepare('SELECT 1 FROM stage_progress WHERE stage_id = ?').get(first.id as string) ? first.id : null);
    const displayWheel = display && display.stage_id === activeId ? { stageId: String(display.stage_id), station: Number(display.station) } : null;
    return { ...tournament, isAdmin: admin, gameSelectionStarted: !!db.prepare('SELECT 1 FROM tournament_game_locks WHERE tournament_id = ?').get(id), hasTrophyImage: !!db.prepare('SELECT 1 FROM trophy_images WHERE tournament_id = ?').get(id), displayWheel, stages: stages.map(stage => ({ ...stage, status: db.prepare('SELECT status FROM stage_progress WHERE stage_id = ?').get(stage.id as string)?.status ?? (stage.id === first?.id ? 'active' : 'pending'), entrants: db.prepare('SELECT participants.id, participants.display_name AS displayName FROM stage_entrants JOIN participants ON participants.id = stage_entrants.participant_id WHERE stage_entrants.stage_id = ? ORDER BY stage_entrants.position').all(stage.id as string), settings: stage.settings ? JSON.parse(String(stage.settings)) : null, draws: db.prepare('SELECT station, draw_id AS drawId, game_index AS gameIndex, confirmed FROM station_draws WHERE stage_id = ? ORDER BY station').all(stage.id as string).map(draw => ({ ...draw, confirmed: Boolean(draw.confirmed) })) })), participants: participants.map(p => admin ? { id: p.id, displayName: p.displayName, realName: p.realName ?? '', withdrawn: Boolean(p.withdrawn) } : { id: p.id, displayName: p.displayName, withdrawn: Boolean(p.withdrawn) }) };
  }
  app.addHook('preHandler', async (request, reply) => {
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) return;
    const match = /^\/api\/tournaments\/([^/]+)\/stages\/([^/]+)(?:\/(.*))?$/.exec(request.url.split('?')[0]);
    if (!match || match[3] === 'reopen' || match[3] === 'close') return;
    if (db.prepare("SELECT 1 FROM stages JOIN stage_progress ON stage_progress.stage_id = stages.id WHERE stages.id = ? AND stages.tournament_id = ? AND stage_progress.status = 'closed'").get(match[2], match[1])) return reply.code(409).send({ error: 'This stage is closed. Reopen it before making changes.' });
  });
  registerStageRoutes(app, db, authorized, changed);
  registerDrawRoutes(app, db, authorized, changed);
  registerStationRoutes(app, db, authorized, changed, databasePath === ':memory:' ? null : join(dirname(resolve(databasePath)), 'backups'));
  registerLeaderboardRoutes(app, db);
  registerForfeitRoutes(app, db, authorized, changed);
  registerWithdrawalRoutes(app, db, authorized, changed);
  registerBackupRoutes(app, db, authorized, changed);
  registerLaterStageRoutes(app, db, authorized, changed);
  registerWinnerRoutes(app, db);
  registerTrophyRoutes(app, db, authorized, changed);
  registerProgressionRoutes(app, db, authorized, changed, databasePath === ':memory:' ? null : join(dirname(resolve(databasePath)), 'backups'));
  app.get('/api/status', async () => ({ status: 'ok' }));
  app.get('/ws', { websocket: true }, socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.send(JSON.stringify({ status: 'ok' })); });
  app.get('/api/tournaments', async () => db.prepare('SELECT id, name FROM tournaments ORDER BY rowid DESC').all());
  app.post<{ Body: { name?: unknown; pin?: unknown } }>('/api/tournaments', async (request, reply) => {
    const name = text(request.body?.name, 100), pin = request.body?.pin;
    if (!name || !pinValid(pin)) return reply.code(400).send({ error: 'Enter a name and a PIN of 4 to 12 digits.' });
    const id = randomUUID(), salt = randomBytes(16).toString('hex'), token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO tournaments VALUES (?, ?, ?, ?)').run(id, name, salt, pinHash(pin, salt));
    sessions.set(token, id); changed(id); return reply.code(201).send({ id, token });
  });
  app.delete<{ Params: { id: string } }>('/api/tournaments/:id', async (request, reply) => {
    const { id } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    if (!db.prepare('SELECT 1 FROM tournaments WHERE id = ?').get(id)) return reply.code(404).send({ error: 'Tournament not found.' });
    const stages = 'SELECT id FROM stages WHERE tournament_id = ?';
    const participants = 'SELECT id FROM participants WHERE tournament_id = ?';
    db.exec('BEGIN');
    try {
      db.prepare(`DELETE FROM withdrawal_replacements WHERE stage_id IN (${stages}) OR participant_id IN (${participants}) OR replacement_id IN (${participants})`).run(id, id, id);
      db.prepare(`DELETE FROM tie_resolutions WHERE tie_stage_id IN (${stages}) OR source_stage_id IN (${stages}) OR target_stage_id IN (${stages})`).run(id, id, id);
      db.prepare(`DELETE FROM stage_results WHERE stage_id IN (${stages})`).run(id);
      db.prepare(`DELETE FROM stage_entrants WHERE stage_id IN (${stages})`).run(id);
      db.prepare(`DELETE FROM stage_forfeits WHERE stage_id IN (${stages})`).run(id);
      db.prepare(`DELETE FROM attempts WHERE stage_id IN (${stages})`).run(id);
      db.prepare(`DELETE FROM withdrawals WHERE participant_id IN (${participants}) OR stage_id IN (${stages})`).run(id, id);
      db.prepare(`DELETE FROM stage_progress WHERE stage_id IN (${stages}) OR source_stage_id IN (${stages})`).run(id, id);
      db.prepare('DELETE FROM tournaments WHERE id = ?').run(id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    for (const [token, tournamentId] of sessions) if (tournamentId === id) sessions.delete(token);
    removed(id); return { ok: true };
  });
  app.post<{ Params: { id: string }; Body: { pin?: unknown } }>('/api/tournaments/:id/login', async (request, reply) => {
    const row = db.prepare('SELECT pin_salt, pin_hash FROM tournaments WHERE id = ?').get(request.params.id);
    if (!row || !pinValid(request.body?.pin)) return reply.code(401).send({ error: 'Incorrect PIN.' });
    const received = Buffer.from(pinHash(request.body.pin, String(row.pin_salt)), 'hex');
    if (!timingSafeEqual(received, Buffer.from(String(row.pin_hash), 'hex'))) return reply.code(401).send({ error: 'Incorrect PIN.' });
    const token = randomBytes(32).toString('hex'); sessions.set(token, request.params.id); return { token };
  });
  app.post<{ Params: { id: string } }>('/api/tournaments/:id/logout', async request => { const token = request.headers.authorization?.replace(/^Bearer /, ''); if (token && sessions.get(token) === request.params.id) sessions.delete(token); return { ok: true }; });
  app.get<{ Params: { id: string } }>('/api/tournaments/:id', async (request, reply) => details(request.params.id, authorized(request.headers.authorization, request.params.id)) ?? reply.code(404).send({ error: 'Tournament not found.' }));
  app.put<{ Params: { id: string }; Body: { mode?: unknown; stageId?: unknown; station?: unknown } }>('/api/tournaments/:id/display-view', async (request, reply) => {
    const { id } = request.params;
    if (!db.prepare('SELECT 1 FROM tournaments WHERE id = ?').get(id)) return reply.code(404).send({ error: 'Tournament not found.' });
    const { mode, stageId, station } = request.body ?? {};
    if (mode === 'ranking') db.prepare('DELETE FROM display_wheels WHERE tournament_id = ?').run(id);
    else if (mode === 'wheel' && typeof stageId === 'string' && Number.isSafeInteger(station) && (station as number) >= 0) {
      const stage = db.prepare('SELECT stages.kind, stage_progress.status FROM stages LEFT JOIN stage_progress ON stage_progress.stage_id = stages.id WHERE stages.id = ? AND stages.tournament_id = ?').get(stageId, id);
      const first = db.prepare("SELECT id FROM stages WHERE tournament_id = ? AND kind != 'tie-breaker' ORDER BY position LIMIT 1").get(id);
      if (!stage || (stage.status !== 'active' && !(stage.status == null && first?.id === stageId))) return reply.code(409).send({ error: 'Only the active stage can be shown on the TV.' });
      const wheelSettings = db.prepare('SELECT settings FROM stage_settings WHERE stage_id = ?').get(stageId);
      const viewSettings = wheelSettings ? JSON.parse(String(wheelSettings.settings)) : null;
      const configuredStations = stage.kind === 'two-station' ? viewSettings?.stations ?? [{ games: [] }, { games: [] }] : viewSettings?.gameSelection === 'pool' ? [{ games: viewSettings.gamePool ?? [] }] : [];
      if (!configuredStations?.[station as number]) return reply.code(400).send({ error: 'Invalid station.' });
      db.prepare('INSERT INTO display_wheels VALUES (?, ?, ?) ON CONFLICT(tournament_id) DO UPDATE SET stage_id = excluded.stage_id, station = excluded.station').run(id, stageId, station as number);
    } else return reply.code(400).send({ error: 'Choose a wheel or the ranking.' });
    changed(id); return { ok: true };
  });
  app.post<{ Params: { id: string }; Body: { displayName?: unknown; realName?: unknown } }>('/api/tournaments/:id/participants', async (request, reply) => {
    const id = request.params.id;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    if (db.prepare("SELECT 1 FROM stage_progress JOIN stages ON stages.id = stage_progress.stage_id WHERE stages.tournament_id = ? AND stage_progress.status = 'closed' LIMIT 1").get(id)) return reply.code(409).send({ error: 'Adding participants after a stage closes is not supported yet.' });
    if (db.prepare("SELECT 1 FROM stages JOIN stage_progress ON stage_progress.stage_id = stages.id WHERE stages.tournament_id = ? AND stages.kind = 'elimination' AND stage_progress.status = 'active' AND stage_progress.source_stage_id IS NULL").get(id)) return reply.code(409).send({ error: 'Players cannot be added to an elimination stage after it has started.' });
    const name = text(request.body?.displayName, 100), real = request.body?.realName;
    if (!name || (real !== undefined && (typeof real !== 'string' || real.trim().length > 100))) return reply.code(400).send({ error: 'Enter a display name of up to 100 characters.' });
    const participantId = randomUUID();
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO participants VALUES (?, ?, ?, ?)').run(participantId, id, name, typeof real === 'string' ? real.trim() || null : null);
      db.prepare("DELETE FROM station_completions WHERE stage_id IN (SELECT stages.id FROM stages LEFT JOIN stage_progress ON stage_progress.stage_id = stages.id WHERE stages.tournament_id = ? AND COALESCE(stage_progress.status, 'active') != 'closed')").run(id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    changed(id); return reply.code(201).send({ id: participantId });
  });
  app.put<{ Params: { id: string; participantId: string }; Body: { displayName?: unknown; realName?: unknown } }>('/api/tournaments/:id/participants/:participantId', async (request, reply) => {
    const { id, participantId } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    const name = text(request.body?.displayName, 100), real = request.body?.realName;
    if (!name || (real !== undefined && (typeof real !== 'string' || real.trim().length > 100))) return reply.code(400).send({ error: 'Enter a display name of up to 100 characters.' });
    const result = db.prepare('UPDATE participants SET display_name = ?, real_name = ? WHERE id = ? AND tournament_id = ?').run(name, typeof real === 'string' ? real.trim() || null : null, participantId, id);
    if (!result.changes) return reply.code(404).send({ error: 'Participant not found.' }); changed(id); return { ok: true };
  });
  app.delete<{ Params: { id: string; participantId: string } }>('/api/tournaments/:id/participants/:participantId', async (request, reply) => {
    const { id, participantId } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    if (db.prepare('SELECT 1 FROM stages WHERE tournament_id = ? AND (EXISTS (SELECT 1 FROM attempts WHERE stage_id = stages.id) OR EXISTS (SELECT 1 FROM stage_forfeits WHERE stage_id = stages.id) OR EXISTS (SELECT 1 FROM stage_results WHERE stage_id = stages.id)) LIMIT 1').get(id)) return reply.code(409).send({ error: 'Participants cannot be removed after results are entered. Withdrawal is not available yet.' });
    if (db.prepare("SELECT 1 FROM stage_entrants JOIN stage_progress ON stage_progress.stage_id = stage_entrants.stage_id WHERE participant_id = ? AND stage_progress.status = 'active'").get(participantId)) return reply.code(409).send({ error: 'Players cannot be removed from an active stage. Use withdrawal instead.' });
    const result = db.prepare('DELETE FROM participants WHERE id = ? AND tournament_id = ?').run(participantId, id);
    if (!result.changes) return reply.code(404).send({ error: 'Participant not found.' }); changed(id); return { ok: true };
  });
  const clientPath = resolve('dist/client');
  if (existsSync(clientPath)) {
    await app.register(fastifyStatic, { root: clientPath });
    app.get('/display/:id', async (_request, reply) => reply.sendFile('index.html'));
  }
  return app;
}

import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { WebSocket } from 'ws';
import { registerStageRoutes } from './stages';
import { registerDrawRoutes } from './draws';

const text = (value: unknown, max: number): string | null => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;
const pinValid = (value: unknown): value is string => typeof value === 'string' && /^\d{4,12}$/.test(value);
const pinHash = (pin: string, salt: string) => scryptSync(pin, salt, 32).toString('hex');

export async function createApp(databasePath = 'data/retromania.sqlite') {
  if (databasePath !== ':memory:') mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS tournaments (id TEXT PRIMARY KEY, name TEXT NOT NULL, pin_salt TEXT NOT NULL, pin_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS participants (id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE, display_name TEXT NOT NULL, real_name TEXT);
    CREATE TABLE IF NOT EXISTS stages (id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE, name TEXT NOT NULL, kind TEXT NOT NULL, participant_count INTEGER, position INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS stage_settings (stage_id TEXT PRIMARY KEY REFERENCES stages(id) ON DELETE CASCADE, settings TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS station_draws (stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE, station INTEGER NOT NULL CHECK (station IN (0, 1)), draw_id TEXT NOT NULL, game_index INTEGER NOT NULL, confirmed INTEGER NOT NULL CHECK (confirmed IN (0, 1)), PRIMARY KEY(stage_id, station));
  `);
  const app = Fastify({ logger: true });
  const sessions = new Map<string, string>();
  const sockets = new Set<WebSocket>();
  app.addHook('onClose', async () => { for (const socket of sockets) socket.terminate(); db.close(); });
  await app.register(websocket);
  function authorized(header: string | undefined, id: string) { return !!header && sessions.get(header.replace(/^Bearer /, '')) === id; }
  function changed(id: string) { for (const socket of sockets) if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'tournament-changed', id })); }
  function details(id: string, admin: boolean) {
    const tournament = db.prepare('SELECT id, name FROM tournaments WHERE id = ?').get(id);
    if (!tournament) return null;
    const participants = db.prepare('SELECT id, display_name AS displayName, real_name AS realName FROM participants WHERE tournament_id = ? ORDER BY rowid').all(id);
    const stages = db.prepare("SELECT stages.id, stages.name, stages.kind, stages.participant_count AS participantCount, stage_settings.settings FROM stages LEFT JOIN stage_settings ON stages.id = stage_settings.stage_id WHERE stages.tournament_id = ? AND (? = 1 OR stages.kind != 'tie-breaker') ORDER BY stages.position").all(id, admin ? 1 : 0);
    return { ...tournament, isAdmin: admin, stages: stages.map(stage => ({ ...stage, settings: stage.settings ? JSON.parse(String(stage.settings)) : null, draws: db.prepare('SELECT station, draw_id AS drawId, game_index AS gameIndex, confirmed FROM station_draws WHERE stage_id = ? ORDER BY station').all(stage.id as string).map(draw => ({ ...draw, confirmed: Boolean(draw.confirmed) })) })), participants: participants.map(p => admin ? { id: p.id, displayName: p.displayName, realName: p.realName ?? '' } : { id: p.id, displayName: p.displayName }) };
  }
  registerStageRoutes(app, db, authorized, changed);
  registerDrawRoutes(app, db, authorized, changed);
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
  app.post<{ Params: { id: string }; Body: { pin?: unknown } }>('/api/tournaments/:id/login', async (request, reply) => {
    const row = db.prepare('SELECT pin_salt, pin_hash FROM tournaments WHERE id = ?').get(request.params.id);
    if (!row || !pinValid(request.body?.pin)) return reply.code(401).send({ error: 'Incorrect PIN.' });
    const received = Buffer.from(pinHash(request.body.pin, String(row.pin_salt)), 'hex');
    if (!timingSafeEqual(received, Buffer.from(String(row.pin_hash), 'hex'))) return reply.code(401).send({ error: 'Incorrect PIN.' });
    const token = randomBytes(32).toString('hex'); sessions.set(token, request.params.id); return { token };
  });
  app.post<{ Params: { id: string } }>('/api/tournaments/:id/logout', async request => { const token = request.headers.authorization?.replace(/^Bearer /, ''); if (token && sessions.get(token) === request.params.id) sessions.delete(token); return { ok: true }; });
  app.get<{ Params: { id: string } }>('/api/tournaments/:id', async (request, reply) => details(request.params.id, authorized(request.headers.authorization, request.params.id)) ?? reply.code(404).send({ error: 'Tournament not found.' }));
  app.post<{ Params: { id: string }; Body: { displayName?: unknown; realName?: unknown } }>('/api/tournaments/:id/participants', async (request, reply) => {
    const id = request.params.id;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    const name = text(request.body?.displayName, 100), real = request.body?.realName;
    if (!name || (real !== undefined && (typeof real !== 'string' || real.trim().length > 100))) return reply.code(400).send({ error: 'Enter a display name of up to 100 characters.' });
    const participantId = randomUUID(); db.prepare('INSERT INTO participants VALUES (?, ?, ?, ?)').run(participantId, id, name, typeof real === 'string' ? real.trim() || null : null); changed(id); return reply.code(201).send({ id: participantId });
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
    const result = db.prepare('DELETE FROM participants WHERE id = ? AND tournament_id = ?').run(participantId, id);
    if (!result.changes) return reply.code(404).send({ error: 'Participant not found.' }); changed(id); return { ok: true };
  });
  const clientPath = resolve('dist/client');
  if (existsSync(clientPath)) await app.register(fastifyStatic, { root: clientPath });
  return app;
}

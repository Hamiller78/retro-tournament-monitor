import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import type { StageSettings } from '../../shared/contracts';
import { calculateRanking } from './ranking';

type Params = { id: string; stageId: string; station: string };
export function registerStationRoutes(app: FastifyInstance, db: DatabaseSync, authorized: (header: string | undefined, id: string) => boolean, changed: (id: string) => void) {
  const stationRow = (stageId: string, station: number) => db.prepare('SELECT token, active_participant FROM station_sessions WHERE stage_id = ? AND station = ?').get(stageId, station);
  function game(id: string, stageId: string, station: number) {
    const row = db.prepare(`SELECT stage_settings.settings, station_draws.game_index FROM stages JOIN stage_settings ON stage_settings.stage_id = stages.id JOIN station_draws ON station_draws.stage_id = stages.id AND station_draws.station = ? AND station_draws.confirmed = 1 WHERE stages.id = ? AND stages.tournament_id = ? AND stages.kind = 'two-station'`).get(station, stageId, id);
    if (!row) return null;
    const settings = JSON.parse(String(row.settings)) as StageSettings;
    return settings.stations?.[station]?.games[Number(row.game_index)] ?? null;
  }
  function stationIndex(value: string) { return value === '0' || value === '1' ? Number(value) : -1; }
  function owns(header: string | undefined, stageId: string, station: number) { return !!header && stationRow(stageId, station)?.token === header; }
  app.get<{ Params: Params }>('/api/tournaments/:id/stages/:stageId/stations/:station', async (request, reply) => {
    const { id, stageId, station: raw } = request.params; const station = stationIndex(raw);
    if (station < 0) return reply.code(400).send({ error: 'Invalid station.' });
    const selected = game(id, stageId, station); if (!selected) return reply.code(409).send({ error: 'Confirm a game for this station first.' });
    const people = db.prepare('SELECT id, display_name AS displayName FROM participants WHERE tournament_id = ? ORDER BY rowid').all(id);
    const entries = db.prepare('SELECT participant_id AS participantId, attempt, value FROM attempts WHERE stage_id = ? AND station = ? ORDER BY attempt').all(stageId, station);
    const forfeits = new Set(db.prepare('SELECT participant_id FROM stage_forfeits WHERE stage_id = ?').all(stageId).map(row => String(row.participant_id)));
    const players = people.map(p => ({ participantId: String(p.id), displayName: String(p.displayName), attempts: entries.filter(e => e.participantId === p.id).map(e => Number(e.value)) }));
    const ranking = [
      ...calculateRanking(players.filter(p => !forfeits.has(p.participantId)), selected).map(p => ({ ...p, forfeited: false })),
      ...players.filter(p => forfeits.has(p.participantId)).map(p => ({ ...p, best: null, rank: null, forfeited: true })),
    ];
    const session = stationRow(stageId, station);
    return { game: selected, activeParticipant: session?.active_participant ?? null, locked: !!session, controlled: owns(request.headers['x-station-token'] as string | undefined, stageId, station), ranking, entries };
  });
  app.post<{ Params: Params }>('/api/tournaments/:id/stages/:stageId/stations/:station/claim', async (request, reply) => {
    const { id, stageId, station: raw } = request.params; const station = stationIndex(raw);
    if (station < 0) return reply.code(400).send({ error: 'Invalid station.' });
    if (!game(id, stageId, station)) return reply.code(409).send({ error: 'Confirm a game for this station first.' });
    const session = stationRow(stageId, station);
    if (session) {
      if (owns(request.headers['x-station-token'] as string | undefined, stageId, station)) return { token: session.token };
      return reply.code(409).send({ error: 'This station is already controlled by another device.' });
    }
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO station_sessions(stage_id, station, token) VALUES (?, ?, ?)').run(stageId, station, token); changed(id); return { token };
  });
  app.post<{ Params: Params }>('/api/tournaments/:id/stages/:stageId/stations/:station/release', async (request, reply) => {
    const { id, stageId, station: raw } = request.params; const station = stationIndex(raw);
    if (station < 0) return reply.code(400).send({ error: 'Invalid station.' });
    if (!game(id, stageId, station)) return reply.code(404).send({ error: 'Station not found.' });
    if (!owns(request.headers['x-station-token'] as string | undefined, stageId, station) && !authorized(request.headers.authorization, id)) return reply.code(403).send({ error: 'Station control or administrator access required.' });
    db.prepare('DELETE FROM station_sessions WHERE stage_id = ? AND station = ?').run(stageId, station); changed(id); return { ok: true };
  });
  app.put<{ Params: Params; Body: { participantId?: unknown } }>('/api/tournaments/:id/stages/:stageId/stations/:station/active', async (request, reply) => {
    const { id, stageId, station: raw } = request.params; const station = stationIndex(raw);
    if (station < 0) return reply.code(400).send({ error: 'Invalid station.' });
    const selected = game(id, stageId, station); if (!selected) return reply.code(404).send({ error: 'Station not found.' });
    if (!owns(request.headers['x-station-token'] as string | undefined, stageId, station)) return reply.code(403).send({ error: 'Take control of this station first.' });
    const participant = request.body?.participantId;
    if (typeof participant !== 'string' || !db.prepare('SELECT 1 FROM participants WHERE id = ? AND tournament_id = ?').get(participant, id)) return reply.code(400).send({ error: 'Choose a participant.' });
    if (db.prepare('SELECT 1 FROM stage_forfeits WHERE stage_id = ? AND participant_id = ?').get(stageId, participant)) return reply.code(409).send({ error: 'This player has forfeited the stage.' });
    const count = Number(db.prepare('SELECT count(*) AS count FROM attempts WHERE stage_id = ? AND station = ? AND participant_id = ?').get(stageId, station, participant)?.count);
    if (count >= selected.attempts) return reply.code(409).send({ error: 'This player has completed all attempts.' });
    db.prepare('UPDATE station_sessions SET active_participant = ? WHERE stage_id = ? AND station = ?').run(participant, stageId, station); changed(id); return { ok: true };
  });
  app.post<{ Params: Params; Body: { participantId?: unknown; value?: unknown; requestId?: unknown } }>('/api/tournaments/:id/stages/:stageId/stations/:station/attempts', async (request, reply) => {
    const { id, stageId, station: raw } = request.params; const station = stationIndex(raw);
    if (station < 0) return reply.code(400).send({ error: 'Invalid station.' });
    const selected = game(id, stageId, station); if (!selected) return reply.code(404).send({ error: 'Station not found.' });
    if (!owns(request.headers['x-station-token'] as string | undefined, stageId, station)) return reply.code(403).send({ error: 'Take control of this station first.' });
    const { participantId, value, requestId } = request.body ?? {};
    if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId) || typeof participantId !== 'string' || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000000) return reply.code(400).send({ error: 'Enter a valid non-negative result.' });
    const existing = db.prepare('SELECT participant_id, value, stage_id, station FROM attempts WHERE request_id = ?').get(requestId);
    if (existing) return existing.participant_id === participantId && existing.value === value && existing.stage_id === stageId && existing.station === station ? { ok: true } : reply.code(409).send({ error: 'This submission has already been used.' });
    if (db.prepare('SELECT 1 FROM stage_forfeits WHERE stage_id = ? AND participant_id = ?').get(stageId, participantId)) return reply.code(409).send({ error: 'This player has forfeited the stage.' });
    if (stationRow(stageId, station)?.active_participant !== participantId) return reply.code(409).send({ error: 'The active player changed. Check the result before submitting.' });
    const used = db.prepare('SELECT attempt FROM attempts WHERE stage_id = ? AND station = ? AND participant_id = ?').all(stageId, station, participantId).map(r => Number(r.attempt));
    const next = Array.from({ length: selected.attempts }, (_, i) => i + 1).find(n => !used.includes(n));
    if (!next) return reply.code(409).send({ error: 'This player has completed all attempts.' });
    db.prepare('INSERT INTO attempts VALUES (?, ?, ?, ?, ?, ?)').run(requestId, stageId, station, participantId, next, value); changed(id); return reply.code(201).send({ ok: true });
  });
  app.delete<{ Params: Params & { participantId: string; attempt: string } }>('/api/tournaments/:id/stages/:stageId/stations/:station/attempts/:participantId/:attempt', async (request, reply) => {
    const { id, stageId, station: raw, participantId, attempt } = request.params; const station = stationIndex(raw);
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    if (station < 0 || !game(id, stageId, station)) return reply.code(404).send({ error: 'Station not found.' });
    const removed = db.prepare('DELETE FROM attempts WHERE stage_id = ? AND station = ? AND participant_id = ? AND attempt = ?').run(stageId, station, participantId, Number(attempt));
    if (!removed.changes) return reply.code(404).send({ error: 'Attempt not found.' }); changed(id); return { ok: true };
  });
  app.put<{ Params: Params & { participantId: string; attempt: string }; Body: { value?: unknown } }>('/api/tournaments/:id/stages/:stageId/stations/:station/attempts/:participantId/:attempt', async (request, reply) => {
    const { id, stageId, station: raw, participantId, attempt } = request.params; const station = stationIndex(raw); const value = request.body?.value;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    if (station < 0 || !game(id, stageId, station)) return reply.code(404).send({ error: 'Station not found.' });
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000000) return reply.code(400).send({ error: 'Enter a valid non-negative result.' });
    const updated = db.prepare('UPDATE attempts SET value = ? WHERE stage_id = ? AND station = ? AND participant_id = ? AND attempt = ?').run(value, stageId, station, participantId, Number(attempt));
    if (!updated.changes) return reply.code(404).send({ error: 'Attempt not found.' }); changed(id); return { ok: true };
  });
}

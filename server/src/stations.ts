import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import type { StageSettings } from '../../shared/contracts';
import { calculateRanking } from './ranking';
import { advanceStage } from './advance';

type Params = { id: string; stageId: string; station: string };
export function registerStationRoutes(app: FastifyInstance, db: DatabaseSync, authorized: (header: string | undefined, id: string) => boolean, changed: (id: string) => void, backupDirectory: string | null) {
  const stationRow = (stageId: string, station: number) => db.prepare('SELECT token, active_participant, active_participant2 FROM station_sessions WHERE stage_id = ? AND station = ?').get(stageId, station);
  function game(id: string, stageId: string, station: number) {
    const row = db.prepare(`SELECT stage_settings.settings, station_draws.game_index FROM stages JOIN stage_settings ON stage_settings.stage_id = stages.id JOIN station_draws ON station_draws.stage_id = stages.id AND station_draws.station = ? AND station_draws.confirmed = 1 WHERE stages.id = ? AND stages.tournament_id = ? AND stages.kind = 'two-station'`).get(station, stageId, id);
    if (!row) return null;
    const settings = JSON.parse(String(row.settings)) as StageSettings;
    return settings.stations?.[station]?.games[Number(row.game_index)] ?? null;
  }
  function isPlayable(tournamentId: string, stageId: string) {
    const state = db.prepare('SELECT status FROM stage_progress WHERE stage_id = ?').get(stageId);
    if (state) return state.status === 'active';
    return db.prepare("SELECT id FROM stages WHERE tournament_id = ? AND kind != 'tie-breaker' ORDER BY position LIMIT 1").get(tournamentId)?.id === stageId;
  }
  function isEntrant(stageId: string, participantId: string) {
    const state = db.prepare('SELECT source_stage_id FROM stage_progress WHERE stage_id = ?').get(stageId);
    return !state?.source_stage_id || !!db.prepare('SELECT 1 FROM stage_entrants WHERE stage_id = ? AND participant_id = ?').get(stageId, participantId);
  }
  function forfeited(stageId: string, participantId: string) { return !!db.prepare('SELECT 1 FROM stage_forfeits WHERE stage_id = ? AND participant_id = ?').get(stageId, participantId) || !!db.prepare('SELECT 1 FROM withdrawals WHERE participant_id = ?').get(participantId); }
  function isStationClosed(stageId: string, station: number) { return !!db.prepare('SELECT 1 FROM station_completions WHERE stage_id = ? AND station = ?').get(stageId, station); }
  function pendingPlayers(id: string, stageId: string, station: number, attemptsRequired: number) {
    const people = db.prepare('SELECT id FROM participants WHERE tournament_id = ?').all(id).filter(person => isEntrant(stageId, String(person.id)));
    const pending = people.filter(person => {
      if (forfeited(stageId, String(person.id))) return false;
      const count = Number(db.prepare('SELECT COUNT(*) AS count FROM attempts WHERE stage_id = ? AND station = ? AND participant_id = ?').get(stageId, station, String(person.id))?.count);
      return count < attemptsRequired;
    });
    return { total: people.length, pending: pending.length };
  }
  function stationIndex(value: string) { return value === '0' || value === '1' ? Number(value) : -1; }
  function owns(header: string | undefined, stageId: string, station: number) { return !!header && stationRow(stageId, station)?.token === header; }
  app.get<{ Params: Params }>('/api/tournaments/:id/stages/:stageId/stations/:station', async (request, reply) => {
    const { id, stageId, station: raw } = request.params; const station = stationIndex(raw);
    if (station < 0) return reply.code(400).send({ error: 'Invalid station.' });
    const selected = game(id, stageId, station); if (!selected) return reply.code(409).send({ error: 'Confirm a game for this station first.' });
    const people = db.prepare('SELECT id, display_name AS displayName FROM participants WHERE tournament_id = ? ORDER BY rowid').all(id).filter(person => isEntrant(stageId, String(person.id)));
    const entries = db.prepare('SELECT participant_id AS participantId, attempt, value FROM attempts WHERE stage_id = ? AND station = ? ORDER BY attempt').all(stageId, station);
    const forfeits = new Set(db.prepare('SELECT participant_id FROM stage_forfeits WHERE stage_id = ? UNION SELECT participant_id FROM withdrawals').all(stageId).map(row => String(row.participant_id)));
    const withdrawn = new Set(db.prepare('SELECT participant_id FROM withdrawals').all().map(row => String(row.participant_id)));
    const players = people.map(p => ({ participantId: String(p.id), displayName: String(p.displayName), attempts: entries.filter(e => e.participantId === p.id).map(e => Number(e.value)) }));
    const ranking = [
      ...calculateRanking(players.filter(p => !forfeits.has(p.participantId)), selected).map(p => ({ ...p, forfeited: false })),
      ...players.filter(p => forfeits.has(p.participantId)).map(p => ({ ...p, best: null, rank: null, forfeited: true, withdrawn: withdrawn.has(p.participantId) })),
    ];
    const session = stationRow(stageId, station);
    return { game: selected, activeParticipant: session?.active_participant ?? null, activeParticipants: [session?.active_participant, session?.active_participant2].filter(Boolean), locked: !!session, controlled: owns(request.headers['x-station-token'] as string | undefined, stageId, station), stationClosed: isStationClosed(stageId, station), bothStationsClosed: isStationClosed(stageId, 0) && isStationClosed(stageId, 1), ...pendingPlayers(id, stageId, station, selected.attempts), ranking, entries };
  });
  app.post<{ Params: Params }>('/api/tournaments/:id/stages/:stageId/stations/:station/close', async (request, reply) => {
    const { id, stageId, station: raw } = request.params; const station = stationIndex(raw);
    if (station < 0) return reply.code(400).send({ error: 'Invalid station.' });
    const selected = game(id, stageId, station);
    if (!selected || !isPlayable(id, stageId)) return reply.code(409).send({ error: 'This station is not active.' });
    const progress = pendingPlayers(id, stageId, station, selected.attempts);
    if (!progress.total) return reply.code(409).send({ error: 'Add participants before closing the station.' });
    if (progress.pending) return reply.code(409).send({ error: `${progress.pending} player(s) still need results at this station.` });
    db.exec('BEGIN');
    try {
      db.prepare('INSERT OR IGNORE INTO station_completions VALUES (?, ?)').run(stageId, station);
      db.prepare('UPDATE station_sessions SET active_participant = NULL, active_participant2 = NULL WHERE stage_id = ? AND station = ?').run(stageId, station);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    let warning: string | undefined; let advanced = false; let winnerDetermined = false; let tieBreakerActivated = false;
    if (isStationClosed(stageId, 0) && isStationClosed(stageId, 1)) {
      try {
        const result = advanceStage(db, id, stageId, backupDirectory, error => request.log.error(error));
        if (result.ok) { advanced = true; winnerDetermined = result.nextStageId === null; tieBreakerActivated = !!result.tieBreakerActivated; warning = result.warning; }
        else warning = `Station closed, but the stage has not advanced: ${result.error}`;
      } catch (error) { request.log.error(error); warning = 'Station closed, but automatic advancement failed. Please try again.'; }
    }
    changed(id); return { ok: true, advanced, winnerDetermined, tieBreakerActivated, warning };
  });
  app.post<{ Params: Params }>('/api/tournaments/:id/stages/:stageId/stations/:station/reopen', async (request, reply) => {
    const { id, stageId, station: raw } = request.params; const station = stationIndex(raw);
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    if (station < 0) return reply.code(400).send({ error: 'Invalid station.' });
    if (!game(id, stageId, station) || !isPlayable(id, stageId)) return reply.code(409).send({ error: 'This station is not active.' });
    const result = db.prepare('DELETE FROM station_completions WHERE stage_id = ? AND station = ?').run(stageId, station);
    if (!result.changes) return reply.code(409).send({ error: 'This station is already open.' });
    changed(id); return { ok: true };
  });
  app.post<{ Params: Params }>('/api/tournaments/:id/stages/:stageId/stations/:station/claim', async (request, reply) => {
    const { id, stageId, station: raw } = request.params; const station = stationIndex(raw);
    if (station < 0) return reply.code(400).send({ error: 'Invalid station.' });
    if (!game(id, stageId, station)) return reply.code(409).send({ error: 'Confirm a game for this station first.' });
    if (!isPlayable(id, stageId)) return reply.code(409).send({ error: 'This stage is not active.' });
    if (isStationClosed(stageId, station)) return reply.code(409).send({ error: 'This station is closed. An administrator can reopen it.' });
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
  app.put<{ Params: Params; Body: { participantId?: unknown; participantIds?: unknown } }>('/api/tournaments/:id/stages/:stageId/stations/:station/active', async (request, reply) => {
    const { id, stageId, station: raw } = request.params; const station = stationIndex(raw);
    if (station < 0) return reply.code(400).send({ error: 'Invalid station.' });
    const selected = game(id, stageId, station); if (!selected) return reply.code(404).send({ error: 'Station not found.' });
    if (!owns(request.headers['x-station-token'] as string | undefined, stageId, station)) return reply.code(403).send({ error: 'Take control of this station first.' });
    if (!isPlayable(id, stageId)) return reply.code(409).send({ error: 'This stage is not active.' });
    if (isStationClosed(stageId, station)) return reply.code(409).send({ error: 'This station is closed. An administrator can reopen it.' });
    const requested = request.body?.participantIds ?? (typeof request.body?.participantId === 'string' ? [request.body.participantId] : null);
    if (!Array.isArray(requested) || requested.length > (selected.players ?? 1) || requested.some(p => typeof p !== 'string') || new Set(requested).size !== requested.length) return reply.code(400).send({ error: 'Choose up to the allowed number of different players.' });
    for (const participant of requested) {
      if (!db.prepare('SELECT 1 FROM participants WHERE id = ? AND tournament_id = ?').get(participant, id) || !isEntrant(stageId, participant)) return reply.code(400).send({ error: 'Choose a participant.' });
      if (forfeited(stageId, participant)) return reply.code(409).send({ error: 'This player has forfeited the stage.' });
      const count = Number(db.prepare('SELECT count(*) AS count FROM attempts WHERE stage_id = ? AND station = ? AND participant_id = ?').get(stageId, station, participant)?.count);
      if (count >= selected.attempts) return reply.code(409).send({ error: 'This player has completed all attempts.' });
    }
    db.prepare('UPDATE station_sessions SET active_participant = ?, active_participant2 = ? WHERE stage_id = ? AND station = ?').run(requested[0] ?? null, requested[1] ?? null, stageId, station); changed(id); return { ok: true };
  });
  app.post<{ Params: Params; Body: { requestId?: unknown; results?: unknown } }>('/api/tournaments/:id/stages/:stageId/stations/:station/attempts/batch', async (request, reply) => {
    const { id, stageId, station: raw } = request.params; const station = stationIndex(raw);
    if (station < 0) return reply.code(400).send({ error: 'Invalid station.' });
    const selected = game(id, stageId, station); if (!selected) return reply.code(404).send({ error: 'Station not found.' });
    if (!owns(request.headers['x-station-token'] as string | undefined, stageId, station)) return reply.code(403).send({ error: 'Take control of this station first.' });
    if (!isPlayable(id, stageId)) return reply.code(409).send({ error: 'This stage is not active.' });
    if (isStationClosed(stageId, station)) return reply.code(409).send({ error: 'This station is closed. An administrator can reopen it.' });
    const requestId = request.body?.requestId, results = request.body?.results;
    if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId) || !Array.isArray(results) || results.length < 1 || results.length > (selected.players ?? 1)) return reply.code(400).send({ error: 'Enter results for the active players.' });
    const valid = results.every(r => r && typeof r.participantId === 'string' && typeof r.value === 'number' && Number.isFinite(r.value) && r.value >= 0 && r.value <= 1000000000);
    if (!valid || new Set(results.map(r => r.participantId)).size !== results.length) return reply.code(400).send({ error: 'Enter one valid non-negative result per player.' });
    const normalized = results.map(r => ({ participantId: r.participantId as string, value: r.value as number })).sort((a, b) => a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0);
    const payload = JSON.stringify(normalized);
    const existing = db.prepare('SELECT stage_id, station, payload FROM attempt_batches WHERE request_id = ?').get(requestId);
    if (existing) return existing.stage_id === stageId && existing.station === station && existing.payload === payload ? { ok: true } : reply.code(409).send({ error: 'This submission has already been used.' });
    const session = stationRow(stageId, station);
    const active = [session?.active_participant, session?.active_participant2].filter(Boolean).map(String).filter(participant => {
      const count = Number(db.prepare('SELECT count(*) AS count FROM attempts WHERE stage_id = ? AND station = ? AND participant_id = ?').get(stageId, station, participant)?.count);
      return count < selected.attempts && !forfeited(stageId, participant);
    }).sort();
    if (active.length !== normalized.length || active.some((value, index) => value !== normalized[index].participantId)) return reply.code(409).send({ error: 'The active players changed. Check the results before submitting.' });
    const records: { participantId: string; value: number; attempt: number }[] = [];
    for (const result of normalized) {
      if (forfeited(stageId, result.participantId)) return reply.code(409).send({ error: 'A selected player has forfeited the stage.' });
      const used = db.prepare('SELECT attempt FROM attempts WHERE stage_id = ? AND station = ? AND participant_id = ?').all(stageId, station, result.participantId).map(row => Number(row.attempt));
      const attempt = Array.from({ length: selected.attempts }, (_, i) => i + 1).find(n => !used.includes(n));
      if (!attempt) return reply.code(409).send({ error: 'A selected player has completed all attempts.' });
      records.push({ ...result, attempt });
    }
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO attempt_batches VALUES (?, ?, ?, ?)').run(requestId, stageId, station, payload);
      const insert = db.prepare('INSERT INTO attempts VALUES (?, ?, ?, ?, ?, ?)');
      for (const record of records) insert.run(randomUUID(), stageId, station, record.participantId, record.attempt, record.value);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    changed(id); return reply.code(201).send({ ok: true });
  });
  app.post<{ Params: Params; Body: { participantId?: unknown; value?: unknown; requestId?: unknown } }>('/api/tournaments/:id/stages/:stageId/stations/:station/attempts', async (request, reply) => {
    const { id, stageId, station: raw } = request.params; const station = stationIndex(raw);
    if (station < 0) return reply.code(400).send({ error: 'Invalid station.' });
    const selected = game(id, stageId, station); if (!selected) return reply.code(404).send({ error: 'Station not found.' });
    if (!owns(request.headers['x-station-token'] as string | undefined, stageId, station)) return reply.code(403).send({ error: 'Take control of this station first.' });
    if (!isPlayable(id, stageId)) return reply.code(409).send({ error: 'This stage is not active.' });
    if (isStationClosed(stageId, station)) return reply.code(409).send({ error: 'This station is closed. An administrator can reopen it.' });
    const { participantId, value, requestId } = request.body ?? {};
    if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId) || typeof participantId !== 'string' || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000000) return reply.code(400).send({ error: 'Enter a valid non-negative result.' });
    const existing = db.prepare('SELECT participant_id, value, stage_id, station FROM attempts WHERE request_id = ?').get(requestId);
    if (existing) return existing.participant_id === participantId && existing.value === value && existing.stage_id === stageId && existing.station === station ? { ok: true } : reply.code(409).send({ error: 'This submission has already been used.' });
    if (forfeited(stageId, participantId)) return reply.code(409).send({ error: 'This player has forfeited the stage.' });
    if (stationRow(stageId, station)?.active_participant2) return reply.code(409).send({ error: 'Enter results for both active players together.' });
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
    db.exec('BEGIN');
    try {
      const removed = db.prepare('DELETE FROM attempts WHERE stage_id = ? AND station = ? AND participant_id = ? AND attempt = ?').run(stageId, station, participantId, Number(attempt));
      if (!removed.changes) { db.exec('ROLLBACK'); return reply.code(404).send({ error: 'Attempt not found.' }); }
      db.prepare('DELETE FROM station_completions WHERE stage_id = ? AND station = ?').run(stageId, station);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    changed(id); return { ok: true };
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

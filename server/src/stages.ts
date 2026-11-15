import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { eligiblePlayers } from './eligibility';

const kinds = ['two-station', 'elimination', 'duel', 'tie-breaker'] as const;
type Params = { id: string; stageId: string };
type Body = { name?: unknown; kind?: unknown; participantCount?: unknown };

export function registerStageRoutes(app: FastifyInstance, db: DatabaseSync, authorized: (header: string | undefined, id: string) => boolean, changed: (id: string) => void) {
  function validate(body: Body | undefined) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const kind = body?.kind;
    const count = body?.participantCount;
    if (!name || name.length > 100 || typeof kind !== 'string' || !kinds.includes(kind as typeof kinds[number]) || !(count === null || (typeof count === 'number' && Number.isSafeInteger(count) && count >= 1 && count <= 999))) return null;
    return { name, kind, count };
  }
  app.post<{ Params: { id: string }; Body: Body }>('/api/tournaments/:id/stages', async (request, reply) => {
    const { id } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    const stage = validate(request.body);
    if (!stage) return reply.code(400).send({ error: 'Enter a stage name, format, and a valid participant count.' });
    const stageId = randomUUID();
    db.prepare('INSERT INTO stages (id, tournament_id, name, kind, participant_count, position) VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM stages WHERE tournament_id = ?))').run(stageId, id, stage.name, stage.kind, stage.count, id);
    changed(id); return reply.code(201).send({ id: stageId });
  });
  app.put<{ Params: Params; Body: Body }>('/api/tournaments/:id/stages/:stageId', async (request, reply) => {
    const { id, stageId } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    if (db.prepare('SELECT 1 FROM stages WHERE id = ? AND (EXISTS (SELECT 1 FROM attempts WHERE stage_id = stages.id) OR EXISTS (SELECT 1 FROM stage_forfeits WHERE stage_id = stages.id) OR EXISTS (SELECT 1 FROM stage_results WHERE stage_id = stages.id))').get(stageId)) return reply.code(409).send({ error: 'Stage settings cannot change after results have been entered.' });
    const stage = validate(request.body);
    if (!stage) return reply.code(400).send({ error: 'Enter a stage name, format, and a valid participant count.' });
    const existing = db.prepare('SELECT kind FROM stages WHERE id = ? AND tournament_id = ?').get(stageId, id);
    if (existing && existing.kind !== stage.kind && db.prepare('SELECT 1 FROM station_draws WHERE stage_id = ? AND confirmed = 1').get(stageId)) return reply.code(409).send({ error: 'Unlock confirmed station games before changing the stage format.' });
    if (!existing) return reply.code(404).send({ error: 'Stage not found.' });
    if (existing.kind !== stage.kind && db.prepare('SELECT 1 FROM tie_resolutions WHERE tie_stage_id = ? OR source_stage_id = ? OR target_stage_id = ?').get(stageId, stageId, stageId)) return reply.code(409).send({ error: 'Reopen the previous stage before changing this stage format.' });
    const progress = db.prepare('SELECT source_stage_id FROM stage_progress WHERE stage_id = ?').get(stageId);
    const original = db.prepare('SELECT participant_count FROM stages WHERE id = ?').get(stageId);
    if (original?.participant_count !== stage.count && db.prepare("SELECT 1 FROM tie_resolutions WHERE target_stage_id = ?").get(stageId)) return reply.code(409).send({ error: 'Reopen the stage before the tie-breaker before changing the next stage player count.' });
    if (original?.participant_count !== stage.count && db.prepare('SELECT 1 FROM withdrawal_replacements WHERE stage_id = ?').get(stageId)) return reply.code(409).send({ error: 'Resolve replacement players before changing this stage player count.' });
    let entrants: string[] | undefined;
    if (progress?.source_stage_id && original?.participant_count !== stage.count) {
      if (stage.count === null) return reply.code(409).send({ error: 'An active stage needs a player count.' });
      const selection = eligiblePlayers(db, id, String(progress.source_stage_id), stage.count);
      if (!selection.players) return reply.code(409).send({ error: selection.error });
      entrants = selection.players;
    }
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE stages SET name = ?, kind = ?, participant_count = ? WHERE id = ? AND tournament_id = ?').run(stage.name, stage.kind, stage.count, stageId, id);
      if (existing.kind !== stage.kind) { db.prepare('DELETE FROM stage_settings WHERE stage_id = ?').run(stageId); db.prepare('DELETE FROM station_draws WHERE stage_id = ?').run(stageId); }
      if (entrants) { db.prepare('DELETE FROM stage_entrants WHERE stage_id = ?').run(stageId); const insert = db.prepare('INSERT INTO stage_entrants VALUES (?, ?, ?)'); entrants.forEach((player, position) => insert.run(stageId, player, position)); }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    changed(id); return { ok: true };
  });
  app.delete<{ Params: Params }>('/api/tournaments/:id/stages/:stageId', async (request, reply) => {
    const { id, stageId } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    if (db.prepare('SELECT 1 FROM stages WHERE id = ? AND (EXISTS (SELECT 1 FROM attempts WHERE stage_id = stages.id) OR EXISTS (SELECT 1 FROM stage_forfeits WHERE stage_id = stages.id) OR EXISTS (SELECT 1 FROM stage_results WHERE stage_id = stages.id))').get(stageId)) return reply.code(409).send({ error: 'A stage with results cannot be removed.' });
    if (db.prepare('SELECT 1 FROM stage_progress WHERE stage_id = ?').get(stageId)) return reply.code(409).send({ error: 'Reopen the previous stage before removing this stage.' });
    if (db.prepare('SELECT 1 FROM tie_resolutions WHERE tie_stage_id = ? OR source_stage_id = ? OR target_stage_id = ?').get(stageId, stageId, stageId)) return reply.code(409).send({ error: 'Reopen the stage before the tie-breaker before removing this stage.' });
    if (db.prepare('SELECT 1 FROM withdrawals WHERE stage_id = ?').get(stageId)) return reply.code(409).send({ error: 'Reactivate withdrawn players before removing the stage.' });
    const result = db.prepare('DELETE FROM stages WHERE id = ? AND tournament_id = ?').run(stageId, id);
    if (!result.changes) return reply.code(404).send({ error: 'Stage not found.' });
    changed(id); return { ok: true };
  });
  app.put<{ Params: Params; Body: unknown }>('/api/tournaments/:id/stages/:stageId/settings', async (request, reply) => {
    const { id, stageId } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    if (db.prepare('SELECT 1 FROM stages WHERE id = ? AND (EXISTS (SELECT 1 FROM attempts WHERE stage_id = stages.id) OR EXISTS (SELECT 1 FROM stage_forfeits WHERE stage_id = stages.id) OR EXISTS (SELECT 1 FROM stage_results WHERE stage_id = stages.id))').get(stageId)) return reply.code(409).send({ error: 'Stage settings cannot change after results have been entered.' });
    const stage = db.prepare('SELECT kind FROM stages WHERE id = ? AND tournament_id = ?').get(stageId, id);
    if (!stage) return reply.code(404).send({ error: 'Stage not found.' });
    const value = request.body;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return reply.code(400).send({ error: 'Invalid settings.' });
    const data = value as Record<string, unknown>;
    if (stage.kind === 'two-station') {
      const stations = data.stations, points = data.points;
      if (!Array.isArray(stations) || stations.length !== 2 || !Array.isArray(points) || points.length > 999 || !points.every(p => Number.isSafeInteger(p) && p >= 0 && p <= 1000000)) return reply.code(400).send({ error: 'Check the station pools and points schedule.' });
      for (const station of stations) {
        if (!station || typeof station !== 'object' || !Array.isArray(station.games) || station.games.length > 100) return reply.code(400).send({ error: 'Check the station pools.' });
        for (const game of station.games) if (!game || typeof game.name !== 'string' || !game.name.trim() || game.name.trim().length > 100 || !['score', 'time'].includes(game.resultKind) || typeof game.higherIsBetter !== 'boolean' || (game.players !== undefined && game.players !== 1 && game.players !== 2) || !Number.isSafeInteger(game.attempts) || game.attempts < 1 || game.attempts > 100) return reply.code(400).send({ error: 'Check each game name, result type, and attempts.' });
      }
      const prior = db.prepare('SELECT settings FROM stage_settings WHERE stage_id = ?').get(stageId);
      const oldSettings = prior ? JSON.parse(String(prior.settings)) : null;
      const changedPools = [0, 1].filter(station => JSON.stringify(oldSettings?.stations?.[station]?.games ?? []) !== JSON.stringify(stations[station].games));
      for (const station of changedPools) if (db.prepare('SELECT 1 FROM station_draws WHERE stage_id = ? AND station = ? AND confirmed = 1').get(stageId, station)) return reply.code(409).send({ error: `Unlock station ${station + 1} before changing its confirmed game pool.` });
      db.exec('BEGIN');
      try {
        for (const station of changedPools) db.prepare('DELETE FROM station_draws WHERE stage_id = ? AND station = ? AND confirmed = 0').run(stageId, station);
        db.prepare('INSERT INTO stage_settings VALUES (?, ?) ON CONFLICT(stage_id) DO UPDATE SET settings = excluded.settings').run(stageId, JSON.stringify({ stations, points }));
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } else {
      if (typeof data.game !== 'string' || data.game.length > 100 || (stage.kind === 'duel' && ![1, 3, 5].includes(data.bestOf as number))) return reply.code(400).send({ error: 'Check the game and match format.' });
      const settings = stage.kind === 'duel' ? { game: data.game.trim(), bestOf: data.bestOf } : { game: data.game.trim() };
      db.prepare('INSERT INTO stage_settings VALUES (?, ?) ON CONFLICT(stage_id) DO UPDATE SET settings = excluded.settings').run(stageId, JSON.stringify(settings));
    }
    changed(id); return { ok: true };
  });
  app.post<{ Params: Params; Body: { direction?: unknown } }>('/api/tournaments/:id/stages/:stageId/move', async (request, reply) => {
    const { id, stageId } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    if (db.prepare('SELECT 1 FROM stages WHERE tournament_id = ? AND (EXISTS (SELECT 1 FROM stage_progress WHERE stage_id = stages.id) OR EXISTS (SELECT 1 FROM attempts WHERE stage_id = stages.id) OR EXISTS (SELECT 1 FROM stage_forfeits WHERE stage_id = stages.id) OR EXISTS (SELECT 1 FROM stage_results WHERE stage_id = stages.id)) LIMIT 1').get(id)) return reply.code(409).send({ error: 'Stage order cannot be changed after results have been recorded.' });
    const direction = request.body?.direction;
    if (direction !== 'up' && direction !== 'down') return reply.code(400).send({ error: 'Invalid direction.' });
    const rows = db.prepare('SELECT id, position FROM stages WHERE tournament_id = ? ORDER BY position').all(id);
    const index = rows.findIndex(row => row.id === stageId);
    if (index < 0) return reply.code(404).send({ error: 'Stage not found.' });
    const other = index + (direction === 'up' ? -1 : 1);
    if (other < 0 || other >= rows.length) return reply.code(400).send({ error: 'Stage cannot move further.' });
    db.exec('BEGIN');
    try { const update = db.prepare('UPDATE stages SET position = ? WHERE id = ? AND tournament_id = ?'); update.run(rows[other].position as number, stageId, id); update.run(rows[index].position as number, rows[other].id as string, id); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    changed(id); return { ok: true };
  });
}

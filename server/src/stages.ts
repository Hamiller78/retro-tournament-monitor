import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

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
    if (db.prepare('SELECT 1 FROM stages WHERE id = ? AND (EXISTS (SELECT 1 FROM attempts WHERE stage_id = stages.id) OR EXISTS (SELECT 1 FROM stage_forfeits WHERE stage_id = stages.id))').get(stageId)) return reply.code(409).send({ error: 'Stage settings cannot change after results have been entered.' });
    const stage = validate(request.body);
    if (!stage) return reply.code(400).send({ error: 'Enter a stage name, format, and a valid participant count.' });
    const existing = db.prepare('SELECT kind FROM stages WHERE id = ? AND tournament_id = ?').get(stageId, id);
    if (existing && existing.kind !== stage.kind && db.prepare('SELECT 1 FROM station_draws WHERE stage_id = ? AND confirmed = 1').get(stageId)) return reply.code(409).send({ error: 'Unlock confirmed station games before changing the stage format.' });
    const result = db.prepare('UPDATE stages SET name = ?, kind = ?, participant_count = ? WHERE id = ? AND tournament_id = ?').run(stage.name, stage.kind, stage.count, stageId, id);
    if (existing && existing.kind !== stage.kind) { db.prepare('DELETE FROM stage_settings WHERE stage_id = ?').run(stageId); db.prepare('DELETE FROM station_draws WHERE stage_id = ?').run(stageId); }
    if (!result.changes) return reply.code(404).send({ error: 'Stage not found.' });
    changed(id); return { ok: true };
  });
  app.delete<{ Params: Params }>('/api/tournaments/:id/stages/:stageId', async (request, reply) => {
    const { id, stageId } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    if (db.prepare('SELECT 1 FROM stages WHERE id = ? AND (EXISTS (SELECT 1 FROM attempts WHERE stage_id = stages.id) OR EXISTS (SELECT 1 FROM stage_forfeits WHERE stage_id = stages.id))').get(stageId)) return reply.code(409).send({ error: 'A stage with results cannot be removed.' });
    const result = db.prepare('DELETE FROM stages WHERE id = ? AND tournament_id = ?').run(stageId, id);
    if (!result.changes) return reply.code(404).send({ error: 'Stage not found.' });
    changed(id); return { ok: true };
  });
  app.put<{ Params: Params; Body: unknown }>('/api/tournaments/:id/stages/:stageId/settings', async (request, reply) => {
    const { id, stageId } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    if (db.prepare('SELECT 1 FROM stages WHERE id = ? AND (EXISTS (SELECT 1 FROM attempts WHERE stage_id = stages.id) OR EXISTS (SELECT 1 FROM stage_forfeits WHERE stage_id = stages.id))').get(stageId)) return reply.code(409).send({ error: 'Stage settings cannot change after results have been entered.' });
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
        for (const game of station.games) if (!game || typeof game.name !== 'string' || !game.name.trim() || game.name.trim().length > 100 || !['score', 'time'].includes(game.resultKind) || typeof game.higherIsBetter !== 'boolean' || !Number.isSafeInteger(game.attempts) || game.attempts < 1 || game.attempts > 100) return reply.code(400).send({ error: 'Check each game name, result type, and attempts.' });
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

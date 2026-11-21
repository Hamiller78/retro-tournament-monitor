import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { randomInt, randomUUID } from 'node:crypto';
import type { StageSettings } from '../../shared/contracts';

type Params = { id: string; stageId: string; station: string };
export function registerDrawRoutes(app: FastifyInstance, db: DatabaseSync, authorized: (header: string | undefined, id: string) => boolean, changed: (id: string) => void) {
  function stageData(id: string, stageId: string) {
    const row = db.prepare('SELECT stages.kind, stage_settings.settings FROM stages LEFT JOIN stage_settings ON stages.id = stage_settings.stage_id WHERE stages.id = ? AND stages.tournament_id = ?').get(stageId, id);
    if (!row) return null;
    const settings = row.settings ? JSON.parse(String(row.settings)) as StageSettings : {};
    if (row.kind === 'two-station') return settings;
    if (!settings.gameSelection) return null;
    const names = settings.gameSelection === 'pool' ? settings.gamePool ?? [] : settings.game ? [settings.game] : [];
    return { stations: [{ mode: settings.gameSelection, games: names.map(game => ({ ...(typeof game === 'string' ? { name: game } : game), resultKind: 'score' as const, higherIsBetter: true, attempts: 1 })) }] };

  }
  function isActive(tournamentId: string, stageId: string) {
    const state = db.prepare('SELECT status FROM stage_progress WHERE stage_id = ?').get(stageId);
    if (state) return state.status === 'active';
    return db.prepare("SELECT id FROM stages WHERE tournament_id = ? AND kind != 'tie-breaker' ORDER BY position LIMIT 1").get(tournamentId)?.id === stageId;
  }
  app.post<{ Params: Params }>('/api/tournaments/:id/stages/:stageId/stations/:station/spin', async (request, reply) => {
    const { id, stageId, station: raw } = request.params;
    if (!/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) return reply.code(400).send({ error: 'Invalid station.' });
    const settings = stageData(id, stageId); if (!settings) return reply.code(404).send({ error: 'Stage not found.' });
    if (!isActive(id, stageId)) return reply.code(409).send({ error: 'This stage is not active.' });
    const station = Number(raw), games = settings.stations?.[station]?.games ?? [];
    if (!settings.stations?.[station]) return reply.code(400).send({ error: 'Invalid station.' });
    if (settings.stations?.[station]?.mode === 'fixed') return reply.code(409).send({ error: 'This station uses a fixed game.' });
    if (!games.length) return reply.code(400).send({ error: 'Add games to this station before spinning.' });
    const previous = db.prepare('SELECT confirmed FROM station_draws WHERE stage_id = ? AND station = ?').get(stageId, station);
    if (previous?.confirmed) return reply.code(409).send({ error: 'Unlock the confirmed game before spinning again.' });
    const drawId = randomUUID(), gameIndex = randomInt(games.length);
    db.prepare('INSERT INTO station_draws VALUES (?, ?, ?, ?, 0) ON CONFLICT(stage_id, station) DO UPDATE SET draw_id = excluded.draw_id, game_index = excluded.game_index, confirmed = 0').run(stageId, station, drawId, gameIndex);
    changed(id); return { station, drawId, gameIndex, confirmed: false };
  });
  app.post<{ Params: Params; Body: { drawId?: unknown } }>('/api/tournaments/:id/stages/:stageId/stations/:station/confirm', async (request, reply) => {
    const { id, stageId, station: raw } = request.params;
    if (!/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) return reply.code(400).send({ error: 'Invalid station.' });
    const settings = stageData(id, stageId); if (!settings) return reply.code(404).send({ error: 'Stage not found.' });
    if (!isActive(id, stageId)) return reply.code(409).send({ error: 'This stage is not active.' });
    const station = Number(raw), draw = db.prepare('SELECT draw_id, game_index, confirmed FROM station_draws WHERE stage_id = ? AND station = ?').get(stageId, station);
    if (!draw || draw.draw_id !== request.body?.drawId || draw.confirmed) return reply.code(409).send({ error: 'This draw has changed. Please review the current selection.' });
    const chosen = settings.stations?.[station]?.games[Number(draw.game_index)];
    if (!chosen) return reply.code(409).send({ error: 'The game pool has changed. Spin again.' });
    db.exec('BEGIN');
    try { db.prepare('UPDATE station_draws SET confirmed = 1 WHERE stage_id = ? AND station = ?').run(stageId, station); db.prepare('INSERT OR IGNORE INTO tournament_game_locks VALUES (?)').run(id); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
    changed(id); return { ok: true };
  });
  app.post<{ Params: Params }>('/api/tournaments/:id/stages/:stageId/stations/:station/unlock', async (request, reply) => {
    const { id, stageId, station: raw } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    if (!/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) return reply.code(400).send({ error: 'Invalid station.' });
    if (!stageData(id, stageId)) return reply.code(404).send({ error: 'Stage not found.' });
    if (!isActive(id, stageId)) return reply.code(409).send({ error: 'This stage is not active.' });
    if (db.prepare('SELECT 1 FROM attempts WHERE stage_id = ? AND station = ? UNION ALL SELECT 1 FROM stage_results WHERE stage_id = ? LIMIT 1').get(stageId, Number(raw), stageId)) return reply.code(409).send({ error: 'A game cannot be unlocked after results have been entered.' });
    db.prepare('DELETE FROM station_sessions WHERE stage_id = ? AND station = ?').run(stageId, Number(raw));
    db.prepare('DELETE FROM station_draws WHERE stage_id = ? AND station = ?').run(stageId, Number(raw)); changed(id); return { ok: true };
  });
}

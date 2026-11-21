import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';

type Params = { id: string; stageId: string; participantId: string };
export function registerForfeitRoutes(app: FastifyInstance, db: DatabaseSync, authorized: (header: string | undefined, id: string) => boolean, changed: (id: string) => void) {
  function valid(id: string, stageId: string, participantId: string) {
    const row = db.prepare(`SELECT stages.id, stage_progress.status, stage_progress.source_stage_id FROM stages JOIN participants ON participants.tournament_id = stages.tournament_id LEFT JOIN stage_progress ON stage_progress.stage_id = stages.id WHERE stages.id = ? AND stages.tournament_id = ? AND stages.kind = 'two-station' AND participants.id = ?`).get(stageId, id, participantId);
    if (!row) return false;
    const first = db.prepare("SELECT id FROM stages WHERE tournament_id = ? AND kind != 'tie-breaker' ORDER BY position LIMIT 1").get(id);
    if (row.status !== 'active' && !(row.status == null && first?.id === stageId)) return false;
    return !row.source_stage_id || !!db.prepare('SELECT 1 FROM stage_entrants WHERE stage_id = ? AND participant_id = ?').get(stageId, participantId);
  }
  app.post<{ Params: Params }>('/api/tournaments/:id/stages/:stageId/forfeits/:participantId', async (request, reply) => {
    const { id, stageId, participantId } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    if (!valid(id, stageId, participantId)) return reply.code(404).send({ error: 'Stage or participant not found.' });
    db.exec('BEGIN');
    try {
      db.prepare('INSERT OR IGNORE INTO stage_forfeits (stage_id, participant_id) VALUES (?, ?)').run(stageId, participantId);
      db.prepare('UPDATE station_sessions SET active_participant = active_participant2, active_participant2 = NULL WHERE stage_id = ? AND active_participant = ?').run(stageId, participantId);
      db.prepare('UPDATE station_sessions SET active_participant2 = NULL WHERE stage_id = ? AND active_participant2 = ?').run(stageId, participantId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    changed(id); return { ok: true };
  });
  app.delete<{ Params: Params }>('/api/tournaments/:id/stages/:stageId/forfeits/:participantId', async (request, reply) => {
    const { id, stageId, participantId } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    if (!valid(id, stageId, participantId)) return reply.code(404).send({ error: 'Stage or participant not found.' });
    if (db.prepare('SELECT 1 FROM withdrawals WHERE participant_id = ?').get(participantId)) return reply.code(409).send({ error: 'Reactivate this withdrawn player in tournament setup first.' });
    db.exec('BEGIN');
    try {
      const result = db.prepare('DELETE FROM stage_forfeits WHERE stage_id = ? AND participant_id = ?').run(stageId, participantId);
      if (!result.changes) { db.exec('ROLLBACK'); return reply.code(404).send({ error: 'Forfeit not found.' }); }
      const settingsRow = db.prepare('SELECT settings FROM stage_settings WHERE stage_id = ?').get(stageId);
      const settings = settingsRow ? JSON.parse(String(settingsRow.settings)) : null;
      for (const station of (settings?.stations ?? []).map((_: unknown, i: number) => i)) {
        const draw = db.prepare('SELECT game_index FROM station_draws WHERE stage_id = ? AND station = ? AND confirmed = 1').get(stageId, station);
        const required = draw ? settings?.stations?.[station]?.games?.[Number(draw.game_index)]?.attempts : null;
        const count = Number(db.prepare('SELECT COUNT(*) AS count FROM attempts WHERE stage_id = ? AND station = ? AND participant_id = ?').get(stageId, station, participantId)?.count);
        if (!required || count < required) db.prepare('DELETE FROM station_completions WHERE stage_id = ? AND station = ?').run(stageId, station);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    changed(id); return { ok: true };
  });
}

import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';

type Params = { id: string; stageId: string; participantId: string };
export function registerForfeitRoutes(app: FastifyInstance, db: DatabaseSync, authorized: (header: string | undefined, id: string) => boolean, changed: (id: string) => void) {
  function valid(id: string, stageId: string, participantId: string) {
    return !!db.prepare(`SELECT 1 FROM stages JOIN participants ON participants.tournament_id = stages.tournament_id WHERE stages.id = ? AND stages.tournament_id = ? AND stages.kind = 'two-station' AND participants.id = ?`).get(stageId, id, participantId);
  }
  app.post<{ Params: Params }>('/api/tournaments/:id/stages/:stageId/forfeits/:participantId', async (request, reply) => {
    const { id, stageId, participantId } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    if (!valid(id, stageId, participantId)) return reply.code(404).send({ error: 'Stage or participant not found.' });
    db.exec('BEGIN');
    try {
      db.prepare('INSERT OR IGNORE INTO stage_forfeits (stage_id, participant_id) VALUES (?, ?)').run(stageId, participantId);
      db.prepare('UPDATE station_sessions SET active_participant = NULL WHERE stage_id = ? AND active_participant = ?').run(stageId, participantId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    changed(id); return { ok: true };
  });
  app.delete<{ Params: Params }>('/api/tournaments/:id/stages/:stageId/forfeits/:participantId', async (request, reply) => {
    const { id, stageId, participantId } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    if (!valid(id, stageId, participantId)) return reply.code(404).send({ error: 'Stage or participant not found.' });
    const result = db.prepare('DELETE FROM stage_forfeits WHERE stage_id = ? AND participant_id = ?').run(stageId, participantId);
    if (!result.changes) return reply.code(404).send({ error: 'Forfeit not found.' });
    changed(id); return { ok: true };
  });
}

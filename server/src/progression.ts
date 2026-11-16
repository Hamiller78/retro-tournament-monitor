import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { advanceStage } from './advance';

type Params = { id: string; stageId: string };
export function registerProgressionRoutes(app: FastifyInstance, db: DatabaseSync, authorized: (header: string | undefined, id: string) => boolean, changed: (id: string) => void, backupDirectory: string | null) {
  app.post<{ Params: Params }>('/api/tournaments/:id/stages/:stageId/close', async (request, reply) => {
    const { id, stageId } = request.params;
    const stage = db.prepare('SELECT kind FROM stages WHERE id = ? AND tournament_id = ?').get(stageId, id);
    if (!stage) return reply.code(404).send({ error: 'Stage not found.' });
    if (stage.kind !== 'elimination' && stage.kind !== 'tie-breaker' && !authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    const result = advanceStage(db, id, stageId, backupDirectory, error => request.log.error(error));
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    changed(id); return result;
  });
  app.post<{ Params: Params }>('/api/tournaments/:id/stages/:stageId/reopen', async (request, reply) => {
    const { id, stageId } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    const stage = db.prepare("SELECT stages.id FROM stages JOIN stage_progress ON stage_progress.stage_id = stages.id WHERE stages.id = ? AND stages.tournament_id = ? AND stage_progress.status = 'closed'").get(stageId, id);
    if (!stage) return reply.code(404).send({ error: 'Closed stage not found.' });
    const next = db.prepare('SELECT stage_id FROM stage_progress WHERE source_stage_id = ?').get(stageId);
    if (next && db.prepare('SELECT 1 FROM attempts WHERE stage_id = ? UNION ALL SELECT 1 FROM stage_forfeits WHERE stage_id = ? UNION ALL SELECT 1 FROM stage_results WHERE stage_id = ? LIMIT 1').get(next.stage_id as string, next.stage_id as string, next.stage_id as string)) return reply.code(409).send({ error: 'Delete results in the next stage before reopening this stage.' });
    if (next && db.prepare("SELECT 1 FROM stage_progress WHERE stage_id = ? AND status = 'closed'").get(next.stage_id as string)) return reply.code(409).send({ error: 'Reopen the next stage first.' });
    db.exec('BEGIN');
    try {
      if (next) { db.prepare('DELETE FROM withdrawal_replacements WHERE stage_id = ?').run(next.stage_id as string); db.prepare('DELETE FROM tie_resolutions WHERE tie_stage_id = ?').run(next.stage_id as string); db.prepare('DELETE FROM stage_entrants WHERE stage_id = ?').run(next.stage_id as string); db.prepare('DELETE FROM station_sessions WHERE stage_id = ?').run(next.stage_id as string); db.prepare('DELETE FROM stage_progress WHERE stage_id = ?').run(next.stage_id as string); }
      db.prepare('DELETE FROM display_wheels WHERE tournament_id = ?').run(id);
      db.prepare('DELETE FROM station_completions WHERE stage_id = ?').run(stageId);
      db.prepare("UPDATE stage_progress SET status = 'active' WHERE stage_id = ?").run(stageId); db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    changed(id); return { ok: true };
  });
}

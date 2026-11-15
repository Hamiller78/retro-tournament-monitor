import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { eligiblePlayers } from './eligibility';
import { laterOutcome } from './laterStages';

export function registerWinnerRoutes(app: FastifyInstance, db: DatabaseSync) {
  app.get<{ Params: { id: string } }>('/api/tournaments/:id/winner', async (request, reply) => {
    const { id } = request.params;
    if (!db.prepare('SELECT 1 FROM tournaments WHERE id = ?').get(id)) return reply.code(404).send({ error: 'Tournament not found.' });
    const final = db.prepare("SELECT id, kind FROM stages WHERE tournament_id = ? AND kind != 'tie-breaker' ORDER BY position DESC LIMIT 1").get(id);
    if (!final) return { winner: null };
    const state = db.prepare('SELECT status FROM stage_progress WHERE stage_id = ?').get(String(final.id));
    const first = db.prepare("SELECT id FROM stages WHERE tournament_id = ? AND kind != 'tie-breaker' ORDER BY position LIMIT 1").get(id);
    if (!state && first?.id !== final.id) return { winner: null };
    let stageId = String(final.id); let winnerId: string | undefined;
    const tie = db.prepare("SELECT tie_resolutions.tie_stage_id FROM tie_resolutions JOIN stage_progress ON stage_progress.stage_id = tie_resolutions.tie_stage_id WHERE tie_resolutions.source_stage_id = ? AND tie_resolutions.target_stage_id IS NULL AND stage_progress.status IN ('active', 'closed')").get(stageId);
    if (tie) {
      stageId = String(tie.tie_stage_id);
      const outcome = laterOutcome(db, stageId);
      if (outcome?.kind === 'tie-breaker' && outcome.complete && !outcome.blockedReason) {
        if (outcome.needsTie) winnerId = outcome.ranking[0];
        else winnerId = eligiblePlayers(db, id, String(final.id), 1).players?.[0];
      }
    } else if (final.kind === 'two-station') {
      winnerId = eligiblePlayers(db, id, stageId, 1).players?.[0];
    } else {
      const outcome = laterOutcome(db, stageId);
      if (outcome?.complete) winnerId = outcome.ranking[0];
    }
    if (!winnerId) return { winner: null };
    const player = db.prepare('SELECT display_name FROM participants WHERE id = ? AND tournament_id = ?').get(winnerId, id);
    if (!player) return { winner: null };
    const attempts = db.prepare('SELECT station, participant_id, attempt, value FROM attempts WHERE stage_id = ? ORDER BY station, participant_id, attempt').all(String(final.id));
    const results = db.prepare('SELECT id, participant_id FROM stage_results WHERE stage_id = ? ORDER BY position').all(stageId);
    const forfeits = db.prepare('SELECT participant_id FROM stage_forfeits WHERE stage_id = ? ORDER BY participant_id').all(String(final.id));
    const withdrawals = db.prepare('SELECT participant_id FROM withdrawals JOIN participants ON participants.id = withdrawals.participant_id WHERE participants.tournament_id = ? ORDER BY participant_id').all(id);
    const fingerprint = createHash('sha256').update(JSON.stringify([stageId, winnerId, attempts, results, forfeits, withdrawals])).digest('hex');
    return { winner: { id: winnerId, name: String(player.display_name), fingerprint } };
  });
}

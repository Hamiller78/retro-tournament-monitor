import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { eligiblePlayers } from './eligibility';

type Params = { id: string; participantId: string };
export function registerWithdrawalRoutes(app: FastifyInstance, db: DatabaseSync, authorized: (header: string | undefined, id: string) => boolean, changed: (id: string) => void) {
  const active = (id: string) => db.prepare(`SELECT stages.id, stages.kind FROM stages JOIN stage_progress ON stage_progress.stage_id = stages.id WHERE stages.tournament_id = ? AND stage_progress.status = 'active' ORDER BY stages.position DESC LIMIT 1`).get(id) ?? db.prepare(`SELECT stages.id, stages.kind FROM stages WHERE tournament_id = ? AND kind != 'tie-breaker' AND NOT EXISTS (SELECT 1 FROM stage_progress JOIN stages s ON s.id = stage_progress.stage_id WHERE s.tournament_id = ? AND stage_progress.status = 'closed') ORDER BY position LIMIT 1`).get(id, id);
  app.post<{ Params: Params }>('/api/tournaments/:id/participants/:participantId/withdrawal', async (request, reply) => {
    const { id, participantId } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    if (!db.prepare('SELECT 1 FROM participants WHERE id = ? AND tournament_id = ?').get(participantId, id)) return reply.code(404).send({ error: 'Participant not found.' });
    const stage = active(id);
    if (!stage) return reply.code(409).send({ error: 'Reopen a stage before withdrawing a player.' });
    if (db.prepare('SELECT 1 FROM withdrawals WHERE participant_id = ?').get(participantId)) return { ok: true };
    let warning: string | undefined; let replacementName: string | undefined;
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO withdrawals VALUES (?, ?)').run(participantId, String(stage.id));
      const source = db.prepare('SELECT source_stage_id FROM stage_progress WHERE stage_id = ?').get(String(stage.id));
      const entrant = db.prepare('SELECT 1 FROM stage_entrants WHERE stage_id = ? AND participant_id = ?').get(String(stage.id), participantId);
      if (stage.kind === 'two-station' && source?.source_stage_id && entrant) {
        const count = Number(db.prepare('SELECT participant_count FROM stages WHERE id = ?').get(String(stage.id))?.participant_count);
        const selection = eligiblePlayers(db, id, String(source.source_stage_id), count);
        const existing = new Set(db.prepare('SELECT participant_id FROM stage_entrants WHERE stage_id = ?').all(String(stage.id)).map(row => String(row.participant_id)));
        const replacement = (selection.players ?? selection.tie?.automatic ?? []).find(player => !existing.has(player));
        if (replacement) {
          db.prepare('INSERT INTO stage_entrants VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM stage_entrants WHERE stage_id = ?))').run(String(stage.id), replacement, String(stage.id));
          db.prepare('INSERT INTO withdrawal_replacements VALUES (?, ?, ?)').run(participantId, String(stage.id), replacement);
          db.prepare('DELETE FROM station_completions WHERE stage_id = ?').run(String(stage.id));
          replacementName = String(db.prepare('SELECT display_name FROM participants WHERE id = ?').get(replacement)?.display_name);
        } else warning = selection.error ? `No replacement was added: ${selection.error}` : 'No eligible replacement is available. Adjust the stage if needed.';
      }
      db.prepare('UPDATE station_sessions SET active_participant = active_participant2, active_participant2 = NULL WHERE stage_id = ? AND active_participant = ?').run(String(stage.id), participantId);
      db.prepare('UPDATE station_sessions SET active_participant2 = NULL WHERE stage_id = ? AND active_participant2 = ?').run(String(stage.id), participantId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    changed(id); return { ok: true, warning, replacementName };
  });
  app.delete<{ Params: Params }>('/api/tournaments/:id/participants/:participantId/withdrawal', async (request, reply) => {
    const { id, participantId } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    const withdrawal = db.prepare('SELECT withdrawals.stage_id FROM withdrawals JOIN participants ON participants.id = withdrawals.participant_id WHERE participants.id = ? AND participants.tournament_id = ?').get(participantId, id);
    if (!withdrawal) return reply.code(404).send({ error: 'Withdrawal not found.' });
    const current = active(id);
    if (!current || current.id !== withdrawal.stage_id) return reply.code(409).send({ error: 'Reopen the stage where the player withdrew before restoring them.' });
    const replacement = db.prepare('SELECT stage_id, replacement_id FROM withdrawal_replacements WHERE participant_id = ?').get(participantId);
    if (replacement) {
      const replacementId = String(replacement.replacement_id);
      if (db.prepare('SELECT 1 FROM attempts WHERE stage_id = ? AND participant_id = ? UNION ALL SELECT 1 FROM stage_forfeits WHERE stage_id = ? AND participant_id = ? UNION ALL SELECT 1 FROM withdrawals WHERE participant_id = ? LIMIT 1').get(String(current.id), replacementId, String(current.id), replacementId, replacementId)) return reply.code(409).send({ error: 'The replacement has results or has withdrawn. Resolve those before reactivating this player.' });
    }
    db.exec('BEGIN');
    try {
      if (replacement) {
        const replacementId = String(replacement.replacement_id);
        db.prepare('UPDATE station_sessions SET active_participant = active_participant2, active_participant2 = NULL WHERE stage_id = ? AND active_participant = ?').run(String(current.id), replacementId);
        db.prepare('UPDATE station_sessions SET active_participant2 = NULL WHERE stage_id = ? AND active_participant2 = ?').run(String(current.id), replacementId);
        db.prepare('DELETE FROM stage_entrants WHERE stage_id = ? AND participant_id = ?').run(String(current.id), replacementId);
      }
      db.prepare('DELETE FROM withdrawals WHERE participant_id = ?').run(participantId);
      if (current.kind === 'two-station') db.prepare('DELETE FROM station_completions WHERE stage_id = ?').run(String(current.id));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    changed(id); return { ok: true };
  });
}

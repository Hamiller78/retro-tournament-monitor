import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { eligiblePlayers } from './eligibility';

type Params = { id: string; stageId: string };
export function laterOutcome(db: DatabaseSync, stageId: string) {
  const stage = db.prepare('SELECT stages.kind, stage_settings.settings FROM stages LEFT JOIN stage_settings ON stage_settings.stage_id = stages.id WHERE stages.id = ?').get(stageId);
  if (!stage || !['elimination', 'duel', 'tie-breaker'].includes(String(stage.kind))) return null;
  const entrants = db.prepare('SELECT participants.id, participants.display_name AS displayName, EXISTS(SELECT 1 FROM withdrawals WHERE participant_id = participants.id) AS withdrawn FROM stage_entrants JOIN participants ON participants.id = stage_entrants.participant_id WHERE stage_entrants.stage_id = ? ORDER BY stage_entrants.position').all(stageId).map(row => ({ id: String(row.id), displayName: String(row.displayName), withdrawn: Boolean(row.withdrawn) }));
  const results = db.prepare('SELECT id, participant_id AS participantId, position FROM stage_results WHERE stage_id = ? ORDER BY position').all(stageId).map(row => ({ id: String(row.id), participantId: String(row.participantId), position: Number(row.position) }));
  const settings = stage.settings ? JSON.parse(String(stage.settings)) : null;
  if (stage.kind === 'tie-breaker') {
    const link = db.prepare('SELECT tie_resolutions.source_stage_id, tie_resolutions.slots, stages.tournament_id FROM tie_resolutions JOIN stages ON stages.id = tie_resolutions.tie_stage_id WHERE tie_resolutions.tie_stage_id = ?').get(stageId);
    const selection = link ? eligiblePlayers(db, String(link.tournament_id), String(link.source_stage_id), Number(link.slots)) : null;
    const needsTie = !!selection?.tie;
    const eligibleIds = selection?.tie?.tied ?? [];
    const blockedReason = selection?.tie && eligibleIds.some(id => !entrants.some(person => person.id === id)) ? 'The tied players have changed. Reopen the preceding stage to resolve the new tie.' : !selection?.tie && !selection?.players ? (selection?.error ?? 'Tie-breaker is not ready.') : null;
    const current = entrants.filter(person => eligibleIds.includes(person.id));
    const placements = results.filter(result => eligibleIds.includes(result.participantId));
    const complete = !blockedReason && (!!selection?.players || (needsTie && current.length >= 2 && (current.length === 2 ? placements.length >= 1 : placements.length === current.length)));
    const order = placements.map(result => result.participantId);
    const ranking = needsTie && complete ? current.length === 2 ? [order[0], current.find(person => person.id !== order[0])!.id] : order : [];
    return { kind: 'tie-breaker' as const, entrants, results, complete, ranking, eligibleIds, needsTie, blockedReason, game: settings?.game ?? '', bestOf: null };
  }
  if (stage.kind === 'elimination') {
    const eliminated = new Set(results.map(result => result.participantId));
    const survivors = entrants.filter(person => !person.withdrawn && !eliminated.has(person.id));
    const complete = entrants.length >= 2 && survivors.length === 1;
    const eligible = new Set(entrants.filter(person => !person.withdrawn).map(person => person.id));
    return { kind: 'elimination' as const, entrants, results, complete, ranking: complete ? [survivors[0].id, ...results.map(row => row.participantId).filter(id => eligible.has(id)).reverse()] : [], game: settings?.game ?? '', bestOf: null };
  }
  const bestOf = [1, 3, 5].includes(settings?.bestOf) ? Number(settings.bestOf) : null;
  const needed = bestOf ? Math.floor(bestOf / 2) + 1 : Infinity;
  const eligible = entrants.filter(person => !person.withdrawn);
  const winner = eligible.length === 1 ? eligible[0] : eligible.find(person => results.filter(result => result.participantId === person.id).length >= needed);
  const complete = entrants.length === 2 && !!bestOf && !!winner;
  return { kind: 'duel' as const, entrants, results, complete, ranking: complete ? [winner!.id, ...eligible.filter(person => person.id !== winner!.id).map(person => person.id)] : [], game: settings?.game ?? '', bestOf };
}
export function registerLaterStageRoutes(app: FastifyInstance, db: DatabaseSync, authorized: (header: string | undefined, id: string) => boolean, changed: (id: string) => void) {
  function get(id: string, stageId: string) {
    if (!db.prepare('SELECT 1 FROM stages WHERE id = ? AND tournament_id = ?').get(stageId, id)) return null;
    return laterOutcome(db, stageId);
  }
  app.get<{ Params: Params }>('/api/tournaments/:id/stages/:stageId/outcome', async (request, reply) => get(request.params.id, request.params.stageId) ?? reply.code(404).send({ error: 'Stage not found.' }));
  app.post<{ Params: Params; Body: { participantId?: unknown; requestId?: unknown } }>('/api/tournaments/:id/stages/:stageId/outcome', async (request, reply) => {
    const { id, stageId } = request.params, outcome = get(id, stageId);
    if (!outcome) return reply.code(404).send({ error: 'Stage not found.' });
    if (db.prepare('SELECT status FROM stage_progress WHERE stage_id = ?').get(stageId)?.status !== 'active') return reply.code(409).send({ error: 'This stage is not active.' });
    const { participantId, requestId } = request.body ?? {};
    if (typeof participantId !== 'string' || typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId) || !outcome.entrants.some(player => player.id === participantId)) return reply.code(400).send({ error: 'Choose a player in this stage.' });
    if (outcome.entrants.some(player => player.id === participantId && player.withdrawn)) return reply.code(409).send({ error: 'This player has withdrawn.' });
    const existing = db.prepare('SELECT stage_id, participant_id FROM stage_results WHERE id = ?').get(requestId);
    if (existing) return existing.stage_id === stageId && existing.participant_id === participantId ? { ok: true } : reply.code(409).send({ error: 'This submission has already been used.' });
    if (outcome.kind === 'tie-breaker' && (outcome.blockedReason || !outcome.needsTie || !outcome.eligibleIds.includes(participantId))) return reply.code(409).send({ error: outcome.blockedReason ?? 'This player is not in the current tie-breaker.' });
    if (!outcome.game.trim()) return reply.code(409).send({ error: 'Set the game for this stage before recording results.' });
    if (outcome.complete) return reply.code(409).send({ error: 'All results are already recorded.' });
    if ((outcome.kind === 'elimination' || outcome.kind === 'tie-breaker') && (outcome.entrants.length < 2 || outcome.results.some(result => result.participantId === participantId))) return reply.code(409).send({ error: 'Choose a player who has not been eliminated.' });
    if (outcome.kind === 'duel' && (outcome.entrants.length !== 2 || !outcome.bestOf)) return reply.code(409).send({ error: 'Configure a two-player duel and match format first.' });
    db.prepare('INSERT INTO stage_results VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM stage_results WHERE stage_id = ?), ?)').run(requestId, stageId, stageId, participantId);
    changed(id); return reply.code(201).send({ ok: true });
  });
  app.put<{ Params: Params & { resultId: string }; Body: { participantId?: unknown } }>('/api/tournaments/:id/stages/:stageId/outcome/:resultId', async (request, reply) => {
    const { id, stageId, resultId } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    const outcome = get(id, stageId);
    if (!outcome) return reply.code(404).send({ error: 'Stage not found.' });
    if (db.prepare('SELECT status FROM stage_progress WHERE stage_id = ?').get(stageId)?.status !== 'active') return reply.code(409).send({ error: 'This stage is not active.' });
    const participant = request.body?.participantId, target = outcome.results.find(result => result.id === resultId);
    if (!target) return reply.code(404).send({ error: 'Result not found.' });
    if (typeof participant !== 'string' || !outcome.entrants.some(person => person.id === participant)) return reply.code(400).send({ error: 'Choose a player in this stage.' });
    if (outcome.kind === 'tie-breaker' && (!outcome.needsTie || !outcome.eligibleIds.includes(participant))) return reply.code(409).send({ error: 'Choose a player in the current tie-breaker.' });
    const corrected = outcome.results.map(result => result.id === resultId ? { ...result, participantId: participant } : result);
    if ((outcome.kind === 'elimination' || outcome.kind === 'tie-breaker') && new Set(corrected.map(result => result.participantId)).size !== corrected.length) return reply.code(409).send({ error: 'That player is already eliminated.' });
    if (outcome.kind === 'duel') {
      if (!outcome.bestOf) return reply.code(409).send({ error: 'Configure the match format first.' });
      const needed = Math.floor(outcome.bestOf / 2) + 1, wins = new Map<string, number>();
      for (const [index, result] of corrected.entries()) { const count = (wins.get(result.participantId) ?? 0) + 1; wins.set(result.participantId, count); if (count >= needed && index < corrected.length - 1) return reply.code(409).send({ error: 'This change would make the match end before a later recorded round. Delete the later round first.' }); }
    }
    db.prepare('UPDATE stage_results SET participant_id = ? WHERE id = ? AND stage_id = ?').run(participant, resultId, stageId); changed(id); return { ok: true };
  });
  app.delete<{ Params: Params & { resultId: string } }>('/api/tournaments/:id/stages/:stageId/outcome/:resultId', async (request, reply) => {
    const { id, stageId, resultId } = request.params;
    if (!authorized(request.headers.authorization, id)) return reply.code(401).send({ error: 'Administrator access required.' });
    if (!get(id, stageId)) return reply.code(404).send({ error: 'Stage not found.' });
    if (db.prepare('SELECT status FROM stage_progress WHERE stage_id = ?').get(stageId)?.status !== 'active') return reply.code(409).send({ error: 'This stage is not active.' });
    const result = db.prepare('DELETE FROM stage_results WHERE id = ? AND stage_id = ?').run(resultId, stageId);
    if (!result.changes) return reply.code(404).send({ error: 'Result not found.' }); changed(id); return { ok: true };
  });
}

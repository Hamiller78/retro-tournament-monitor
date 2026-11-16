import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { validTrophy } from './trophy';

const id = z.uuid();
const name = z.string().trim().min(1).max(100);
const game = z.object({ name, resultKind: z.enum(['score', 'time']), higherIsBetter: z.boolean(), attempts: z.number().int().min(1).max(100), players: z.union([z.literal(1), z.literal(2)]).optional(), developer: z.string().max(100).optional(), platform: z.string().max(100).optional(), releaseYear: z.number().int().min(1).max(9999).optional(), description: z.string().max(1000).optional() });
const settings = z.union([
  z.object({ stations: z.tuple([z.object({ games: z.array(game).max(100) }), z.object({ games: z.array(game).max(100) })]), points: z.array(z.number().int().min(0).max(1000000)).max(999) }),
  z.object({ game: z.string().max(100), bestOf: z.union([z.literal(1), z.literal(3), z.literal(5)]).optional() }),
]);
const schema = z.object({
  format: z.literal('retromania-tournament'), version: z.literal(1),
  tournament: z.object({ name, pinSalt: z.string().regex(/^[0-9a-f]{32}$/), pinHash: z.string().regex(/^[0-9a-f]{64}$/) }),
  trophyImage: z.string().refine(validTrophy).nullable().default(null),
  participants: z.array(z.object({ id, displayName: name, realName: z.string().max(100).nullable() })).max(1000),
  stages: z.array(z.object({ id, name, kind: z.enum(['two-station', 'elimination', 'duel', 'tie-breaker']), participantCount: z.number().int().min(1).max(999).nullable(), position: z.number().int().min(0).max(10000), settings: settings.nullable() })).max(100),
  draws: z.array(z.object({ stageId: id, station: z.union([z.literal(0), z.literal(1)]), gameIndex: z.number().int().min(0), confirmed: z.union([z.literal(0), z.literal(1)]) })).max(200),
  attempts: z.array(z.object({ stageId: id, station: z.union([z.literal(0), z.literal(1)]), participantId: id, attempt: z.number().int().min(1).max(100), value: z.number().min(0).max(1000000000) })).max(200000),
  withdrawals: z.array(z.object({ participantId: id, stageId: id.nullable() })).max(1000).default([]),
  withdrawalReplacements: z.array(z.object({ participantId: id, stageId: id, replacementId: id })).max(1000).default([]),
  forfeits: z.array(z.object({ stageId: id, participantId: id })).max(100000),
  progress: z.array(z.object({ stageId: id, status: z.enum(['active', 'closed']), sourceStageId: id.nullable() })).max(100).default([]),
  entrants: z.array(z.object({ stageId: id, participantId: id, position: z.number().int().min(0).max(999) })).max(100000).default([]),
  stageResults: z.array(z.object({ stageId: id, participantId: id, position: z.number().int().min(0).max(10000) })).max(100000).default([]),
  stationCompletions: z.array(z.object({ stageId: id, station: z.union([z.literal(0), z.literal(1)]) })).max(200).default([]),
  tieResolutions: z.array(z.object({ tieStageId: id, sourceStageId: id, targetStageId: id.nullable(), slots: z.number().int().min(1).max(999) })).max(100).default([]),
});
type Backup = z.infer<typeof schema>;

export function exportTournament(db: DatabaseSync, tournamentId: string) {
  const tournament = db.prepare('SELECT name, pin_salt AS pinSalt, pin_hash AS pinHash FROM tournaments WHERE id = ?').get(tournamentId);
  if (!tournament) return null;
  const participants = db.prepare('SELECT id, display_name AS displayName, real_name AS realName FROM participants WHERE tournament_id = ? ORDER BY rowid').all(tournamentId);
  const stages = db.prepare('SELECT stages.id, stages.name, stages.kind, stages.participant_count AS participantCount, stages.position, stage_settings.settings FROM stages LEFT JOIN stage_settings ON stage_settings.stage_id = stages.id WHERE stages.tournament_id = ? ORDER BY stages.position').all(tournamentId).map(row => ({ ...row, settings: row.settings ? JSON.parse(String(row.settings)) : null }));
  const draws = db.prepare('SELECT station_draws.stage_id AS stageId, station, game_index AS gameIndex, confirmed FROM station_draws JOIN stages ON stages.id = station_draws.stage_id WHERE stages.tournament_id = ?').all(tournamentId);
  const attempts = db.prepare('SELECT attempts.stage_id AS stageId, station, participant_id AS participantId, attempt, value FROM attempts JOIN stages ON stages.id = attempts.stage_id WHERE stages.tournament_id = ?').all(tournamentId);
  const withdrawals = db.prepare('SELECT withdrawals.participant_id AS participantId, withdrawals.stage_id AS stageId FROM withdrawals JOIN participants ON participants.id = withdrawals.participant_id WHERE participants.tournament_id = ?').all(tournamentId);
  const withdrawalReplacements = db.prepare('SELECT withdrawal_replacements.participant_id AS participantId, withdrawal_replacements.stage_id AS stageId, replacement_id AS replacementId FROM withdrawal_replacements JOIN stages ON stages.id = withdrawal_replacements.stage_id WHERE stages.tournament_id = ?').all(tournamentId);
  const forfeits = db.prepare('SELECT stage_forfeits.stage_id AS stageId, participant_id AS participantId FROM stage_forfeits JOIN stages ON stages.id = stage_forfeits.stage_id WHERE stages.tournament_id = ?').all(tournamentId);
  const progress = db.prepare('SELECT stage_progress.stage_id AS stageId, status, source_stage_id AS sourceStageId FROM stage_progress JOIN stages ON stages.id = stage_progress.stage_id WHERE stages.tournament_id = ?').all(tournamentId);
  const entrants = db.prepare('SELECT stage_entrants.stage_id AS stageId, participant_id AS participantId, stage_entrants.position FROM stage_entrants JOIN stages ON stages.id = stage_entrants.stage_id WHERE stages.tournament_id = ?').all(tournamentId);
  const stageResults = db.prepare('SELECT stage_results.stage_id AS stageId, participant_id AS participantId, stage_results.position FROM stage_results JOIN stages ON stages.id = stage_results.stage_id WHERE stages.tournament_id = ?').all(tournamentId);
  const stationCompletions = db.prepare('SELECT station_completions.stage_id AS stageId, station FROM station_completions JOIN stages ON stages.id = station_completions.stage_id WHERE stages.tournament_id = ?').all(tournamentId);
  const tieResolutions = db.prepare('SELECT tie_stage_id AS tieStageId, source_stage_id AS sourceStageId, target_stage_id AS targetStageId, slots FROM tie_resolutions JOIN stages ON stages.id = tie_resolutions.tie_stage_id WHERE stages.tournament_id = ?').all(tournamentId);
  const trophyImage = db.prepare('SELECT data FROM trophy_images WHERE tournament_id = ?').get(tournamentId)?.data ?? null;
  return { format: 'retromania-tournament', version: 1, tournament, trophyImage, participants, stages, draws, attempts, withdrawals, withdrawalReplacements, forfeits, progress, entrants, stageResults, stationCompletions, tieResolutions };
}
function isConsistent(backup: Backup) {
  const stages = new Map(backup.stages.map(stage => [stage.id, stage]));
  const players = new Set(backup.participants.map(player => player.id));
  if (stages.size !== backup.stages.length || players.size !== backup.participants.length || new Set(backup.stages.map(stage => stage.position)).size !== backup.stages.length) return false;
  for (const stage of backup.stages) {
    if (!stage.settings) continue;
    if (stage.kind === 'two-station' ? !('stations' in stage.settings) : !('game' in stage.settings)) return false;
    if (stage.kind === 'duel' && (!('bestOf' in stage.settings) || stage.settings.bestOf == null)) return false;
  }
  const draws = new Map<string, typeof backup.draws[number]>();
  for (const draw of backup.draws) {
    const stage = stages.get(draw.stageId); const key = `${draw.stageId}:${draw.station}`;
    if (!stage || stage.kind !== 'two-station' || !stage.settings || !('stations' in stage.settings) || !stage.settings.stations[draw.station].games[draw.gameIndex] || draws.has(key)) return false;
    draws.set(key, draw);
  }
  const attemptKeys = new Set<string>();
  for (const attempt of backup.attempts) {
    const stage = stages.get(attempt.stageId); const draw = draws.get(`${attempt.stageId}:${attempt.station}`);
    if (!players.has(attempt.participantId) || !stage?.settings || !('stations' in stage.settings) || !draw || !draw.confirmed || attempt.attempt > stage.settings.stations[attempt.station].games[draw.gameIndex].attempts) return false;
    const key = `${attempt.stageId}:${attempt.station}:${attempt.participantId}:${attempt.attempt}`; if (attemptKeys.has(key)) return false; attemptKeys.add(key);
  }
  const withdrawn = new Set<string>();
  for (const item of backup.withdrawals) { if (!players.has(item.participantId) || withdrawn.has(item.participantId) || (item.stageId !== null && !stages.has(item.stageId))) return false; withdrawn.add(item.participantId); }
  const forfeitKeys = new Set<string>();
  for (const forfeit of backup.forfeits) {
    const key = `${forfeit.stageId}:${forfeit.participantId}`;
    if (!players.has(forfeit.participantId) || stages.get(forfeit.stageId)?.kind !== 'two-station' || forfeitKeys.has(key)) return false; forfeitKeys.add(key);
  }
  const progress = new Set<string>();
  for (const item of backup.progress) {
    if (!stages.has(item.stageId) || progress.has(item.stageId) || (item.sourceStageId !== null && (!stages.has(item.sourceStageId) || item.sourceStageId === item.stageId))) return false;
    progress.add(item.stageId);
  }
  const entrantKeys = new Set<string>(), entrantPositions = new Set<string>();
  for (const entrant of backup.entrants) {
    const key = `${entrant.stageId}:${entrant.participantId}`, position = `${entrant.stageId}:${entrant.position}`;
    if (!progress.has(entrant.stageId) || !players.has(entrant.participantId) || entrantKeys.has(key) || entrantPositions.has(position)) return false;
    entrantKeys.add(key); entrantPositions.add(position);
  }
  const replacements = new Set<string>();
  for (const replacement of backup.withdrawalReplacements) {
    if (replacements.has(replacement.participantId) || !withdrawn.has(replacement.participantId) || stages.get(replacement.stageId)?.kind !== 'two-station' || replacement.participantId === replacement.replacementId || !entrantKeys.has(`${replacement.stageId}:${replacement.participantId}`) || !entrantKeys.has(`${replacement.stageId}:${replacement.replacementId}`)) return false;
    replacements.add(replacement.participantId);
  }
  const completedStations = new Set<string>();
  for (const completion of backup.stationCompletions) {
    const key = `${completion.stageId}:${completion.station}`;
    const draw = draws.get(key), stage = stages.get(completion.stageId);
    if (completedStations.has(key) || !draw?.confirmed || !stage?.settings || !('stations' in stage.settings)) return false;
    const source = backup.progress.find(item => item.stageId === completion.stageId)?.sourceStageId;
    const participants = source ? backup.entrants.filter(item => item.stageId === completion.stageId).map(item => item.participantId) : backup.participants.map(item => item.id);
    const required = stage.settings.stations[completion.station].games[draw.gameIndex].attempts;
    if (!participants.length || participants.some(participantId => !withdrawn.has(participantId) && !forfeitKeys.has(`${completion.stageId}:${participantId}`) && backup.attempts.filter(attempt => attempt.stageId === completion.stageId && attempt.station === completion.station && attempt.participantId === participantId).length < required)) return false;
    completedStations.add(key);
  }
  const tieIds = new Set<string>();
  for (const link of backup.tieResolutions) {
    if (tieIds.has(link.tieStageId) || stages.get(link.tieStageId)?.kind !== 'tie-breaker' || !stages.has(link.sourceStageId) || !progress.has(link.tieStageId) || !progress.has(link.sourceStageId) || (link.targetStageId !== null && !stages.has(link.targetStageId))) return false;
    tieIds.add(link.tieStageId);
  }
  const resultPositions = new Set<string>(), eliminated = new Set<string>();
  for (const result of backup.stageResults) {
    const stage = stages.get(result.stageId), key = `${result.stageId}:${result.position}`, participant = `${result.stageId}:${result.participantId}`;
    if (!stage || !['elimination', 'duel', 'tie-breaker'].includes(stage.kind) || !entrantKeys.has(participant) || resultPositions.has(key)) return false;
    if ((stage.kind === 'elimination' || stage.kind === 'tie-breaker') && eliminated.has(participant)) return false;
    resultPositions.add(key); eliminated.add(participant);
  }
  for (const stage of backup.stages.filter(stage => stage.kind === 'elimination' || stage.kind === 'duel' || stage.kind === 'tie-breaker')) {
    const entries = backup.entrants.filter(entrant => entrant.stageId === stage.id);
    const results = backup.stageResults.filter(result => result.stageId === stage.id).sort((a, b) => a.position - b.position);
    if (stage.kind === 'elimination' && results.length >= entries.length && results.length > 0) return false;
    if (stage.kind === 'tie-breaker' && results.length > (entries.length === 2 ? 1 : entries.length)) return false;
    if (stage.kind === 'duel' && results.length) {
      if (entries.length !== 2 || !stage.settings || !('bestOf' in stage.settings) || !stage.settings.bestOf) return false;
      const needed = Math.floor(stage.settings.bestOf / 2) + 1, wins = new Map<string, number>();
      for (const [index, result] of results.entries()) { const count = (wins.get(result.participantId) ?? 0) + 1; wins.set(result.participantId, count); if (count >= needed && index !== results.length - 1) return false; }
    }
  }
  return true;
}
export function registerBackupRoutes(app: FastifyInstance, db: DatabaseSync, authorized: (header: string | undefined, id: string) => boolean, changed: (id: string) => void) {
  app.get<{ Params: { id: string } }>('/api/tournaments/:id/backup', async (request, reply) => {
    if (!authorized(request.headers.authorization, request.params.id)) return reply.code(401).send({ error: 'Administrator access required.' });
    const backup = exportTournament(db, request.params.id);
    if (!backup) return reply.code(404).send({ error: 'Tournament not found.' });
    reply.header('Cache-Control', 'no-store'); return backup;
  });
  app.post<{ Body: { backup?: unknown; pin?: unknown } }>('/api/tournaments/restore', async (request, reply) => {
    const parsed = schema.safeParse(request.body?.backup), pin = request.body?.pin;
    if (!parsed.success || !isConsistent(parsed.data)) return reply.code(400).send({ error: 'This backup is invalid or unsupported.' });
    if (typeof pin !== 'string' || !/^\d{4,12}$/.test(pin)) return reply.code(401).send({ error: 'Incorrect backup PIN.' });
    const backup = parsed.data, calculated = scryptSync(pin, backup.tournament.pinSalt, 32);
    if (!timingSafeEqual(calculated, Buffer.from(backup.tournament.pinHash, 'hex'))) return reply.code(401).send({ error: 'Incorrect backup PIN.' });
    const tournamentId = randomUUID(), players = new Map(backup.participants.map(p => [p.id, randomUUID()])), stages = new Map(backup.stages.map(s => [s.id, randomUUID()]));
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO tournaments VALUES (?, ?, ?, ?)').run(tournamentId, `${backup.tournament.name.slice(0, 89)} (restored)`, backup.tournament.pinSalt, backup.tournament.pinHash);
      if (backup.trophyImage) db.prepare('INSERT INTO trophy_images (tournament_id, data) VALUES (?, ?)').run(tournamentId, backup.trophyImage);
      const insertPlayer = db.prepare('INSERT INTO participants VALUES (?, ?, ?, ?)');
      for (const p of backup.participants) insertPlayer.run(players.get(p.id)!, tournamentId, p.displayName, p.realName);
      const insertStage = db.prepare('INSERT INTO stages VALUES (?, ?, ?, ?, ?, ?)'); const insertSettings = db.prepare('INSERT INTO stage_settings VALUES (?, ?)');
      for (const s of backup.stages) { const newId = stages.get(s.id)!; insertStage.run(newId, tournamentId, s.name, s.kind, s.participantCount, s.position); if (s.settings) insertSettings.run(newId, JSON.stringify(s.settings)); }
      const insertWithdrawal = db.prepare('INSERT INTO withdrawals VALUES (?, ?)');
      for (const item of backup.withdrawals) insertWithdrawal.run(players.get(item.participantId)!, item.stageId ? stages.get(item.stageId)! : null);
      const insertDraw = db.prepare('INSERT INTO station_draws VALUES (?, ?, ?, ?, ?)');
      for (const d of backup.draws) insertDraw.run(stages.get(d.stageId)!, d.station, randomUUID(), d.gameIndex, d.confirmed);
      const insertAttempt = db.prepare('INSERT INTO attempts VALUES (?, ?, ?, ?, ?, ?)');
      for (const a of backup.attempts) insertAttempt.run(randomUUID(), stages.get(a.stageId)!, a.station, players.get(a.participantId)!, a.attempt, a.value);
      const insertForfeit = db.prepare('INSERT INTO stage_forfeits VALUES (?, ?)');
      for (const f of backup.forfeits) insertForfeit.run(stages.get(f.stageId)!, players.get(f.participantId)!);
      const insertProgress = db.prepare('INSERT INTO stage_progress VALUES (?, ?, ?)');
      for (const item of backup.progress) insertProgress.run(stages.get(item.stageId)!, item.status, item.sourceStageId ? stages.get(item.sourceStageId)! : null);
      const insertEntrant = db.prepare('INSERT INTO stage_entrants VALUES (?, ?, ?)');
      for (const entrant of backup.entrants) insertEntrant.run(stages.get(entrant.stageId)!, players.get(entrant.participantId)!, entrant.position);
      const insertReplacement = db.prepare('INSERT INTO withdrawal_replacements VALUES (?, ?, ?)');
      for (const item of backup.withdrawalReplacements) insertReplacement.run(players.get(item.participantId)!, stages.get(item.stageId)!, players.get(item.replacementId)!);
      const insertCompletion = db.prepare('INSERT INTO station_completions VALUES (?, ?)');
      for (const completion of backup.stationCompletions) insertCompletion.run(stages.get(completion.stageId)!, completion.station);
      const insertTie = db.prepare('INSERT INTO tie_resolutions VALUES (?, ?, ?, ?)');
      for (const link of backup.tieResolutions) insertTie.run(stages.get(link.tieStageId)!, stages.get(link.sourceStageId)!, link.targetStageId ? stages.get(link.targetStageId)! : null, link.slots);
      const insertResult = db.prepare('INSERT INTO stage_results VALUES (?, ?, ?, ?)');
      for (const result of backup.stageResults) insertResult.run(randomUUID(), stages.get(result.stageId)!, result.position, players.get(result.participantId)!);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); request.log.error(error); return reply.code(400).send({ error: 'The backup could not be restored.' }); }
    changed(tournamentId); return reply.code(201).send({ id: tournamentId });
  });
}

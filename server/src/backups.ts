import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const id = z.uuid();
const name = z.string().trim().min(1).max(100);
const game = z.object({ name, resultKind: z.enum(['score', 'time']), higherIsBetter: z.boolean(), attempts: z.number().int().min(1).max(100) });
const settings = z.union([
  z.object({ stations: z.tuple([z.object({ games: z.array(game).max(100) }), z.object({ games: z.array(game).max(100) })]), points: z.array(z.number().int().min(0).max(1000000)).max(999) }),
  z.object({ game: z.string().max(100), bestOf: z.union([z.literal(1), z.literal(3), z.literal(5)]).optional() }),
]);
const schema = z.object({
  format: z.literal('retromania-tournament'), version: z.literal(1),
  tournament: z.object({ name, pinSalt: z.string().regex(/^[0-9a-f]{32}$/), pinHash: z.string().regex(/^[0-9a-f]{64}$/) }),
  participants: z.array(z.object({ id, displayName: name, realName: z.string().max(100).nullable() })).max(1000),
  stages: z.array(z.object({ id, name, kind: z.enum(['two-station', 'elimination', 'duel', 'tie-breaker']), participantCount: z.number().int().min(1).max(999).nullable(), position: z.number().int().min(0).max(10000), settings: settings.nullable() })).max(100),
  draws: z.array(z.object({ stageId: id, station: z.union([z.literal(0), z.literal(1)]), gameIndex: z.number().int().min(0), confirmed: z.union([z.literal(0), z.literal(1)]) })).max(200),
  attempts: z.array(z.object({ stageId: id, station: z.union([z.literal(0), z.literal(1)]), participantId: id, attempt: z.number().int().min(1).max(100), value: z.number().min(0).max(1000000000) })).max(200000),
  forfeits: z.array(z.object({ stageId: id, participantId: id })).max(100000),
});
type Backup = z.infer<typeof schema>;

export function exportTournament(db: DatabaseSync, tournamentId: string) {
  const tournament = db.prepare('SELECT name, pin_salt AS pinSalt, pin_hash AS pinHash FROM tournaments WHERE id = ?').get(tournamentId);
  if (!tournament) return null;
  const participants = db.prepare('SELECT id, display_name AS displayName, real_name AS realName FROM participants WHERE tournament_id = ? ORDER BY rowid').all(tournamentId);
  const stages = db.prepare('SELECT stages.id, stages.name, stages.kind, stages.participant_count AS participantCount, stages.position, stage_settings.settings FROM stages LEFT JOIN stage_settings ON stage_settings.stage_id = stages.id WHERE stages.tournament_id = ? ORDER BY stages.position').all(tournamentId).map(row => ({ ...row, settings: row.settings ? JSON.parse(String(row.settings)) : null }));
  const draws = db.prepare('SELECT station_draws.stage_id AS stageId, station, game_index AS gameIndex, confirmed FROM station_draws JOIN stages ON stages.id = station_draws.stage_id WHERE stages.tournament_id = ?').all(tournamentId);
  const attempts = db.prepare('SELECT attempts.stage_id AS stageId, station, participant_id AS participantId, attempt, value FROM attempts JOIN stages ON stages.id = attempts.stage_id WHERE stages.tournament_id = ?').all(tournamentId);
  const forfeits = db.prepare('SELECT stage_forfeits.stage_id AS stageId, participant_id AS participantId FROM stage_forfeits JOIN stages ON stages.id = stage_forfeits.stage_id WHERE stages.tournament_id = ?').all(tournamentId);
  return { format: 'retromania-tournament', version: 1, tournament, participants, stages, draws, attempts, forfeits };
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
  const forfeitKeys = new Set<string>();
  for (const forfeit of backup.forfeits) {
    const key = `${forfeit.stageId}:${forfeit.participantId}`;
    if (!players.has(forfeit.participantId) || stages.get(forfeit.stageId)?.kind !== 'two-station' || forfeitKeys.has(key)) return false; forfeitKeys.add(key);
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
      const insertPlayer = db.prepare('INSERT INTO participants VALUES (?, ?, ?, ?)');
      for (const p of backup.participants) insertPlayer.run(players.get(p.id)!, tournamentId, p.displayName, p.realName);
      const insertStage = db.prepare('INSERT INTO stages VALUES (?, ?, ?, ?, ?, ?)'); const insertSettings = db.prepare('INSERT INTO stage_settings VALUES (?, ?)');
      for (const s of backup.stages) { const newId = stages.get(s.id)!; insertStage.run(newId, tournamentId, s.name, s.kind, s.participantCount, s.position); if (s.settings) insertSettings.run(newId, JSON.stringify(s.settings)); }
      const insertDraw = db.prepare('INSERT INTO station_draws VALUES (?, ?, ?, ?, ?)');
      for (const d of backup.draws) insertDraw.run(stages.get(d.stageId)!, d.station, randomUUID(), d.gameIndex, d.confirmed);
      const insertAttempt = db.prepare('INSERT INTO attempts VALUES (?, ?, ?, ?, ?, ?)');
      for (const a of backup.attempts) insertAttempt.run(randomUUID(), stages.get(a.stageId)!, a.station, players.get(a.participantId)!, a.attempt, a.value);
      const insertForfeit = db.prepare('INSERT INTO stage_forfeits VALUES (?, ?)');
      for (const f of backup.forfeits) insertForfeit.run(stages.get(f.stageId)!, players.get(f.participantId)!);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); request.log.error(error); return reply.code(400).send({ error: 'The backup could not be restored.' }); }
    changed(tournamentId); return reply.code(201).send({ id: tournamentId });
  });
}

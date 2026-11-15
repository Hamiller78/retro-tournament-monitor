import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import type { StageSettings } from '../../shared/contracts';
import { combinedRanking } from './leaderboard';

type Params = { id: string; stageId: string };
export function registerLeaderboardRoutes(app: FastifyInstance, db: DatabaseSync) {
  app.get<{ Params: Params }>('/api/tournaments/:id/stages/:stageId/leaderboard', async (request, reply) => {
    const { id, stageId } = request.params;
    const stage = db.prepare(`SELECT stages.name, stages.position, stage_settings.settings FROM stages LEFT JOIN stage_settings ON stage_settings.stage_id = stages.id WHERE stages.id = ? AND stages.tournament_id = ? AND stages.kind = 'two-station'`).get(stageId, id);
    if (!stage) return reply.code(404).send({ error: 'Stage not found.' });
    const settings: StageSettings = stage.settings ? JSON.parse(String(stage.settings)) : {};
    const draws = db.prepare('SELECT station, game_index AS gameIndex FROM station_draws WHERE stage_id = ? AND confirmed = 1').all(stageId);
    const sessions = db.prepare('SELECT station, active_participant AS participantId, active_participant2 AS participantId2 FROM station_sessions WHERE stage_id = ?').all(stageId);
    const source = db.prepare('SELECT source_stage_id FROM stage_progress WHERE stage_id = ?').get(stageId);
    const entrants = new Set(db.prepare('SELECT participant_id FROM stage_entrants WHERE stage_id = ?').all(stageId).map(row => String(row.participant_id)));
    const participants = db.prepare('SELECT id AS participantId, display_name AS displayName FROM participants WHERE tournament_id = ?').all(id).filter(row => !source?.source_stage_id || entrants.has(String(row.participantId))).map(row => ({ participantId: String(row.participantId), displayName: String(row.displayName) }));
    const entries = db.prepare('SELECT participant_id AS participantId, station, value FROM attempts WHERE stage_id = ?').all(stageId).map(row => ({ participantId: String(row.participantId), station: Number(row.station), value: Number(row.value) }));
    const games = [0, 1].map(station => { const draw = draws.find(row => row.station === station); return draw ? settings.stations?.[station]?.games[Number(draw.gameIndex)] ?? null : null; });
    const stations = games.map((game, station) => { const session = sessions.find(row => row.station === station); return { game: game?.name ?? null, nowPlaying: [session?.participantId, session?.participantId2].map(id => participants.find(player => player.participantId === id)?.displayName).filter(Boolean).join(' & ') || null }; });
    const points = settings.points ?? [];
    const forfeits = new Set(db.prepare('SELECT participant_id FROM stage_forfeits WHERE stage_id = ? UNION SELECT participant_id FROM withdrawals').all(stageId).map(row => String(row.participant_id)));
    const withdrawn = new Set(db.prepare('SELECT participant_id FROM withdrawals').all().map(row => String(row.participant_id)));
    const next = db.prepare("SELECT id, participant_count FROM stages WHERE tournament_id = ? AND position > ? AND kind != 'tie-breaker' ORDER BY position LIMIT 1").get(id, Number(stage.position));
    const slots = next?.participant_count == null ? null : Number(next.participant_count);
    const rows = combinedRanking(participants, games, points, entries, forfeits);
    const nextProgress = next ? db.prepare('SELECT source_stage_id FROM stage_progress WHERE stage_id = ?').get(String(next.id)) : null;
    const link = nextProgress?.source_stage_id ? db.prepare('SELECT source_stage_id FROM tie_resolutions WHERE tie_stage_id = ?').get(String(nextProgress.source_stage_id)) : null;
    const settled = !!next && (nextProgress?.source_stage_id === stageId || link?.source_stage_id === stageId);
    const qualified = settled ? new Set(db.prepare('SELECT participant_id FROM stage_entrants WHERE stage_id = ?').all(String(next!.id)).map(row => String(row.participant_id))) : new Set<string>();
    return { stageName: stage.name, pointsConfigured: points.length > 0, stations, qualificationPlaces: slots, qualificationSettled: settled, rows: rows.map(row => {
      const tiedCount = rows.filter(other => other.rank !== null && other.rank === row.rank && !other.forfeited).length;
      const contested = slots !== null && row.rank !== null && row.rank <= slots && row.rank + tiedCount - 1 > slots;
      return { ...row, withdrawn: withdrawn.has(row.participantId), qualification: row.forfeited || slots === null ? null : settled ? qualified.has(row.participantId) ? 'qualified' : null : row.rank !== null && row.rank <= slots ? contested ? 'contested' : 'position' : null };
    }) };
  });
}

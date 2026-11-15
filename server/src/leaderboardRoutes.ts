import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import type { StageSettings } from '../../shared/contracts';
import { combinedRanking } from './leaderboard';

type Params = { id: string; stageId: string };
export function registerLeaderboardRoutes(app: FastifyInstance, db: DatabaseSync) {
  app.get<{ Params: Params }>('/api/tournaments/:id/stages/:stageId/leaderboard', async (request, reply) => {
    const { id, stageId } = request.params;
    const stage = db.prepare(`SELECT stages.name, stage_settings.settings FROM stages LEFT JOIN stage_settings ON stage_settings.stage_id = stages.id WHERE stages.id = ? AND stages.tournament_id = ? AND stages.kind = 'two-station'`).get(stageId, id);
    if (!stage) return reply.code(404).send({ error: 'Stage not found.' });
    const settings: StageSettings = stage.settings ? JSON.parse(String(stage.settings)) : {};
    const draws = db.prepare('SELECT station, game_index AS gameIndex FROM station_draws WHERE stage_id = ? AND confirmed = 1').all(stageId);
    const sessions = db.prepare('SELECT station, active_participant AS participantId FROM station_sessions WHERE stage_id = ?').all(stageId);
    const participants = db.prepare('SELECT id AS participantId, display_name AS displayName FROM participants WHERE tournament_id = ?').all(id).map(row => ({ participantId: String(row.participantId), displayName: String(row.displayName) }));
    const entries = db.prepare('SELECT participant_id AS participantId, station, value FROM attempts WHERE stage_id = ?').all(stageId).map(row => ({ participantId: String(row.participantId), station: Number(row.station), value: Number(row.value) }));
    const games = [0, 1].map(station => { const draw = draws.find(row => row.station === station); return draw ? settings.stations?.[station]?.games[Number(draw.gameIndex)] ?? null : null; });
    const stations = games.map((game, station) => { const session = sessions.find(row => row.station === station); return { game: game?.name ?? null, nowPlaying: participants.find(player => player.participantId === session?.participantId)?.displayName ?? null }; });
    const points = settings.points ?? [];
    const forfeits = new Set(db.prepare('SELECT participant_id FROM stage_forfeits WHERE stage_id = ?').all(stageId).map(row => String(row.participant_id)));
    return { stageName: stage.name, pointsConfigured: points.length > 0, stations, rows: combinedRanking(participants, games, points, entries, forfeits) };
  });
}

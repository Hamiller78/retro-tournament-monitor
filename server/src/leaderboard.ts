import type { GameSettings } from '../../shared/contracts';
import { calculateRanking } from './ranking';

type Player = { participantId: string; displayName: string };
type Result = { participantId: string; station: number; value: number };
export function combinedRanking(players: Player[], games: (GameSettings | null)[], points: number[], results: Result[], forfeits: ReadonlySet<string> = new Set()) {
  const stationRankings = games.map((game, station) => game ? calculateRanking(players.filter(player => !forfeits.has(player.participantId)).map(player => ({ ...player, attempts: results.filter(result => result.station === station && result.participantId === player.participantId).map(result => result.value) })), game) : []);
  const rows = players.map(player => {
    const forfeited = forfeits.has(player.participantId);
    const stationPoints = stationRankings.map(ranking => {
      if (forfeited) return 0;
      const rank = ranking.find(row => row.participantId === player.participantId)?.rank;
      return rank == null || points.length === 0 ? null : points[rank - 1] ?? 0;
    });
    const total = stationPoints.every(point => point === null) ? null : stationPoints.reduce<number>((sum, point) => sum + (point ?? 0), 0);
    return { ...player, stationPoints, total, forfeited };
  }).sort((a, b) => a.forfeited !== b.forfeited ? (a.forfeited ? 1 : -1) : a.total === null ? b.total === null ? a.displayName.localeCompare(b.displayName) : 1 : b.total === null ? -1 : b.total - a.total || a.displayName.localeCompare(b.displayName));
  let previous: number | null = null; let rank = 0;
  return rows.map((row, index) => { if (!row.forfeited && row.total !== null && (previous === null || row.total !== previous)) rank = index + 1; previous = row.total; return { ...row, rank: row.forfeited || row.total === null ? null : rank }; });
}

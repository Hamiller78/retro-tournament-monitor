import type { GameSettings } from '../../shared/contracts';
export interface RankingInput { participantId: string; displayName: string; attempts: number[] }
export function calculateRanking(players: RankingInput[], game: GameSettings) {
  const ranked = players.map(player => ({ ...player, best: player.attempts.length ? (game.higherIsBetter ? Math.max(...player.attempts) : Math.min(...player.attempts)) : null }))
    .sort((a, b) => a.best === null ? (b.best === null ? a.displayName.localeCompare(b.displayName) : 1) : b.best === null ? -1 : game.higherIsBetter ? b.best - a.best : a.best - b.best);
  let last: number | null = null; let rank = 0;
  return ranked.map((player, index) => { if (player.best !== null && (last === null || player.best !== last)) rank = index + 1; last = player.best; return { ...player, rank: player.best === null ? null : rank }; });
}

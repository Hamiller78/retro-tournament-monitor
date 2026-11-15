import { describe, expect, it } from 'vitest';
import { combinedRanking } from '../server/src/leaderboard';
import type { GameSettings } from '../shared/contracts';

const game: GameSettings = { name: 'Score', resultKind: 'score', higherIsBetter: true, attempts: 1 };
const race: GameSettings = { name: 'Race', resultKind: 'time', higherIsBetter: false, attempts: 1 };
const players = ['Alice', 'Bob', 'Cara', 'Dana'].map(displayName => ({ participantId: displayName, displayName }));
describe('combined leaderboard', () => {
  it('combines ranked points, skips tied places and distinguishes pending results from zero points', () => {
    const rows = combinedRanking(players, [game, race], [5, 2], [
      { participantId: 'Alice', station: 0, value: 100 },
      { participantId: 'Bob', station: 0, value: 100 },
      { participantId: 'Cara', station: 0, value: 50 },
      { participantId: 'Bob', station: 1, value: 90 },
      { participantId: 'Cara', station: 1, value: 80 },
    ]);
    expect(rows.map(row => [row.displayName, row.rank, row.stationPoints, row.total])).toEqual([
      ['Bob', 1, [5, 2], 7], ['Alice', 2, [5, null], 5], ['Cara', 2, [0, 5], 5], ['Dana', null, [null, null], null],
    ]);
  });
  it('does not assign points without a schedule', () => {
    expect(combinedRanking(players, [game, null], [], [{ participantId: 'Alice', station: 0, value: 10 }])[0].total).toBeNull();
  });
});

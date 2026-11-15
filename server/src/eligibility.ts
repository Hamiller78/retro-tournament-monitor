import type { DatabaseSync } from 'node:sqlite';
import type { StageSettings } from '../../shared/contracts';
import { combinedRanking } from './leaderboard';
import { laterOutcome } from './laterStages';
type Selection = { players?: string[]; error?: string; tie?: { automatic: string[]; tied: string[]; needed: number } };
export function eligiblePlayers(db: DatabaseSync, tournamentId: string, stageId: string, slots: number): Selection {
  const stage = db.prepare('SELECT kind FROM stages WHERE id = ? AND tournament_id = ?').get(stageId, tournamentId);
  if (stage?.kind === 'tie-breaker') {
    const outcome = laterOutcome(db, stageId), link = db.prepare('SELECT source_stage_id FROM tie_resolutions WHERE tie_stage_id = ?').get(stageId);
    if (!outcome?.complete || !link) return { error: 'Record the complete tie-breaker result first.' };
    const original = eligiblePlayers(db, tournamentId, String(link.source_stage_id), slots);
    if (original.players) return original;
    if (!original.tie) return { error: original.error ?? 'Cannot determine qualifiers.' };
    const tied = new Set(original.tie.tied);
    if (original.tie.tied.some(player => !outcome.ranking.includes(player))) return { error: 'The revised player count requires a different tie-breaker.' };
    return { players: [...original.tie.automatic, ...outcome.ranking.filter(player => tied.has(player)).slice(0, original.tie.needed)] };
  }
  if (stage && (stage.kind === 'elimination' || stage.kind === 'duel')) {
    const outcome = laterOutcome(db, stageId);
    if (!outcome?.complete) return { error: 'Record the complete result before closing this stage.' };
    if (outcome.ranking.length < slots) return { error: `Only ${outcome.ranking.length} eligible players remain for ${slots} places. Adjust the next stage first.` };
    return { players: outcome.ranking.slice(0, slots) };
  }
  const data = db.prepare("SELECT stage_settings.settings FROM stages JOIN stage_settings ON stage_settings.stage_id = stages.id WHERE stages.id = ? AND stages.tournament_id = ? AND stages.kind = 'two-station'").get(stageId, tournamentId);
  if (!data) return { error: 'This stage is not ready for advancement.' };
  const settings = JSON.parse(String(data.settings)) as StageSettings;
  const draws = db.prepare('SELECT station, game_index AS gameIndex FROM station_draws WHERE stage_id = ? AND confirmed = 1').all(stageId);
  const games = [0, 1].map(station => { const draw = draws.find(d => d.station === station); return draw ? settings.stations?.[station]?.games[Number(draw.gameIndex)] ?? null : null; });
  if (!games[0] || !games[1] || !settings.points?.length) return { error: 'Confirm both station games and configure a points schedule first.' };
  const assigned = db.prepare('SELECT participant_id FROM stage_entrants WHERE stage_id = ?').all(stageId).map(row => String(row.participant_id));
  const prior = db.prepare('SELECT source_stage_id FROM stage_progress WHERE stage_id = ?').get(stageId);
  const people = db.prepare('SELECT id AS participantId, display_name AS displayName FROM participants WHERE tournament_id = ?').all(tournamentId)
    .filter(row => !prior?.source_stage_id || assigned.includes(String(row.participantId)))
    .map(row => ({ participantId: String(row.participantId), displayName: String(row.displayName) }));
  if (!people.length) return { error: 'Add participants before closing this stage.' };
  const entries = db.prepare('SELECT participant_id AS participantId, station, value FROM attempts WHERE stage_id = ?').all(stageId).map(row => ({ participantId: String(row.participantId), station: Number(row.station), value: Number(row.value) }));
  const forfeits = new Set(db.prepare('SELECT participant_id FROM stage_forfeits WHERE stage_id = ? UNION SELECT participant_id FROM withdrawals').all(stageId).map(row => String(row.participant_id)));
  for (const player of people) if (!forfeits.has(player.participantId)) for (const station of [0, 1]) {
    const count = entries.filter(entry => entry.participantId === player.participantId && entry.station === station).length;
    if (count < games[station]!.attempts) return { error: 'Every player needs all attempts recorded or an explicit stage forfeit before closing.' };
  }
  const eligible = combinedRanking(people, games, settings.points, entries, forfeits).filter(row => !row.forfeited);
  if (eligible.length < slots) return { error: `Only ${eligible.length} eligible players remain for ${slots} places. Adjust the next stage first.` };
  if (eligible.length > slots && eligible[slots - 1].total === eligible[slots].total) {
    const cutoff = eligible[slots - 1].total!;
    const automatic = eligible.filter(player => player.total !== null && player.total > cutoff).map(player => player.participantId);
    const tied = eligible.filter(player => player.total === cutoff).map(player => player.participantId);
    return { error: 'A tie crosses the advancement cutoff.', tie: { automatic, tied, needed: slots - automatic.length } };
  }
  return { players: eligible.slice(0, slots).map(row => row.participantId) };
}

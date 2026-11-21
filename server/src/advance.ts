import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportTournament } from './backups';
import { eligiblePlayers } from './eligibility';
import { laterOutcome } from './laterStages';

type AdvanceResult = { ok: true; nextStageId: string | null; winnerId: string | null; warning?: string; tieBreakerActivated?: boolean } | { ok: false; status: 404 | 409; error: string };
function saveBackup(db: DatabaseSync, id: string, stageId: string, directory: string | null, logError: (error: unknown) => void) {
  try {
    if (!directory) throw new Error('No backup directory configured');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `stage-${stageId}-${Date.now()}-${randomUUID()}.json`), JSON.stringify(exportTournament(db, id), null, 2), { flag: 'wx', mode: 0o600 });
    return undefined;
  } catch (error) { logError(error); return 'The stage closed, but the automatic backup failed. Download a backup manually.'; }
}
export function advanceStage(db: DatabaseSync, id: string, stageId: string, backupDirectory: string | null, logError: (error: unknown) => void): AdvanceResult {
  const current = db.prepare('SELECT id, kind, position FROM stages WHERE id = ? AND tournament_id = ?').get(stageId, id);
  if (!current) return { ok: false, status: 404, error: 'Stage not found.' };
  const state = db.prepare('SELECT status FROM stage_progress WHERE stage_id = ?').get(stageId);
  if (state?.status === 'closed') return { ok: false, status: 409, error: 'This stage is already closed.' };
  if (current.kind === 'tie-breaker') {
    if (state?.status !== 'active') return { ok: false, status: 409, error: 'This tie-breaker is not active.' };
    const link = db.prepare('SELECT source_stage_id, target_stage_id, slots FROM tie_resolutions WHERE tie_stage_id = ?').get(stageId);
    const outcome = laterOutcome(db, stageId);
    if (!link || !outcome || outcome.kind !== 'tie-breaker') return { ok: false, status: 409, error: 'Tie-breaker is not ready.' };
    if (outcome.blockedReason) return { ok: false, status: 409, error: outcome.blockedReason };
    if (!outcome.complete) return { ok: false, status: 409, error: 'Record the complete tie-breaker result first.' };
    const source = String(link.source_stage_id), target = link.target_stage_id ? String(link.target_stage_id) : null, slots = Number(link.slots);
    const selection = eligiblePlayers(db, id, source, slots);
    if (!selection.tie && !selection.players) return { ok: false, status: 409, error: selection.error ?? 'Cannot determine qualifiers.' };
    if (target) {
      const next = db.prepare('SELECT participant_count FROM stages WHERE id = ? AND tournament_id = ?').get(target, id);
      if (!next || Number(next.participant_count) !== slots || db.prepare('SELECT 1 FROM stage_progress WHERE stage_id = ?').get(target)) return { ok: false, status: 409, error: 'The next stage has changed. Reopen the earlier stage to adjust it.' };
    }
    const qualifiers = selection.players ?? [...selection.tie!.automatic, ...outcome.ranking.slice(0, selection.tie!.needed)];
    db.exec('BEGIN');
    try {
      db.prepare("UPDATE stage_progress SET status = 'closed' WHERE stage_id = ?").run(stageId);
      if (target) {
        db.prepare("INSERT INTO stage_progress VALUES (?, 'active', ?)").run(target, stageId);
        const insert = db.prepare('INSERT INTO stage_entrants VALUES (?, ?, ?)'); qualifiers.forEach((player, position) => insert.run(target, player, position));
      }
      db.prepare('DELETE FROM display_wheels WHERE tournament_id = ?').run(id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { ok: true, nextStageId: target, winnerId: target ? null : qualifiers[0], warning: saveBackup(db, id, stageId, backupDirectory, logError) };
  }
  const stages = db.prepare("SELECT id, kind, position, participant_count AS participantCount FROM stages WHERE tournament_id = ? AND kind != 'tie-breaker' ORDER BY position").all(id);
  const index = stages.findIndex(stage => stage.id === stageId);
  if (index < 0) return { ok: false, status: 404, error: 'Stage not found.' };
  if (!['two-station', 'elimination', 'duel'].includes(String(stages[index].kind))) return { ok: false, status: 409, error: 'Closing this stage type is not available yet.' };
  if (index > 0 && state?.status !== 'active') return { ok: false, status: 409, error: 'Complete the previous stage first.' };
  const next = stages[index + 1], slots = next ? Number(next.participantCount) : 1;
  if (!Number.isInteger(slots) || slots < 1) return { ok: false, status: 409, error: 'Set the number of players for the next stage first.' };
  if (next && db.prepare('SELECT 1 FROM stage_progress WHERE stage_id = ?').get(next.id as string)) return { ok: false, status: 409, error: 'The next stage is already active.' };
  const selection = eligiblePlayers(db, id, stageId, slots);
  if (selection.tie) {
    const candidates = db.prepare("SELECT id FROM stages WHERE tournament_id = ? AND kind = 'tie-breaker' AND position > ? AND (? IS NULL OR position < ?) ORDER BY position").all(id, Number(current.position), next ? Number(next.position) : null, next ? Number(next.position) : null);
    if (candidates.length !== 1) return { ok: false, status: 409, error: 'A tie crosses the advancement cutoff. Configure one tie-breaker between this stage and the next.' };
    const tieStageId = String(candidates[0].id);
    if (db.prepare('SELECT 1 FROM stage_progress WHERE stage_id = ?').get(tieStageId)) return { ok: false, status: 409, error: 'The configured tie-breaker is already in use.' };
    db.exec('BEGIN');
    try {
      db.prepare("INSERT INTO stage_progress VALUES (?, 'closed', NULL) ON CONFLICT(stage_id) DO UPDATE SET status = 'closed'").run(stageId);
      db.prepare("INSERT INTO stage_progress VALUES (?, 'active', ?)").run(tieStageId, stageId);
      db.prepare('INSERT INTO tie_resolutions VALUES (?, ?, ?, ?)').run(tieStageId, stageId, next ? String(next.id) : null, slots);
      const insert = db.prepare('INSERT INTO stage_entrants VALUES (?, ?, ?)'); selection.tie.tied.forEach((player, position) => insert.run(tieStageId, player, position));
      db.prepare('DELETE FROM station_sessions WHERE stage_id = ?').run(stageId);
      db.prepare('DELETE FROM display_wheels WHERE tournament_id = ?').run(id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { ok: true, nextStageId: tieStageId, winnerId: null, tieBreakerActivated: true, warning: saveBackup(db, id, stageId, backupDirectory, logError) };
  }
  if (!selection.players) return { ok: false, status: 409, error: selection.error ?? 'Cannot advance this stage.' };
  const initialEntrants = !state && index === 0 && current.kind === 'elimination' ? laterOutcome(db, stageId)?.entrants : undefined;
  db.exec('BEGIN');
  try {
    db.prepare("INSERT INTO stage_progress(stage_id, status, source_stage_id) VALUES (?, 'closed', NULL) ON CONFLICT(stage_id) DO UPDATE SET status = 'closed'").run(stageId);
    if (initialEntrants) { const insert = db.prepare('INSERT INTO stage_entrants (stage_id, participant_id, position) VALUES (?, ?, ?)'); initialEntrants.forEach((person, position) => insert.run(stageId, person.id, position)); }
    if (next) {
      db.prepare("INSERT INTO stage_progress(stage_id, status, source_stage_id) VALUES (?, 'active', ?)").run(next.id as string, stageId);
      const insert = db.prepare('INSERT INTO stage_entrants(stage_id, participant_id, position) VALUES (?, ?, ?)');
      selection.players.forEach((player, position) => insert.run(next.id as string, player, position));
    }
    db.prepare('DELETE FROM station_sessions WHERE stage_id = ?').run(stageId);
    db.prepare('DELETE FROM display_wheels WHERE tournament_id = ?').run(id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { ok: true, nextStageId: next ? String(next.id) : null, winnerId: next ? null : selection.players[0], warning: saveBackup(db, id, stageId, backupDirectory, logError) };
}

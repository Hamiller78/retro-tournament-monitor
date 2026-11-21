import { useState } from 'react';
import type { Stage } from '../../shared/contracts';
import { LaterStageView } from './LaterStageView';
import { GameWheel } from './GameWheel';
import { stageGameWheel } from './stageGameWheel';

type SharedProps = { tournamentId: string; token: string; onError: (error: string) => void; onChange: () => void; revision: number };
type StagePanelProps = SharedProps & { stage: Stage; index?: number; isFinal: boolean };
export function StagePanel({ tournamentId, stage, index, isFinal, token, onError, onChange, revision }: StagePanelProps) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [selectingGame, setSelectingGame] = useState(false);
  const wheelStage = stageGameWheel(stage);
  async function toggleGameSelection() {
    const show = !selectingGame; setSelectingGame(show);
    if (wheelStage?.settings?.gameSelection !== 'pool') return;
    try { const response = await fetch(`/api/tournaments/${tournamentId}/display-view`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(show ? { mode: 'wheel', stageId: stage.id, station: 0 } : { mode: 'ranking' }) }); if (!response.ok) throw new Error('Could not update the TV display.'); } catch { onError('Could not update the TV display.'); }
  }
  async function change(action: 'close' | 'reopen') {
    setBusy(true); onError(''); setMessage('');
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/stages/${stage.id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}' });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not update the stage.');
      setMessage(action === 'close' ? result.tieBreakerActivated ? `${stage.name} closed. The tie-breaker is ready.` : result.nextStageId ? `${stage.name} closed and players advanced.` : `${stage.name} closed. Tournament winner determined.` : `${stage.name} reopened.`);
      if (result.warning) onError(result.warning); onChange();
    } catch (error) { onError((error as Error).message); } finally { setBusy(false); }
  }
  return <div className="rounded-lg bg-slate-800 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-lg font-semibold">{index === undefined ? '' : `${index + 1}. `}{stage.name}</p><p className="text-sm text-slate-300">{stage.kind === 'tie-breaker' ? stage.status === 'active' ? 'Tie-breaker · Active' : stage.status === 'closed' ? 'Tie-breaker · Closed' : 'Conditional tie-breaker' : stage.status === 'closed' ? 'Closed' : stage.status === 'active' ? 'Active' : 'Waiting for previous stage'}</p></div>
      {(token || stage.kind === 'elimination' || stage.kind === 'tie-breaker') && stage.status === 'active' && <button type="button" className="rounded-lg bg-violet-600 px-4 py-2 font-semibold disabled:opacity-50" disabled={busy} onClick={() => void change('close')}>Close {stage.name}</button>}
      {token && stage.status === 'closed' && <button type="button" className="rounded-lg border border-slate-500 px-4 py-2 disabled:opacity-50" disabled={busy} onClick={() => void change('reopen')}>Reopen {stage.name}</button>}</div>
    {message && <p role="status" className="mt-3 text-emerald-300">{message}</p>}
    {wheelStage && stage.status === 'active' && <><button type="button" className="mt-3 rounded-lg border border-violet-400 px-3 py-2" onClick={() => void toggleGameSelection()}>{selectingGame ? 'Hide game selection' : 'Choose game'}</button>{selectingGame && <GameWheel stage={wheelStage} station={0} label={stage.name} tournamentId={tournamentId} token={token} onError={onError} onChange={onChange} />}</>}
    {(stage.kind === 'elimination' || stage.kind === 'duel' || stage.kind === 'tie-breaker') && stage.status !== 'pending' && <LaterStageView tournamentId={tournamentId} stage={stage} isFinal={isFinal} token={token} revision={revision} onError={onError} onChange={onChange} />}
    {stage.entrants.length > 0 && <div className="mt-3"><p className="text-sm text-slate-400">Players</p><ul className="mt-1 flex flex-wrap gap-2">{stage.entrants.map(player => <li className="rounded-lg bg-slate-700 px-3 py-1" key={player.id}>{player.displayName}</li>)}</ul></div>}
  </div>;
}
export function ProgressionView({ stages, ...props }: SharedProps & { stages: Stage[] }) {
  const finalStage = stages.filter(stage => stage.kind !== 'tie-breaker').at(-1);
  return <section className="mt-6 min-h-[50vh]"><h3 className="text-3xl font-bold">Tournament progression</h3>
    {stages.length ? <ol className="mt-4 space-y-3">{stages.map((stage, index) => <li key={stage.id}><StagePanel {...props} stage={stage} index={index} isFinal={stage.id === finalStage?.id} /></li>)}</ol> : <p className="mt-4 text-slate-300">No stages configured yet.</p>}
  </section>;
}

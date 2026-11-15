import { useEffect, useState, type ReactNode } from 'react';
import type { Tournament } from '../../shared/contracts';
import { GameWheel } from './GameWheel';
import { StationView } from './StationView';
import { LeaderboardView } from './LeaderboardView';
import { ProgressionView, StagePanel } from './ProgressionView';
import { TournamentWinner } from './TournamentWinner';

type View = 'setup' | 'wheel1' | 'wheel2' | 'station1' | 'station2' | 'leaderboard' | 'progression' | `stage:${string}`;
const views: { id: View; label: string }[] = [
  { id: 'setup', label: 'Setup' }, { id: 'wheel1', label: 'Wheel 1' }, { id: 'wheel2', label: 'Wheel 2' },
  { id: 'station1', label: 'Station 1' }, { id: 'station2', label: 'Station 2' },
  { id: 'leaderboard', label: 'Leaderboard' }, { id: 'progression', label: 'Progression' },
];
type Props = { tournament: Tournament; token: string; children: ReactNode; onError: (error: string) => void; onChange: () => void; onViewChange: (presentation: boolean) => void; revision: number };
export function TournamentViews({ tournament, token, children, onError, onChange, onViewChange, revision }: Props) {
  const [view, setView] = useState<View>('setup');
  const [drawStage, setDrawStage] = useState('');
  const [fullScreen, setFullScreen] = useState(Boolean(document.fullscreenElement));
  const stages = tournament.stages.filter(stage => stage.kind === 'two-station');
  const stage = stages.find(item => item.id === drawStage) ?? stages[0];
  const finalStage = tournament.stages.filter(item => item.kind !== 'tie-breaker').at(-1);
  const laterStages = tournament.stages.filter(item => item.kind === 'elimination' || item.kind === 'duel' || (item.kind === 'tie-breaker' && item.status !== 'pending'));
  const stageView = view.startsWith('stage:') ? laterStages.find(item => `stage:${item.id}` === view) : undefined;
  useEffect(() => { const changed = () => setFullScreen(Boolean(document.fullscreenElement)); document.addEventListener('fullscreenchange', changed); return () => document.removeEventListener('fullscreenchange', changed); }, []);
  async function toggleFullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { onError('Full screen is not available in this browser.'); }
  }
  const wheel = view === 'wheel1' || view === 'wheel2';
  return <>
    <TournamentWinner tournamentId={tournament.id} revision={revision} />
    <nav aria-label="Tournament views" className="arcade-nav mt-5 flex flex-wrap items-center gap-2 border-b border-slate-700 pb-3">
      {views.map(item => <button type="button" key={item.id} aria-current={view === item.id ? 'page' : undefined} onClick={() => { setView(item.id); onViewChange(item.id !== 'setup'); }} className={`rounded-lg px-3 py-2 text-sm ${view === item.id ? 'bg-violet-700 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}>{item.label}</button>)}
      {laterStages.map(item => { const stageTab = `stage:${item.id}` as const; return <button type="button" key={item.id} aria-current={view === stageTab ? 'page' : undefined} onClick={() => { setView(stageTab); onViewChange(true); }} className={`rounded-lg px-3 py-2 text-sm ${view === stageTab ? 'bg-violet-700 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}>{item.name}</button>; })}
      {document.fullscreenEnabled && <button type="button" onClick={() => void toggleFullscreen()} className="ml-auto rounded-lg border border-slate-600 px-3 py-2 text-sm">{fullScreen ? 'Exit full screen' : 'Full screen'}</button>}
    </nav>
    {view === 'setup' && children}
    {wheel && <section className="mt-5" aria-label="Game draw">
      {stages.length > 1 && <label className="mb-4 block text-sm">Round <select className="ml-2 rounded-lg bg-slate-800 px-3 py-2" value={stage?.id ?? ''} onChange={event => setDrawStage(event.target.value)}>{stages.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {stage ? <GameWheel key={`${stage.id}-${view}`} stage={stage} station={view === 'wheel1' ? 0 : 1} tournamentId={tournament.id} token={token} onError={onError} onChange={onChange} /> : <p className="p-6 text-slate-300">Add a two-station stage in Setup to use the wheels.</p>}
    </section>}
    {(view === 'station1' || view === 'station2') && <section>
      {stages.length > 1 && <label className="mt-4 block text-sm">Round <select className="ml-2 rounded-lg bg-slate-800 px-3 py-2" value={stage?.id ?? ''} onChange={event => setDrawStage(event.target.value)}>{stages.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {stage?.status === 'pending' ? <p className="mt-6 text-slate-300">This stage is waiting for the previous stage to finish.</p> : stage ? <StationView key={`${stage.id}-${view}`} tournament={tournament} stage={stage} station={view === 'station1' ? 0 : 1} adminToken={token} revision={revision} onError={onError} onChange={onChange} /> : <p className="mt-6 text-slate-300">Add a two-station stage in Setup first.</p>}
    </section>}
    {view === 'leaderboard' && <section>
      {stages.length > 1 && <label className="mt-4 block text-sm">Round <select className="ml-2 rounded-lg bg-slate-800 px-3 py-2" value={stage?.id ?? ''} onChange={event => setDrawStage(event.target.value)}>{stages.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {stage ? <LeaderboardView key={stage.id} tournamentId={tournament.id} stageId={stage.id} status={stage.status} revision={revision} /> : <p className="mt-6 text-slate-300">Add a two-station stage in Setup first.</p>}
    </section>}
    {stageView && <section className="mt-6 min-h-[50vh]" aria-label={`${stageView.name} stage`}><StagePanel key={stageView.id} tournamentId={tournament.id} stage={stageView} isFinal={stageView.id === finalStage?.id} token={token} onError={onError} onChange={onChange} revision={revision} /></section>}
    {view === 'progression' && <ProgressionView tournamentId={tournament.id} stages={tournament.stages} token={token} onError={onError} onChange={onChange} revision={revision} />}
  </>;
}

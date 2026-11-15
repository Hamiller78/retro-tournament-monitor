import { useEffect, useState, type ReactNode } from 'react';
import type { Tournament } from '../../shared/contracts';
import { GameWheel } from './GameWheel';

type View = 'setup' | 'wheel1' | 'wheel2' | 'station1' | 'station2' | 'leaderboard' | 'progression';
const views: { id: View; label: string }[] = [
  { id: 'setup', label: 'Setup' }, { id: 'wheel1', label: 'Wheel 1' }, { id: 'wheel2', label: 'Wheel 2' },
  { id: 'station1', label: 'Station 1' }, { id: 'station2', label: 'Station 2' },
  { id: 'leaderboard', label: 'Leaderboard' }, { id: 'progression', label: 'Progression' },
];
type Props = { tournament: Tournament; token: string; children: ReactNode; onError: (error: string) => void; onChange: () => void; onViewChange: (presentation: boolean) => void };
export function TournamentViews({ tournament, token, children, onError, onChange, onViewChange }: Props) {
  const [view, setView] = useState<View>('setup');
  const [drawStage, setDrawStage] = useState('');
  const [fullScreen, setFullScreen] = useState(Boolean(document.fullscreenElement));
  const stages = tournament.stages.filter(stage => stage.kind === 'two-station');
  const stage = stages.find(item => item.id === drawStage) ?? stages[0];
  useEffect(() => { const changed = () => setFullScreen(Boolean(document.fullscreenElement)); document.addEventListener('fullscreenchange', changed); return () => document.removeEventListener('fullscreenchange', changed); }, []);
  async function toggleFullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { onError('Full screen is not available in this browser.'); }
  }
  const wheel = view === 'wheel1' || view === 'wheel2';
  return <>
    <nav aria-label="Tournament views" className="mt-5 flex flex-wrap items-center gap-2 border-b border-slate-700 pb-3">
      {views.map(item => <button type="button" key={item.id} aria-current={view === item.id ? 'page' : undefined} onClick={() => { setView(item.id); onViewChange(item.id !== 'setup'); }} className={`rounded-lg px-3 py-2 text-sm ${view === item.id ? 'bg-violet-700 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}>{item.label}</button>)}
      {document.fullscreenEnabled && <button type="button" onClick={() => void toggleFullscreen()} className="ml-auto rounded-lg border border-slate-600 px-3 py-2 text-sm">{fullScreen ? 'Exit full screen' : 'Full screen'}</button>}
    </nav>
    {view === 'setup' && children}
    {wheel && <section className="mt-5" aria-label="Game draw">
      {stages.length > 1 && <label className="mb-4 block text-sm">Round <select className="ml-2 rounded-lg bg-slate-800 px-3 py-2" value={stage?.id ?? ''} onChange={event => setDrawStage(event.target.value)}>{stages.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {stage ? <GameWheel key={`${stage.id}-${view}`} stage={stage} station={view === 'wheel1' ? 0 : 1} tournamentId={tournament.id} token={token} onError={onError} onChange={onChange} /> : <p className="p-6 text-slate-300">Add a two-station stage in Setup to use the wheels.</p>}
    </section>}
    {(view === 'station1' || view === 'station2') && <section className="mt-6 min-h-[50vh]"><h3 className="text-3xl font-bold">Station {view === 'station1' ? 1 : 2}</h3><p className="mt-4 text-slate-300">Station rankings and result entry will be available here.</p></section>}
    {view === 'leaderboard' && <section className="mt-6 min-h-[50vh]"><h3 className="text-3xl font-bold">Combined leaderboard</h3><p className="mt-4 text-slate-300">The combined rankings will be available here once result entry is implemented.</p></section>}
    {view === 'progression' && <section className="mt-6 min-h-[50vh]"><h3 className="text-3xl font-bold">Tournament progression</h3>{tournament.stages.length ? <ol className="mt-4 space-y-2">{tournament.stages.map((stage, index) => <li className="rounded-lg bg-slate-800 p-4 text-lg" key={stage.id}>{index + 1}. {stage.name}</li>)}</ol> : <p className="mt-4 text-slate-300">No stages configured yet.</p>}</section>}
  </>;
}

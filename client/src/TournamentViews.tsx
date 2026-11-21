import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { Tournament } from '../../shared/contracts';

import { GameWheel } from './GameWheel';

import { StationView } from './StationView';

import { LeaderboardView } from './LeaderboardView';

import { ProgressionView, StagePanel } from './ProgressionView';

import { TournamentWinner } from './TournamentWinner';
import { SoundControl } from './Sound';



type View = 'setup' | 'wheel1' | 'wheel2' | 'station1' | 'station2' | 'wheelSelected' | 'stationSelected' | 'leaderboard' | 'progression' | `stage:${string}`;

const views: { id: View; label: string; requiresStations?: boolean }[] = [

  { id: 'setup', label: 'Setup' }, { id: 'wheel1', requiresStations: true, label: 'Wheel 1' }, { id: 'wheel2', requiresStations: true, label: 'Wheel 2' },

  { id: 'station1', requiresStations: true, label: 'Station 1' }, { id: 'station2', requiresStations: true, label: 'Station 2' },

  { id: 'leaderboard', requiresStations: true, label: 'Leaderboard' }, { id: 'progression', label: 'Progression' },

];

type Props = { tournament: Tournament; token: string; children: ReactNode; onError: (error: string) => void; onChange: () => void; onViewChange: (presentation: boolean) => void; revision: number };

export function TournamentViews({ tournament, token, children, onError, onChange, onViewChange, revision }: Props) {

  const [view, setView] = useState<View>('setup');
  const displayQueue = useRef<Promise<void>>(Promise.resolve());

  const [drawStage, setDrawStage] = useState('');
  const [extraStation, setExtraStation] = useState(0);

  const [fullScreen, setFullScreen] = useState(Boolean(document.fullscreenElement));

  const stages = tournament.stages.filter(stage => stage.kind === 'two-station');

  const stage = stages.find(item => item.id === drawStage) ?? stages.find(item => item.status === 'active') ?? stages[0];

  useEffect(() => {
    const count = stage?.settings?.stations?.length ?? 2;
    if ((view === 'wheel2' || view === 'station2') && count < 2) { setView(view === 'wheel2' ? 'wheel1' : 'station1'); }
    if (view === 'wheelSelected' || view === 'stationSelected') {
      if (count <= 2) setView(view === 'wheelSelected' ? 'wheel1' : 'station1');
      if (extraStation >= count) setExtraStation(0);
    }
  }, [stage?.settings?.stations?.length, view, extraStation]);

  useEffect(() => {
    if (stages.length === 0 && (views.some(item => item.id === view && item.requiresStations) || view === 'wheelSelected' || view === 'stationSelected')) {
      setView('setup');
      onViewChange(false);
    }
  }, [stages.length, view, onViewChange]);

  const finalStage = tournament.stages.filter(item => item.kind !== 'tie-breaker').at(-1);

  const laterStages = tournament.stages.filter(item => item.kind === 'elimination' || item.kind === 'duel' || (item.kind === 'tie-breaker' && item.status !== 'pending'));

  const stageView = view.startsWith('stage:') ? laterStages.find(item => `stage:${item.id}` === view) : undefined;

  useEffect(() => { const changed = () => setFullScreen(Boolean(document.fullscreenElement)); document.addEventListener('fullscreenchange', changed); return () => document.removeEventListener('fullscreenchange', changed); }, []);

  async function toggleFullscreen() {

    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }

    catch { onError('Full screen is not available in this browser.'); }

  }

  function updateDisplay(selection: { mode: 'ranking' } | { mode: 'wheel'; stageId: string; station: number }) {
    displayQueue.current = displayQueue.current.then(async () => {
      const response = await fetch(`/api/tournaments/${tournament.id}/display-view`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(selection) });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'Could not update the TV display.'); }
    }).catch(error => onError(error instanceof TypeError ? 'Could not update the TV display. Check the connection.' : (error as Error).message));
  }
  function chooseView(next: View) {
    const wasWheel = view === 'wheel1' || view === 'wheel2' || view === 'wheelSelected';
    setView(next); onViewChange(next !== 'setup');
    if (next === 'wheel1' || next === 'wheel2' || next === 'wheelSelected') {
      const index = next === 'wheel1' ? 0 : next === 'wheel2' ? 1 : extraStation;
      if (stage?.status === 'active' && stage.settings?.stations?.[index]?.mode !== 'fixed') updateDisplay({ mode: 'wheel', stageId: stage.id, station: index }); else updateDisplay({ mode: 'ranking' });
    } else if (wasWheel || view.startsWith('stage:') || view === 'progression') updateDisplay({ mode: 'ranking' });
  }
  const wheel = view === 'wheel1' || view === 'wheel2' || view === 'wheelSelected';
  const selectedStation = view === 'wheel1' || view === 'station1' ? 0 : view === 'wheel2' || view === 'station2' ? 1 : extraStation;

  return <>

    <TournamentWinner tournamentId={tournament.id} revision={revision} hasTrophyImage={tournament.hasTrophyImage} />

    <nav aria-label="Tournament views" className="arcade-nav mt-5 flex flex-wrap items-center gap-2 border-b border-slate-700 pb-3">

      {views.filter(item => (!item.requiresStations || stages.length > 0) && (!['wheel2', 'station2'].includes(item.id) || (stage?.settings?.stations?.length ?? 2) > 1) && (!['wheel1', 'wheel2', 'station1', 'station2'].includes(item.id) || (stage?.settings?.stations?.length ?? 2) <= 2)).map(item => <button type="button" key={item.id} aria-current={view === item.id ? 'page' : undefined} onClick={() => chooseView(item.id)} className={`rounded-lg px-3 py-2 text-sm ${view === item.id ? 'bg-violet-700 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}>{item.id === 'wheel1' && stage?.settings?.stations?.[0]?.mode === 'fixed' ? 'Game 1' : item.id === 'wheel2' && stage?.settings?.stations?.[1]?.mode === 'fixed' ? 'Game 2' : item.label}</button>)}

      {stages.length > 1 && <label className="text-sm">Stage <select value={stage?.id ?? ''} onChange={event => { const selected = stages.find(item => item.id === event.target.value); setDrawStage(event.target.value); setExtraStation(0); const wasDraw = view === 'wheel1' || view === 'wheel2' || view === 'wheelSelected'; const wasStation = view === 'station1' || view === 'station2' || view === 'stationSelected'; const many = (selected?.settings?.stations?.length ?? 2) > 2; if (wasDraw) { setView(many ? 'wheelSelected' : 'wheel1'); if (selected?.status === 'active' && selected.settings?.stations?.[0]?.mode !== 'fixed') updateDisplay({ mode: 'wheel', stageId: selected.id, station: 0 }); else updateDisplay({ mode: 'ranking' }); } else if (wasStation) setView(many ? 'stationSelected' : 'station1'); }} className="rounded-lg bg-slate-800 px-3 py-2">{stages.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {(stage?.settings?.stations?.length ?? 0) > 2 && <><label className="text-sm">Station <select value={extraStation} onChange={event => { const index = Number(event.target.value); setExtraStation(index); if (view === 'wheelSelected' && stage?.status === 'active') updateDisplay(stage.settings?.stations?.[index]?.mode === 'fixed' ? { mode: 'ranking' } : { mode: 'wheel', stageId: stage.id, station: index }); }} className="rounded-lg bg-slate-800 px-3 py-2">{stage!.settings!.stations!.map((_, index) => <option key={index} value={index}>Station {index + 1}</option>)}</select></label><button type="button" className="rounded-lg bg-slate-800 px-3 py-2 text-sm" onClick={() => chooseView('wheelSelected')}>{stage?.settings?.stations?.[extraStation]?.mode === 'fixed' ? 'Game for selected station' : 'Wheel for selected station'}</button><button type="button" className="rounded-lg bg-slate-800 px-3 py-2 text-sm" onClick={() => chooseView('stationSelected')}>Open selected station</button></>}
      {laterStages.map(item => { const stageTab = `stage:${item.id}` as const; return <button type="button" key={item.id} aria-current={view === stageTab ? 'page' : undefined} onClick={() => chooseView(stageTab)} className={`rounded-lg px-3 py-2 text-sm ${view === stageTab ? 'bg-violet-700 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}>{item.name}</button>; })}

      <a className="rounded-lg border border-cyan-700 px-3 py-2 text-sm text-cyan-200 hover:bg-slate-800" href={`/display/${tournament.id}`} target="_blank" rel="noopener noreferrer">Open TV display</a>
      <SoundControl />
      {document.fullscreenEnabled && <button type="button" onClick={() => void toggleFullscreen()} className="ml-auto rounded-lg border border-slate-600 px-3 py-2 text-sm">{fullScreen ? 'Exit full screen' : 'Full screen'}</button>}

    </nav>

    {view === 'setup' && children}

    {wheel && <section className="mt-5" aria-label="Game draw">


      {stage ? <GameWheel key={`${stage.id}-${view}-${selectedStation}`} stage={stage} station={selectedStation} tournamentId={tournament.id} token={token} onError={onError} onChange={onChange} /> : <p className="p-6 text-slate-300">Add a two-station stage in Setup to use the wheels.</p>}

    </section>}

    {(view === 'station1' || view === 'station2' || view === 'stationSelected') && <section>


      {stage?.status === 'pending' ? <p className="mt-6 text-slate-300">This stage is waiting for the previous stage to finish.</p> : stage ? <StationView key={`${stage.id}-${view}-${selectedStation}`} tournament={tournament} stage={stage} station={selectedStation} adminToken={token} revision={revision} onError={onError} onChange={onChange} /> : <p className="mt-6 text-slate-300">Add a two-station stage in Setup first.</p>}

    </section>}

    {view === 'leaderboard' && <section>


      {stage ? <LeaderboardView key={stage.id} tournamentId={tournament.id} stageId={stage.id} status={stage.status} revision={revision} /> : <p className="mt-6 text-slate-300">Add a two-station stage in Setup first.</p>}

    </section>}

    {stageView && <section className="mt-6 min-h-[50vh]" aria-label={`${stageView.name} stage`}><StagePanel key={stageView.id} tournamentId={tournament.id} stage={stageView} isFinal={stageView.id === finalStage?.id} token={token} onError={onError} onChange={onChange} revision={revision} /></section>}

    {view === 'progression' && <ProgressionView tournamentId={tournament.id} stages={tournament.stages} token={token} onError={onError} onChange={onChange} revision={revision} />}

  </>;

}


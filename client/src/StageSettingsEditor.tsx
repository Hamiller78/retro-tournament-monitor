import { useState, type FormEvent } from 'react';
import type { GameSettings, Stage, StageSettings } from '../../shared/contracts';

const input = 'w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white';
const button = 'rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white hover:bg-violet-500 disabled:opacity-50';
const secondary = 'rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800';
type Props = { stage: Stage; tournamentId: string; token: string; onChange: () => void; onSaved: (stageId: string, settings: StageSettings) => void; onError: (message: string) => void; onClose: () => void };
const blankGame = (): GameSettings => ({ name: '', resultKind: 'score', higherIsBetter: true, attempts: 1, players: 1 });

export function StageSettingsEditor({ stage, tournamentId, token, onChange, onSaved, onError, onClose }: Props) {
  const existing = stage.settings;
  const [stations, setStations] = useState<GameSettings[][]>(() => [existing?.stations?.[0]?.games ?? [], existing?.stations?.[1]?.games ?? []]);
  const [points, setPoints] = useState(() => existing?.points?.join(', ') ?? '');
  const [game, setGame] = useState(() => existing?.game ?? '');
  const [bestOf, setBestOf] = useState<1 | 3 | 5>(() => existing?.bestOf ?? 1);
  const [busy, setBusy] = useState(false);
  function updateGame(station: number, index: number, patch: Partial<GameSettings>) { setStations(old => old.map((games, i) => i === station ? games.map((g, j) => j === index ? { ...g, ...patch } : g) : games)); }
  async function save(event: FormEvent) {
    event.preventDefault(); onError('');
    const parts = points.trim() ? points.split(',').map(value => value.trim()) : [];
    if (parts.some(value => !/^\d+$/.test(value))) { onError('Enter whole, non-negative points separated by commas.'); return; }
    const settings: StageSettings = stage.kind === 'two-station' ? { stations: stations.map(games => ({ games })), points: parts.map(Number) } : stage.kind === 'duel' ? { game, bestOf } : { game };
    setBusy(true);
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/stages/${stage.id}/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(settings) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not save settings.');
      onSaved(stage.id, settings); onChange(); onClose();
    } catch (error) { onError((error as Error).message); } finally { setBusy(false); }
  }
  return <form onSubmit={save} className="mt-5 space-y-4 rounded-lg border border-violet-800 p-4"><h4 className="font-semibold">Game settings: {stage.name}</h4>
    {stage.kind === 'two-station' ? <>
      {stations.map((games, station) => <fieldset className="space-y-3" key={station}><legend className="font-semibold">Station {station + 1} game pool</legend>
        {games.map((item, index) => <div key={index} className="grid gap-2 rounded-lg bg-slate-800 p-3 sm:grid-cols-2"><label className="text-sm">Game name<input className={input} required maxLength={100} value={item.name} onChange={e => updateGame(station, index, { name: e.target.value })}/></label><label className="text-sm">Result type<select className={input} value={item.resultKind} onChange={e => updateGame(station, index, { resultKind: e.target.value as 'score' | 'time' })}><option value="score">Score</option><option value="time">Time</option></select></label><label className="text-sm">Better result<select className={input} value={item.higherIsBetter ? 'higher' : 'lower'} onChange={e => updateGame(station, index, { higherIsBetter: e.target.value === 'higher' })}><option value="higher">Higher</option><option value="lower">Lower</option></select></label><label className="text-sm">Simultaneous players<select className={input} value={item.players ?? 1} onChange={e => updateGame(station, index, { players: Number(e.target.value) as 1 | 2 })}><option value={1}>One player</option><option value={2}>Up to two players</option></select></label><label className="text-sm">Attempts<input className={input} type="number" min="1" max="100" required value={item.attempts} onChange={e => updateGame(station, index, { attempts: Number(e.target.value) })}/></label><details className="rounded border border-slate-600 p-3 sm:col-span-2"><summary className="cursor-pointer font-semibold text-violet-200">Game information (optional)</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Developer<input className={input} maxLength={100} value={item.developer ?? ''} onChange={e => updateGame(station, index, { developer: e.target.value })}/></label>
          <label className="text-sm">Platform<input className={input} maxLength={100} value={item.platform ?? ''} onChange={e => updateGame(station, index, { platform: e.target.value })}/></label>
          <label className="text-sm">Release year<input className={input} type="number" min="1" max="9999" step="1" value={item.releaseYear ?? ''} onChange={e => updateGame(station, index, { releaseYear: e.target.value === '' ? undefined : Number(e.target.value) })}/></label>
          <label className="text-sm sm:col-span-2">Description<textarea className={input} maxLength={1000} rows={3} value={item.description ?? ''} onChange={e => updateGame(station, index, { description: e.target.value })}/></label>
        </div></details><div><button type="button" className={secondary} onClick={() => setStations(old => old.map((gs, i) => i === station ? gs.filter((_, j) => j !== index) : gs))}>Remove game {item.name || index + 1}</button></div></div>)}
        <button type="button" className={secondary} onClick={() => setStations(old => old.map((gs, i) => i === station ? [...gs, blankGame()] : gs))}>Add game to station {station + 1}</button>
      </fieldset>)}
      <label className="block text-sm">Points by finishing position<input className={input} value={points} onChange={e => setPoints(e.target.value)} placeholder="12, 10, 8, 7"/><span className="text-slate-400">Separate points with commas; positions beyond the list get zero.</span></label>
    </> : <><label className="block text-sm">Game name<input className={input} value={game} onChange={e => setGame(e.target.value)} maxLength={100}/></label>{stage.kind === 'duel' && <label className="block text-sm">Match format<select className={input} value={bestOf} onChange={e => setBestOf(Number(e.target.value) as 1 | 3 | 5)}><option value={1}>Single match</option><option value={3}>Best of three</option><option value={5}>Best of five</option></select></label>}</>}
    <div className="flex gap-2"><button className={button} disabled={busy}>Save game settings</button><button type="button" className={secondary} onClick={onClose}>Cancel</button></div>
  </form>;
}

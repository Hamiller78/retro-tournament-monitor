import { useState, type FormEvent } from 'react';
import type { Stage, StageKind } from '../../shared/contracts';
import { StageSettingsEditor } from './StageSettingsEditor';

const formats: Record<StageKind, string> = { 'two-station': 'Two-station ranking', elimination: 'Multiplayer elimination', duel: 'Fighting duel', 'tie-breaker': 'Tie-breaker' };
const input = 'w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white focus:outline-2 focus:outline-violet-400';
const button = 'rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white hover:bg-violet-500';
const secondary = 'rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-40';

type Props = { tournamentId: string; stages: Stage[]; token: string; onChange: () => void; onError: (error: string) => void };
export function StageSetup({ tournamentId, stages, token, onChange, onError }: Props) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<StageKind>('two-station');
  const [count, setCount] = useState('');
  const [editing, setEditing] = useState('');
  const [configuring, setConfiguring] = useState('');
  const [busy, setBusy] = useState(false);
  function reset() { setName(''); setKind('two-station'); setCount(''); setEditing(''); }
  async function request(path: string, method: string, body?: object) {
    setBusy(true); onError('');
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/stages${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save stage.');
      onChange(); return true;
    } catch (error) { onError((error as Error).message); return false; } finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    const original = stages.find(stage => stage.id === editing);
    if (original && original.kind !== kind && original.settings && !confirm('Changing the stage format will clear its game settings. Continue?')) return;
    if (await request(editing ? `/${editing}` : '', editing ? 'PUT' : 'POST', { name, kind, participantCount: count === '' ? null : Number(count) })) reset();
  }
  function edit(stage: Stage) { setEditing(stage.id); setName(stage.name); setKind(stage.kind); setCount(stage.participantCount === null ? '' : String(stage.participantCount)); }
  async function remove(stage: Stage) { if (confirm(`Remove stage ${stage.name}?`) && await request(`/${stage.id}`, 'DELETE') && editing === stage.id) reset(); }
  return <section className="mt-8 border-t border-slate-700 pt-6" aria-labelledby="stages-heading">
    <h3 id="stages-heading" className="text-xl font-bold">Stages <span className="text-slate-400">({stages.length})</span></h3>
    <p className="mt-1 text-sm text-slate-400">Arrange your stages in playing order. Set up games and scoring for each stage.</p>
    {stages.length === 0 ? <p className="mt-3 text-slate-400">No stages yet.</p> : <ol className="mt-3 divide-y divide-slate-700">{stages.map((stage, index) => <li key={stage.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><span className="font-semibold">{index + 1}. {stage.name}</span><p className="text-sm text-slate-400">{formats[stage.kind]} · {stage.participantCount === null ? 'Player count not set' : `${stage.participantCount} players`}{stage.kind === 'tie-breaker' ? ' · Conditional' : ''}</p></div>{token && <div className="flex flex-wrap gap-2"><button type="button" className={secondary} disabled={busy || index === 0} onClick={() => void request(`/${stage.id}/move`, 'POST', { direction: 'up' })} aria-label={`Move ${stage.name} up`}>↑</button><button type="button" className={secondary} disabled={busy || index === stages.length - 1} onClick={() => void request(`/${stage.id}/move`, 'POST', { direction: 'down' })} aria-label={`Move ${stage.name} down`}>↓</button><button type="button" className={secondary} onClick={() => setConfiguring(stage.id)}>Game settings <span className="sr-only">{stage.name}</span></button><button type="button" className={secondary} onClick={() => edit(stage)}>Edit <span className="sr-only">{stage.name}</span></button><button type="button" className={secondary} disabled={busy} onClick={() => void remove(stage)}>Remove <span className="sr-only">{stage.name}</span></button></div>}</li>)}</ol>}
    {token && stages.find(stage => stage.id === configuring) && <StageSettingsEditor key={configuring} stage={stages.find(stage => stage.id === configuring)!} tournamentId={tournamentId} token={token} onChange={onChange} onError={onError} onClose={() => setConfiguring('')} />}
    {token && <form onSubmit={save} className="mt-5 space-y-3 border-t border-slate-700 pt-5"><h4 className="font-semibold">{editing ? 'Edit stage' : 'Add stage'}</h4><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Stage name<input className={input} value={name} onChange={event => setName(event.target.value)} maxLength={100} required /></label><label className="text-sm">Stage format<select className={input} value={kind} onChange={event => setKind(event.target.value as StageKind)}>{Object.entries(formats).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="text-sm">Number of players (optional)<input className={input} type="number" min="1" max="999" step="1" value={count} onChange={event => setCount(event.target.value)} /></label></div><div className="flex gap-2"><button className={button} disabled={busy}>{editing ? 'Save stage' : 'Add stage'}</button>{editing && <button type="button" className={secondary} onClick={reset}>Cancel stage edit</button>}</div></form>}
  </section>;
}

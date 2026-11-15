import { useEffect, useRef, useState } from 'react';
import type { Stage } from '../../shared/contracts';

type Person = { id: string; displayName: string; withdrawn?: boolean };
type Outcome = { kind: 'elimination' | 'duel' | 'tie-breaker'; entrants: Person[]; results: { id: string; participantId: string; position: number }[]; complete: boolean; ranking: string[]; game: string; bestOf: number | null; eligibleIds?: string[]; needsTie?: boolean; blockedReason?: string | null };
type Props = { tournamentId: string; stage: Stage; isFinal: boolean; token: string; revision: number; onError: (message: string) => void; onChange: () => void };
function makeId() { const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128; const s = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`; }
export function LaterStageView({ tournamentId, stage, token, revision, onError, onChange }: Props) {
  const [outcome, setOutcome] = useState<Outcome | null>(null); const [busy, setBusy] = useState(false);
  const pending = useRef<{ participantId: string; requestId: string } | null>(null);
  const base = `/api/tournaments/${tournamentId}/stages/${stage.id}/outcome`;
  useEffect(() => {
    let current = true;
    fetch(base).then(response => { if (!response.ok) throw new Error('Could not load stage.'); return response.json() as Promise<Outcome>; }).then(data => { if (current) setOutcome(data); }).catch(() => { if (current) onError('Could not load stage results.'); });
    return () => { current = false; };
  }, [base, revision, onError]);
  async function record(participantId: string) {
    if (pending.current && pending.current.participantId !== participantId) { onError('Retry the previous result first so it is not entered twice.'); return; }
    pending.current ??= { participantId, requestId: makeId() };
    setBusy(true); onError('');
    try {
      const response = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.current) });
      const result = await response.json(); if (!response.ok) { pending.current = null; throw new Error(result.error || 'Could not record result.'); }
      pending.current = null; onChange();
    } catch (error) { onError(error instanceof TypeError ? 'Connection lost. Retry the same result after reconnecting.' : (error as Error).message); } finally { setBusy(false); }
  }
  async function correct(id: string, participantId: string) {
    setBusy(true); onError('');
    try { const response = await fetch(`${base}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ participantId }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not correct result.'); onChange(); }
    catch (error) { onError((error as Error).message); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true); onError('');
    try { const response = await fetch(`${base}/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not delete result.'); onChange(); }
    catch (error) { onError((error as Error).message); } finally { setBusy(false); }
  }
  if (!outcome) return <p className="mt-3 text-sm text-slate-400">Loading stage resultsâ€¦</p>;
  const names = new Map(outcome.entrants.map(person => [person.id, person.displayName]));
  const eliminated = new Set(outcome.kind === 'elimination' ? outcome.results.map(result => result.participantId) : []);
  return <div className="mt-4 border-t border-slate-700 pt-4" aria-label={`${stage.name} results`}>
    <p className="text-slate-300">{outcome.game || 'Game not set'}{outcome.kind === 'duel' && outcome.bestOf ? ` Â· ${outcome.bestOf === 1 ? 'Single match' : `Best of ${outcome.bestOf}`}` : ''}</p>
    {outcome.kind === 'tie-breaker' ? <>
      <p className="mt-3 font-semibold">{outcome.blockedReason ?? (!outcome.needsTie ? 'No tie-breaker is needed now. Close this stage to advance.' : outcome.complete ? 'Tie-breaker order' : outcome.eligibleIds?.length === 2 ? 'Choose the winner' : 'Enter the finishing order')}</p>
      <ul className="mt-2 flex flex-wrap gap-2">{(outcome.complete ? outcome.ranking.map(id => outcome.entrants.find(person => person.id === id)!) : outcome.entrants.filter(person => outcome.eligibleIds?.includes(person.id) && !outcome.results.some(result => result.participantId === person.id))).map((person, index) => <li key={person.id} className="rounded-lg bg-slate-700 px-3 py-2">{outcome.complete ? `${index + 1}. ` : ''}{person.displayName}{stage.status === 'active' && !outcome.complete && !outcome.blockedReason && <button type="button" className="ml-3 rounded border border-slate-400 px-2 py-1 text-sm disabled:opacity-50" disabled={busy} onClick={() => void record(person.id)}>{outcome.eligibleIds?.length === 2 ? 'Winner' : 'Place next'} <span className="sr-only">{person.displayName}</span></button>}</li>)}</ul>
      <p className="mt-4 text-sm text-slate-400">Recorded order</p>
    </> : outcome.kind === 'elimination' ? <>
      <p className="mt-3 font-semibold">{outcome.complete ? 'Final order' : 'Still playing'}</p>
      <ul className="mt-2 flex flex-wrap gap-2">{(outcome.complete ? outcome.ranking.map(id => outcome.entrants.find(p => p.id === id)!) : outcome.entrants.filter(person => !person.withdrawn && !eliminated.has(person.id))).map((person, index) => <li key={person.id} className="rounded-lg bg-slate-700 px-3 py-2">{outcome.complete ? `${index + 1}. ` : ''}{person.displayName}{stage.status === 'active' && !outcome.complete && <button type="button" className="ml-3 rounded border border-slate-400 px-2 py-1 text-sm disabled:opacity-50" disabled={busy} onClick={() => void record(person.id)}>Eliminate <span className="sr-only">{person.displayName}</span></button>}</li>)}</ul>
      <p className="mt-4 text-sm text-slate-400">Elimination order</p>
    </> : <>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{outcome.entrants.map(person => <div key={person.id} className="rounded-lg bg-slate-700 p-4"><p className="text-xl font-semibold">{person.displayName}{person.withdrawn && ' · Withdrawn'}</p><p className="text-3xl font-bold">{outcome.results.filter(result => result.participantId === person.id).length}</p>{stage.status === 'active' && !outcome.complete && !person.withdrawn && <button type="button" className="mt-2 rounded-lg bg-violet-600 px-3 py-2 disabled:opacity-50" disabled={busy} onClick={() => void record(person.id)}>Round won <span className="sr-only">{person.displayName}</span></button>}</div>)}</div>
      <p className="mt-4 text-sm text-slate-400">Rounds</p>
    </>}
    {outcome.kind === 'elimination' && outcome.entrants.some(person => person.withdrawn) && <p className="mt-3 text-sm text-amber-300">Withdrawn: {outcome.entrants.filter(person => person.withdrawn).map(person => person.displayName).join(', ')}</p>}
    {outcome.complete && outcome.kind !== 'tie-breaker' && <p className="mt-3 text-lg font-bold text-emerald-300">Winner: {names.get(outcome.ranking[0])}</p>}
    {outcome.results.length === 0 ? <p className="text-sm text-slate-400">No results recorded yet.</p> : <ol className="mt-2 space-y-1">{outcome.results.map((result, index) => <li key={result.id}>{index + 1}. {names.get(result.participantId)} {token && stage.status === 'active' && <><label className="ml-2 text-sm text-slate-300">Correct <span className="sr-only">{outcome.kind === 'duel' ? 'round' : outcome.kind === 'tie-breaker' ? 'placement' : 'elimination'} {index + 1}</span><select className="ml-1 rounded bg-slate-900 px-2 py-1 text-sm" value={result.participantId} disabled={busy} onChange={event => void correct(result.id, event.target.value)}>{outcome.entrants.map(person => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label> <button type="button" className="text-sm text-violet-300 underline" disabled={busy} onClick={() => void remove(result.id)}>Delete <span className="sr-only">{outcome.kind === 'duel' ? 'round' : outcome.kind === 'tie-breaker' ? 'placement' : 'elimination'} {index + 1}</span></button></>}</li>)}</ol>}
  </div>;
}

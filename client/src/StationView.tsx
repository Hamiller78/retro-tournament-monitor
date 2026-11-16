import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import type { GameSettings, Stage, Tournament } from '../../shared/contracts';

import { formatRaceTime, parseRaceTime } from './raceTime';
import { useRankingAnimation } from './useRankingAnimation';



type Row = { participantId: string; displayName: string; attempts: number[]; best: number | null; rank: number | null; forfeited: boolean; withdrawn?: boolean };

const rowSignature = (row: Row) => [row.rank, row.attempts, row.best, row.forfeited, row.withdrawn];

type Entry = { participantId: string; attempt: number; value: number };

type Snapshot = { game: GameSettings; activeParticipant: string | null; activeParticipants: string[]; locked: boolean; controlled: boolean; stationClosed: boolean; bothStationsClosed: boolean; total: number; pending: number; ranking: Row[]; entries: Entry[] };

type Props = { tournament: Tournament; stage: Stage; station: number; adminToken: string; revision: number; onError: (s: string) => void; onChange: () => void };

const button = 'rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white hover:bg-violet-500 disabled:opacity-50';

const secondary = 'rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-50';

function makeId() { const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128; const s = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`; }

export function StationView({ tournament, stage, station, adminToken, revision, onError, onChange }: Props) {

  const base = `/api/tournaments/${tournament.id}/stages/${stage.id}/stations/${station}`;

  const key = `station:${tournament.id}:${stage.id}:${station}`;

  const [token, setToken] = useState(() => sessionStorage.getItem(key) ?? '');

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const { tableBody: rankingBody, capture: captureRanking } = useRankingAnimation(snapshot?.ranking, rowSignature);

  const [values, setValues] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);

  const [completionMessage, setCompletionMessage] = useState('');

  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);

  const [correction, setCorrection] = useState('');

  const submission = useRef('');

  const refresh = useCallback(async () => {

    try {

      const response = await fetch(base, { headers: token ? { 'X-Station-Token': token } : {} });

      if (!response.ok) { setSnapshot(null); return; }

      const data: Snapshot = await response.json(); captureRanking(); setSnapshot(data);

      if (token && !data.controlled) { sessionStorage.removeItem(key); setToken(''); }

    } catch { /* retain the visible value and last known state while disconnected */ }

  }, [base, key, token, captureRanking]);

  useEffect(() => { void refresh(); }, [refresh, revision]);

  async function request(path: string, method: string, body?: object, admin = false) {

    setBusy(true); onError('');

    try {

      const response = await fetch(base + path, { method, headers: { ...(method !== 'DELETE' ? { 'Content-Type': 'application/json' } : {}), ...(token ? { 'X-Station-Token': token } : {}), ...(adminToken && admin ? { Authorization: `Bearer ${adminToken}` } : {}) }, ...(method !== 'DELETE' ? { body: JSON.stringify(body ?? {}) } : {}) });

      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'The request failed.');

      onChange(); return result;

    } catch (error) { onError((error as Error).message === 'Failed to fetch' ? 'Connection lost. Your entered value is still here; submit it after reconnecting.' : (error as Error).message); return null; } finally { setBusy(false); }

  }

  async function closeStation() {

    setCompletionMessage('');

    const result = await request('/close', 'POST');

    if (result) {

      setCompletionMessage(result.advanced ? result.tieBreakerActivated ? 'Station closed. The tie-breaker is ready.' : result.winnerDetermined ? 'Station closed. The tournament winner has been determined.' : 'Station closed. The stage is complete and the players have advanced.' : 'Station closed.');

      if (result.warning) onError(result.warning);

    }

  }

  async function reopenStation() {

    if (await request('/reopen', 'POST', undefined, true)) setCompletionMessage('Station reopened.');

  }

  async function claim() { const result = await request('/claim', 'POST'); if (result?.token) { sessionStorage.setItem(key, result.token); setToken(result.token); } }

  async function release() { if (await request('/release', 'POST', undefined, true)) { sessionStorage.removeItem(key); setToken(''); } }

  async function select(id: string) {

    if (!snapshot) return;

    const eligible = snapshot.activeParticipants.filter(current => {

      const row = snapshot.ranking.find(item => item.participantId === current);

      return row && !row.forfeited && row.attempts.length < snapshot.game.attempts;

    });

    const current = eligible.includes(id) ? eligible.filter(player => player !== id) : (snapshot.game.players ?? 1) === 1 ? [id] : [...eligible, id];

    if (current.length > (snapshot.game.players ?? 1)) { onError('Remove an active player before selecting another.'); return; }

    if (await request('/active', 'PUT', { participantIds: current })) submission.current = '';

  }

  async function submit(event: FormEvent) {

    event.preventDefault(); if (!snapshot) return;

    const eligible = snapshot.activeParticipants.filter(id => { const player = snapshot.ranking.find(row => row.participantId === id); return player && !player.forfeited && player.attempts.length < snapshot.game.attempts; });

    const results: { participantId: string; value: number }[] = [];

    for (const participantId of eligible) {

      const input = values[participantId]?.trim() ?? '';

      const result = snapshot.game.resultKind === 'time' ? parseRaceTime(input) : input ? Number(input) : null;

      if (result === null || !Number.isFinite(result) || result < 0 || result > 1000000000) { onError(snapshot.game.resultKind === 'time' ? 'Enter a time for each player as minutes:seconds, for example 01:23.45.' : 'Enter a valid non-negative score for each player.'); return; }

      results.push({ participantId, value: result });

    }

    if (!results.length) return;

    if (!submission.current) submission.current = makeId();

    if (await request('/attempts/batch', 'POST', { results, requestId: submission.current })) { setValues(old => { const remaining = { ...old }; for (const participantId of eligible) delete remaining[participantId]; return remaining; }); submission.current = ''; }

  }

  async function toggleForfeit(row: Row) {

    setBusy(true); onError('');

    try {

      const response = await fetch(`/api/tournaments/${tournament.id}/stages/${stage.id}/forfeits/${row.participantId}`, { method: row.forfeited ? 'DELETE' : 'POST', headers: { Authorization: `Bearer ${adminToken}`, ...(row.forfeited ? {} : { 'Content-Type': 'application/json' }) }, ...(row.forfeited ? {} : { body: '{}' }) });

      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not update the forfeit.');

      onChange();

    } catch (error) { onError((error as Error).message); } finally { setBusy(false); }

  }

  async function remove(entry: Entry) { await request(`/attempts/${entry.participantId}/${entry.attempt}`, 'DELETE', undefined, true); }

  function edit(entry: Entry) {

    setEditingEntry(entry);

    setCorrection(snapshot?.game.resultKind === 'time' ? formatRaceTime(entry.value) : String(entry.value));

    onError('');

  }

  async function saveCorrection(event: FormEvent) {

    event.preventDefault();

    if (!editingEntry) return;

    const isTime = snapshot?.game.resultKind === 'time';

    const result = isTime ? parseRaceTime(correction) : correction.trim() ? Number(correction) : null;

    if (result === null || !Number.isFinite(result) || result < 0 || result > 1000000000) { onError(isTime ? 'Enter a time as minutes:seconds, for example 01:23.45.' : 'Enter a valid non-negative number.'); return; }

    if (await request(`/attempts/${editingEntry.participantId}/${editingEntry.attempt}`, 'PUT', { value: result }, true)) setEditingEntry(null);

  }

  const active = snapshot?.activeParticipants.map(id => snapshot.ranking.find(row => row.participantId === id)).filter((row): row is Row => !!row) ?? [];

  const eligible = active.filter(row => !row.forfeited && row.attempts.length < (snapshot?.game.attempts ?? 0));

  if (!snapshot) return <section className="mt-6"><h3 className="text-3xl font-bold">Station {station + 1}</h3><p className="mt-4 text-slate-300">Confirm a game on the wheel before recording results.</p></section>;

  return <section className="mt-6" aria-label={`Station ${station + 1} results`}>

    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-3xl font-bold">Station {station + 1}: {snapshot.game.name}</h3><p className="text-slate-400">{snapshot.game.attempts} attempt(s) · {snapshot.game.higherIsBetter ? 'higher' : 'lower'} is better{snapshot.game.resultKind === 'time' ? ' · time (mm:ss)' : ' · score'}</p></div>

      <div className="flex gap-2">{stage.status === 'closed' || snapshot.stationClosed ? null : snapshot.controlled ? <button className={secondary} disabled={busy} onClick={() => void release()}>Release station</button> : !snapshot.locked ? <button className={button} disabled={busy} onClick={() => void claim()}>Take control</button> : <><span className="text-sm text-slate-400">Controlled by another device</span>{adminToken && <button className={secondary} disabled={busy} onClick={() => void release()}>Release station as admin</button>}</>}</div></div>

    {completionMessage && <p role="status" className="mt-3 text-emerald-300">{completionMessage}</p>}

    {stage.status !== 'closed' && <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-700 bg-slate-800 p-3" aria-label="Station completion">

      {snapshot.stationClosed ? <><strong className="text-emerald-300">Station closed</strong><span className="text-sm text-slate-300">{snapshot.bothStationsClosed ? 'Both stations are closed.' : 'Waiting for the other station.'}</span>{snapshot.bothStationsClosed && <button type="button" className={button} disabled={busy} onClick={() => void closeStation()}>Try advancing</button>}{adminToken && <button type="button" className={secondary} disabled={busy} onClick={() => void reopenStation()}>Reopen station</button>}</> : <><button type="button" className={button} disabled={busy || snapshot.total === 0 || snapshot.pending > 0} onClick={() => void closeStation()}>Close station</button><span className="text-sm text-slate-300">{snapshot.total === 0 ? 'Add participants before closing.' : snapshot.pending > 0 ? `${snapshot.pending} player${snapshot.pending === 1 ? '' : 's'} still ${snapshot.pending === 1 ? 'needs' : 'need'} results at this station.` : 'All results entered. Anyone can close this station.'}</span></>}

    </div>}

    {stage.status === "closed" && <p className="mt-3 font-semibold text-amber-300">This stage is closed. Reopen it to make corrections.</p>}<p className="mt-4 text-xl">Now playing: <strong>{active.map(player => player.displayName).join(' & ') || '—'}</strong></p>

    <div aria-live="polite">{active.map(player => <p key={player.participantId} className="mt-2 text-sm">{player.attempts.length >= snapshot.game.attempts ? <strong className="text-emerald-300">All attempts completed for {player.displayName}.</strong> : `${active.length > 1 ? `${player.displayName}: ` : ''}${player.attempts.length} of ${snapshot.game.attempts} attempts completed.`}</p>)}</div>

    {stage.status !== "closed" && !snapshot.stationClosed && snapshot.controlled && eligible.length > 0 && <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-3">{eligible.map(player => <label key={player.participantId} className="text-sm">{snapshot.game.resultKind === 'time' ? 'Time (mm:ss)' : 'Score'}{eligible.length > 1 ? ` — ${player.displayName}` : ''}<input className="block rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white" type={snapshot.game.resultKind === 'time' ? 'text' : 'number'} inputMode={snapshot.game.resultKind === 'time' ? 'text' : 'decimal'} placeholder={snapshot.game.resultKind === 'time' ? '01:23.45' : undefined} min={snapshot.game.resultKind === 'score' ? 0 : undefined} max={snapshot.game.resultKind === 'score' ? 1000000000 : undefined} step={snapshot.game.resultKind === 'score' ? 'any' : undefined} required value={values[player.participantId] ?? ''} onChange={event => { setValues(old => ({ ...old, [player.participantId]: event.target.value })); submission.current = ''; }} /></label>)}<button className={button} disabled={busy}>Save {eligible.length > 1 ? 'attempts' : 'attempt'}</button></form>}

    {editingEntry && adminToken && stage.status !== 'closed' && <form onSubmit={saveCorrection} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-violet-500 bg-slate-800 p-3" aria-label="Correct attempt">

      <p className="w-full text-sm text-slate-300">Editing {snapshot.ranking.find(row => row.participantId === editingEntry.participantId)?.displayName} · attempt {editingEntry.attempt}</p>
      <label className="text-sm">{snapshot.game.resultKind === 'time' ? 'Correct time (mm:ss)' : 'Correct score'}<input autoFocus className="block rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white" value={correction} onChange={event => setCorrection(event.target.value)} required /></label>

      <button type="submit" className={button} disabled={busy}>Save correction</button>

      <button type="button" className={secondary} disabled={busy} onClick={() => setEditingEntry(null)}>Cancel correction</button>

    </form>}

    <p className="mt-4 text-sm text-slate-400">Preliminary standings · best attempt counts</p>

    <div className="mt-2 overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b border-slate-600"><th className="p-2">Rank</th><th className="p-2">Player</th><th className="p-2">Attempts</th><th className="p-2">Best</th><th className="p-2"><span className="sr-only">Actions</span></th></tr></thead><tbody ref={rankingBody}>{snapshot.ranking.map(row => <tr key={row.participantId} data-ranking-id={row.participantId} className="border-b border-slate-800"><td className="p-2">{row.rank ?? '—'}</td><td className="p-2 font-semibold">{row.displayName}</td><td className="p-2"><span className={row.forfeited ? "mr-2 font-semibold text-amber-300" : row.attempts.length >= snapshot.game.attempts ? "mr-2 font-semibold text-emerald-300" : "mr-2 text-slate-300"}>{row.forfeited ? "Forfeited · saved results:" : row.attempts.length >= snapshot.game.attempts ? `Complete (${row.attempts.length}/${snapshot.game.attempts})` : `${row.attempts.length}/${snapshot.game.attempts} completed`}</span>{snapshot.entries.filter(entry => entry.participantId === row.participantId).map(entry => <span className="mr-2 inline-block" key={entry.attempt}>{snapshot.game.resultKind === 'time' ? formatRaceTime(entry.value) : entry.value}{adminToken && stage.status !== "closed" && <> <button type="button" onClick={() => edit(entry)} className="text-violet-300 underline" aria-label={`Edit ${row.displayName} attempt ${entry.attempt}`}>Edit</button> <button type="button" onClick={() => void remove(entry)} className="text-violet-300 underline" aria-label={`Delete ${row.displayName} attempt ${entry.attempt}`}>Delete</button></>}</span>)}{!row.attempts.length && '—'}</td><td className="p-2">{row.best === null ? '—' : snapshot.game.resultKind === 'time' ? formatRaceTime(row.best) : row.best}</td><td className="p-2">{stage.status !== "closed" && !snapshot.stationClosed && snapshot.controlled && !row.forfeited && row.attempts.length < snapshot.game.attempts && <button type="button" className={secondary} disabled={busy} onClick={() => void select(row.participantId)}>{snapshot.activeParticipants.includes(row.participantId) && (snapshot.game.players ?? 1) === 2 ? "Remove" : "Select"} <span className="sr-only">{row.displayName}</span></button>}{adminToken && stage.status !== "closed" && !row.withdrawn && <button type="button" className={`${secondary} ml-2`} disabled={busy} onClick={() => void toggleForfeit(row)}>{row.forfeited ? "Undo forfeit" : "Forfeit"} <span className="sr-only">{row.displayName}</span></button>}</td></tr>)}</tbody></table></div>

  </section>;

}


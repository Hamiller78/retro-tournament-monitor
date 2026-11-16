import { StrictMode, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { createRoot } from 'react-dom/client';

import type { Participant, Tournament, TournamentSummary } from '../../shared/contracts';

import './style.css';

import { StageSetup } from './StageSetup';

import { TournamentViews } from './TournamentViews';

import { DownloadBackup, RestoreBackup } from './BackupControls';
import { SoundProvider } from './Sound';
import { DisplayApp } from './DisplayApp';
import { TrophySetup } from './TrophySetup';



const inputClass = 'w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white focus:outline-2 focus:outline-violet-400';

const buttonClass = 'rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white hover:bg-violet-500 disabled:opacity-50';

const secondaryClass = 'rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-800';

async function api<T>(path: string, options: RequestInit = {}, token = ''): Promise<T> {

  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });

  const data = await response.json();

  if (!response.ok) throw new Error(data.error || 'Request failed.');

  return data as T;

}

function App() {

  const [connection, setConnection] = useState('connecting');

  const [presentation, setPresentation] = useState(false);

  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);

  const [selected, setSelected] = useState('');

  const selectedRef = useRef('');

  const [tournament, setTournament] = useState<Tournament | null>(null);

  const [token, setToken] = useState('');

  const [name, setName] = useState(''); const [pin, setPin] = useState(''); const [newPin, setNewPin] = useState('');

  const [displayName, setDisplayName] = useState(''); const [realName, setRealName] = useState('');

  const [editing, setEditing] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');

  const [revision, setRevision] = useState(0);

  const refreshList = useCallback(async () => { try { setTournaments(await api<TournamentSummary[]>('/api/tournaments')); } catch { /* connection indicator covers outages */ } }, []);

  useEffect(() => { void refreshList(); }, [refreshList, revision]);

  useEffect(() => {

    if (!selected) { setTournament(null); return; }

    let active = true;

    api<Tournament>(`/api/tournaments/${selected}`, {}, token).then(data => { if (active) { if (token && !data.isAdmin) { sessionStorage.removeItem(`admin:${selected}`); setToken(''); } setTournament(data); } }).catch(() => { if (active) setError('Could not load the tournament.'); });

    return () => { active = false; };

  }, [selected, token, revision]);

  useEffect(() => {

    let socket: WebSocket; let retry: ReturnType<typeof setTimeout> | undefined; let stopped = false;

    function connect() {

      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);

      socket.onmessage = event => { try { const data = JSON.parse(String(event.data)); if (data.status === 'ok') { setConnection('connected'); setRevision(n => n + 1); } else if (data.type === 'tournament-changed') { if (data.id === selectedRef.current) setRevision(n => n + 1); else void refreshList(); } } catch { /* ignore unrelated messages */ } };

      socket.onclose = () => { if (!stopped) { setConnection('disconnected'); retry = setTimeout(connect, 2000); } };

    }

    connect(); return () => { stopped = true; clearTimeout(retry); socket.close(); };

  }, []);

  function select(id: string) { setPresentation(false); selectedRef.current = id; setSelected(id); setToken(sessionStorage.getItem(`admin:${id}`) || ''); setPin(''); setEditing(''); setError(''); }

  async function create(event: FormEvent) {

    event.preventDefault(); setError('');

    try { const result = await api<{id: string; token: string}>('/api/tournaments', { method: 'POST', body: JSON.stringify({ name, pin: newPin }) }); sessionStorage.setItem(`admin:${result.id}`, result.token); setName(''); setNewPin(''); select(result.id); setRevision(n => n + 1); } catch (e) { setError((e as Error).message); }

  }

  async function login(event: FormEvent) {

    event.preventDefault(); setError('');

    try { const result = await api<{token: string}>(`/api/tournaments/${selected}/login`, { method: 'POST', body: JSON.stringify({ pin }) }); sessionStorage.setItem(`admin:${selected}`, result.token); setToken(result.token); setPin(''); } catch (e) { setError((e as Error).message); }

  }

  async function logout() { try { await api(`/api/tournaments/${selected}/logout`, { method: 'POST' }, token); } catch { /* clear local session regardless */ } sessionStorage.removeItem(`admin:${selected}`); setToken(''); setEditing(''); }

  async function saveParticipant(event: FormEvent) {

    event.preventDefault(); setError('');

    try { await api(`/api/tournaments/${selected}/participants${editing ? `/${editing}` : ''}`, { method: editing ? 'PUT' : 'POST', body: JSON.stringify({ displayName, realName }) }, token); setDisplayName(''); setRealName(''); setEditing(''); setRevision(n => n + 1); } catch (e) { setError((e as Error).message); }

  }

  async function removeParticipant(participant: Participant) {



    try { await api(`/api/tournaments/${selected}/participants/${participant.id}`, { method: 'DELETE', body: '{}' }, token); if (editing === participant.id) { setEditing(''); setDisplayName(''); setRealName(''); } setRevision(n => n + 1); } catch (e) { setError((e as Error).message); }

  }

  async function toggleWithdrawal(p: Participant) {

    setError(''); setNotice('');

    try { const result = await api<{warning?: string; replacementName?: string}>(`/api/tournaments/${selected}/participants/${p.id}/withdrawal`, { method: p.withdrawn ? 'DELETE' : 'POST', body: '{}' }, token); setRevision(n => n + 1); if (result.warning) setError(result.warning); else if (result.replacementName) setNotice(`${result.replacementName} joined the scoring stage as a replacement.`); } catch (e) { setError((e as Error).message); }

  }

  function editParticipant(p: Participant) { setEditing(p.id); setDisplayName(p.displayName); setRealName(p.realName ?? ''); }

  return <main className="arcade-app min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8"><div className={`mx-auto space-y-6 ${presentation ? "max-w-none" : "max-w-4xl"}`}>

    <header className="arcade-header flex flex-wrap items-end justify-between gap-3"><div><p className="arcade-kicker text-xs font-bold tracking-widest text-violet-300">RETRO TOURNAMENT MONITOR</p><h1 className="arcade-title mt-2 text-4xl font-bold">Retromania</h1></div><p className="text-sm text-slate-300" role="status">Server: {connection}</p></header>

    {notice && <p role="status" className="rounded-lg border border-emerald-700 bg-emerald-950 p-3">{notice}</p>}

    {error && <p role="alert" className="rounded-lg border border-red-700 bg-red-950 p-3">{error}</p>}

    <div className={`grid gap-6 ${presentation ? "grid-cols-1" : "md:grid-cols-[17rem_1fr]"}`}>

      <aside className={`${presentation ? "hidden" : ""} space-y-5 rounded-2xl border border-slate-700 bg-slate-900 p-5`}><section><h2 className="text-xl font-bold">Tournaments</h2><ul className="mt-3 space-y-2">{tournaments.map(t => <li key={t.id}><button className={`w-full rounded-lg px-3 py-2 text-left ${selected === t.id ? 'bg-violet-700' : 'bg-slate-800 hover:bg-slate-700'}`} onClick={() => select(t.id)}>{t.name}</button></li>)}</ul>{tournaments.length === 0 && <p className="mt-3 text-sm text-slate-400">No tournaments yet.</p>}</section>

      <form onSubmit={create} className="space-y-3 border-t border-slate-700 pt-4"><h3 className="font-semibold">Create tournament</h3><label className="block text-sm">Tournament name<input className={inputClass} value={name} onChange={e => setName(e.target.value)} required maxLength={100}/></label><label className="block text-sm">Administrator PIN<input className={inputClass} value={newPin} onChange={e => setNewPin(e.target.value)} type="password" inputMode="numeric" pattern="[0-9]{4,12}" required autoComplete="new-password"/><span className="text-xs text-slate-400">4–12 digits</span></label><button className={buttonClass}>Create</button></form><RestoreBackup onError={setError} onRestored={id => { select(id); setRevision(n => n + 1); }} /></aside>

      <section className="rounded-2xl border border-slate-700 bg-slate-900 p-5 sm:p-6">{!tournament ? <div><h2 className="text-2xl font-bold">Get ready to play</h2><p className="mt-3 text-slate-300">Create or select a tournament to manage its participants.</p></div> : <>

        <div className="tournament-heading flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm text-violet-300">{presentation ? "TOURNAMENT DISPLAY" : "TOURNAMENT SETUP"}</p><h2 className="text-2xl font-bold">{tournament.name}</h2></div>{token && <button className={secondaryClass} onClick={() => void logout()}>Log out</button>}</div>

        <TournamentViews key={selected} tournament={tournament} token={token} onError={setError} onChange={() => setRevision(n => n + 1)} onViewChange={setPresentation} revision={revision}>

        {!token ? <form onSubmit={login} className="mt-5 flex flex-wrap items-end gap-2"><label className="text-sm">Administrator PIN<input className={inputClass} type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)} required autoComplete="current-password"/></label><button className={buttonClass}>Unlock setup</button></form> : <p className="mt-4 text-sm text-emerald-300">Administrator access active</p>}

        <h3 className="mt-6 text-xl font-bold">Participants <span className="text-slate-400">({tournament.participants.length})</span></h3>

        {tournament.participants.length === 0 ? <p className="mt-3 text-slate-400">No participants yet.</p> : <ul className="mt-3 divide-y divide-slate-700">{tournament.participants.map(p => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><span className="font-semibold">{p.displayName}</span>{p.withdrawn && <span className="ml-2 text-sm text-amber-300">Withdrawn</span>}{token && p.realName && <span className="ml-2 text-sm text-slate-400">{p.realName}</span>}</div>{token && <div className="flex gap-2"><button className={secondaryClass} onClick={() => editParticipant(p)}>Edit <span className="sr-only">{p.displayName}</span></button><button className={secondaryClass} onClick={() => void toggleWithdrawal(p)}>{p.withdrawn ? 'Reactivate' : 'Withdraw'} <span className="sr-only">{p.displayName}</span></button><button className={secondaryClass} onClick={() => void removeParticipant(p)}>Remove <span className="sr-only">{p.displayName}</span></button></div>}</li>)}</ul>}

        {token && <form onSubmit={saveParticipant} className="mt-5 space-y-3 border-t border-slate-700 pt-5"><h4 className="font-semibold">{editing ? 'Edit participant' : 'Add participant'}</h4><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Display name<input className={inputClass} value={displayName} onChange={e => setDisplayName(e.target.value)} required maxLength={100}/></label><label className="text-sm">Real name (optional)<input className={inputClass} value={realName} onChange={e => setRealName(e.target.value)} maxLength={100}/></label></div><div className="flex gap-2"><button className={buttonClass}>{editing ? 'Save changes' : 'Add participant'}</button>{editing && <button type="button" className={secondaryClass} onClick={() => { setEditing(''); setDisplayName(''); setRealName(''); }}>Cancel</button>}</div></form>}

        <StageSetup key={selected} tournamentId={selected} stages={tournament.stages} token={token} onChange={() => setRevision(n => n + 1)} onSettingsSaved={(stageId, settings) => setTournament(current => current && current.id === selected ? { ...current, stages: current.stages.map(stage => stage.id === stageId ? { ...stage, settings } : stage) } : current)} onError={setError} />

        {token && <TrophySetup tournamentId={selected} token={token} hasImage={tournament.hasTrophyImage} revision={revision} onChange={() => setRevision(n => n + 1)} onError={setError} />}

        {token && <DownloadBackup tournamentId={selected} token={token} onError={setError} />}

        </TournamentViews>

      </>}</section>

    </div>

  </div></main>;

}



const displayMatch = /^\/display\/([^/]+)\/?$/.exec(window.location.pathname);
createRoot(document.getElementById('root')!).render(<StrictMode><SoundProvider>{displayMatch ? <DisplayApp tournamentId={displayMatch[1]} /> : <App />}</SoundProvider></StrictMode>);


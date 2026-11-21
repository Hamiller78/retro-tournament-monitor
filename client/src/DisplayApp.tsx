import { useEffect, useState, type CSSProperties } from 'react';
import type { Stage, Tournament } from '../../shared/contracts';
import { LeaderboardView } from './LeaderboardView';
import { useRankingAnimation } from './useRankingAnimation';
import { GameWheel } from './GameWheel';
import { stageGameWheel } from './stageGameWheel';

type Person = { id: string; displayName: string; withdrawn?: boolean };
type Outcome = { kind: 'elimination' | 'duel' | 'tie-breaker'; entrants: Person[]; results: { participantId: string }[]; complete: boolean; ranking: string[]; eligibleIds?: string[]; needsTie?: boolean; blockedReason?: string | null };
type DisplayRow = { participantId: string; displayName: string; rank: number | null; detail: string; withdrawn: boolean; signature: string };
const displaySignature = (row: DisplayRow) => [row.rank, row.detail, row.withdrawn, row.signature];

function laterRows(outcome: Outcome): DisplayRow[] {
  const people = outcome.entrants;
  const active = people.filter(person => !person.withdrawn);
  const withdrawn = people.filter(person => person.withdrawn).map(person => ({ participantId: person.id, displayName: person.displayName, rank: null, detail: 'Withdrawn', withdrawn: true, signature: '' }));
  if (outcome.kind === 'duel') {
    const ordered = active.map(person => ({ person, wins: outcome.results.filter(result => result.participantId === person.id).length })).sort((a, b) => b.wins - a.wins);
    return [...ordered.map(({ person, wins }, index) => ({ participantId: person.id, displayName: person.displayName, rank: index && wins === ordered[index - 1].wins ? 1 : index + 1, detail: `${wins} ${wins === 1 ? 'win' : 'wins'}`, withdrawn: false, signature: `${wins}` })), ...withdrawn];
  }
  if (outcome.kind === 'elimination') {
    const eliminated = outcome.results.map(result => result.participantId).filter(id => active.some(person => person.id === id));
    const playing = active.filter(person => !eliminated.includes(person.id));
    const ranked = [...eliminated].reverse().map((id, index) => ({ participantId: id, displayName: active.find(person => person.id === id)!.displayName, rank: playing.length + index + 1, detail: 'Eliminated', withdrawn: false, signature: 'eliminated' }));
    return [...playing.map(person => ({ participantId: person.id, displayName: person.displayName, rank: outcome.complete ? 1 : null, detail: outcome.complete ? 'Winner' : 'Playing', withdrawn: false, signature: outcome.complete ? 'winner' : 'playing' })), ...ranked, ...withdrawn];
  }
  const eligible = active.filter(person => outcome.eligibleIds?.includes(person.id));
  if (!outcome.needsTie || outcome.blockedReason) return [...active.map(person => ({ participantId: person.id, displayName: person.displayName, rank: null, detail: 'Waiting', withdrawn: false, signature: '' })), ...withdrawn];
  const placed = outcome.complete ? outcome.ranking : outcome.results.map(result => result.participantId).filter(id => eligible.some(person => person.id === id));
  return [...placed.map((id, index) => ({ participantId: id, displayName: eligible.find(person => person.id === id)?.displayName ?? '', rank: index + 1, detail: 'Placed', withdrawn: false, signature: `${index}` })), ...eligible.filter(person => !placed.includes(person.id)).map(person => ({ participantId: person.id, displayName: person.displayName, rank: null, detail: 'Waiting', withdrawn: false, signature: '' })), ...withdrawn];
}
function LaterDisplay({ tournamentId, stage, revision }: { tournamentId: string; stage: Stage; revision: number }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState(false);
  const rows = outcome ? laterRows(outcome) : undefined;
  const { tableBody, capture } = useRankingAnimation(rows, displaySignature);
  useEffect(() => {
    let current = true;
    fetch(`/api/tournaments/${tournamentId}/stages/${stage.id}/outcome`).then(response => { if (!response.ok) throw new Error(); return response.json() as Promise<Outcome>; }).then(result => { if (current) { capture(); setOutcome(result); setError(false); } }).catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [tournamentId, stage.id, revision, capture]);
  return <section className="display-ranking" aria-label={`${stage.name} ranking`} style={{ '--display-row-size': `${Math.min(4, 55 / Math.max(rows?.length ?? 1, 1))}vh` } as CSSProperties}>
    {error && <p role="status">Unable to refresh ranking. Showing the last available result.</p>}
    {outcome?.blockedReason && <p role="status">{outcome.blockedReason}</p>}
    {outcome?.kind === 'tie-breaker' && !outcome.needsTie && !outcome.blockedReason && <p role="status">No tie-breaker is needed. Waiting for the stage to close.</p>}
    {!outcome ? <p>Loading ranking…</p> : rows?.length ? <div className="display-table-wrap"><table className="score-table display-table"><thead><tr><th>Rank</th><th>Player</th><th>{outcome.kind === 'duel' ? 'Rounds' : 'Status'}</th></tr></thead><tbody ref={tableBody}>{rows.map(row => <tr key={row.participantId} data-ranking-id={row.participantId}><td className="score-rank">{row.rank ?? '—'}</td><td className="score-player">{row.displayName}</td><td>{row.detail}</td></tr>)}</tbody></table></div> : <p>No players in this stage yet.</p>}
  </section>;
}
export function DisplayApp({ tournamentId }: { tournamentId: string }) {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [winner, setWinner] = useState<{ name: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let socket: WebSocket, retry: ReturnType<typeof setTimeout> | undefined, stopped = false;
    function connect() {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
      socket.onmessage = event => { try { const data = JSON.parse(String(event.data)); if (data.status === 'ok') { setConnected(true); setRevision(value => value + 1); } else if (data.type === 'tournament-changed' && data.id === tournamentId) setRevision(value => value + 1); } catch { /* Ignore unrelated messages. */ } };
      socket.onclose = () => { if (!stopped) { setConnected(false); retry = setTimeout(connect, 2000); } };
    }
    connect(); return () => { stopped = true; clearTimeout(retry); socket.close(); };
  }, [tournamentId]);
  useEffect(() => {
    let current = true;
    fetch(`/api/tournaments/${tournamentId}`).then(async response => { if (!response.ok) throw new Error(response.status === 404 ? 'Tournament not found.' : 'Unable to load tournament.'); return response.json() as Promise<Tournament>; }).then(data => { if (current) { setTournament(data); setError(''); } }).catch(reason => { if (current) setError(reason instanceof TypeError ? 'Unable to connect. Retrying…' : reason.message); });
    return () => { current = false; };
  }, [tournamentId, revision]);
  useEffect(() => {
    let current = true;
    fetch(`/api/tournaments/${tournamentId}/winner`).then(response => { if (!response.ok) throw new Error(); return response.json() as Promise<{ winner: { name: string } | null }>; }).then(data => { if (current) setWinner(data.winner); }).catch(() => { /* Keep the last known winner if the connection drops. */ });
    return () => { current = false; };
  }, [tournamentId, revision]);
  const stage = tournament?.stages.find(item => item.status === 'active') ?? tournament?.stages.filter(item => item.status === 'closed').at(-1);
  const wheel = stage?.status === 'active' && tournament?.displayWheel?.stageId === stage.id ? tournament.displayWheel : null;
  const wheelStage = stage?.kind === 'two-station' ? stage : stage ? stageGameWheel(stage) : null;
  if (winner) return <main className="arcade-app tv-display tv-winner" aria-label="Tournament winner">
    {!connected && <span className="tv-winner-status" role="status">Disconnected · reconnecting…</span>}
    <section className="arcade-winner tv-winner-card">
      {tournament?.hasTrophyImage ? <img src={`/api/tournaments/${tournamentId}/trophy?revision=${revision}`} alt="Tournament trophy" /> : <p className="tv-winner-icon" aria-hidden="true">🏆</p>}
      <p className="arcade-winner-kicker">TOURNAMENT CHAMPION</p>
      <h1>We have a winner!</h1>
      <p className="tv-winner-name">{winner.name}</p>
      <p className="tv-winner-congratulations">Congratulations!</p>
    </section>
  </main>;
  return <main className="arcade-app tv-display">
    <header className="display-header"><div><span className="display-brand">RETROMANIA</span><h1>{stage?.name ?? tournament?.name ?? 'Tournament display'}</h1></div><div className="display-header-meta">{stage?.status === 'closed' ? 'Final standings' : stage ? 'Live' : ''}{!connected && <span role="status">Disconnected · reconnecting…</span>}</div></header>
    {error && <p className="display-message" role="status">{error}</p>}
    {!stage ? <p className="display-message">{tournament ? 'No active stage yet.' : 'Loading tournament…'}</p> : wheel && wheelStage ? <div className="display-wheel"><GameWheel key={`${stage.id}-${wheel.station}`} stage={wheelStage} station={wheel.station} label={stage.kind === 'two-station' ? undefined : stage.name} tournamentId={tournamentId} token="" onError={() => {}} onChange={() => {}} displayOnly /></div> : stage.kind === 'two-station' ? <LeaderboardView key={stage.id} tournamentId={tournamentId} stageId={stage.id} status={stage.status} revision={revision} displayOnly /> : <LaterDisplay key={stage.id} tournamentId={tournamentId} stage={stage} revision={revision} />}
  </main>;
}

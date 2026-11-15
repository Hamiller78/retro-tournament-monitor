import { useEffect, useState } from 'react';

type Leaderboard = {
  stageName: string;
  pointsConfigured: boolean;
  qualificationPlaces: number | null;
  qualificationSettled: boolean;
  stations: { game: string | null; nowPlaying: string | null }[];
  rows: { participantId: string; displayName: string; stationPoints: (number | null)[]; total: number | null; rank: number | null; forfeited: boolean; withdrawn?: boolean; qualification: 'qualified' | 'contested' | 'position' | null }[];
};
type Props = { tournamentId: string; stageId: string; status: 'pending' | 'active' | 'closed'; revision: number };
export function LeaderboardView({ tournamentId, stageId, status, revision }: Props) {
  const [data, setData] = useState<Leaderboard | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let current = true;
    fetch(`/api/tournaments/${tournamentId}/stages/${stageId}/leaderboard`)
      .then(response => { if (!response.ok) throw new Error('Could not load leaderboard'); return response.json() as Promise<Leaderboard>; })
      .then(result => { if (current) { setData(result); setError(false); } })
      .catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [tournamentId, stageId, revision]);
  return <section className="mt-6 min-h-[50vh]" aria-label="Combined leaderboard">
    <div className="flex flex-wrap items-end justify-between gap-2"><div><h3 className="text-3xl font-bold">Combined leaderboard</h3><p className="mt-1 text-slate-300">{data?.stageName}</p></div><p className="text-sm font-semibold text-amber-300">{status === 'closed' ? 'Final standings' : 'Preliminary standings'}</p></div>
    {error && <p role="status" className="mt-3 text-amber-300">Unable to refresh standings. Showing the last available results.</p>}
    {!data ? <p className="mt-5 text-slate-300">Loading leaderboard…</p> : <>
      {!data.pointsConfigured && <p className="mt-4 rounded-lg bg-amber-950 p-3 text-amber-200">Set the points schedule in stage game settings to calculate standings.</p>}
      {data.qualificationPlaces !== null && <p className="mt-4 text-sm text-emerald-200">{data.qualificationSettled ? 'Qualifiers confirmed' : `Top ${data.qualificationPlaces} advance � qualifying places update as results come in`}</p>}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">{data.stations.map((station, index) => <div key={index} className="rounded-xl bg-slate-800 p-4"><p className="text-sm font-bold text-violet-300">STATION {index + 1}</p><p className="text-xl font-semibold">{station.game ?? 'Game not selected'}</p><p className="mt-1 text-slate-300">Now playing: {station.nowPlaying ?? '—'}</p></div>)}</div>
      {data.rows.length === 0 ? <p className="mt-5 text-slate-400">No participants yet.</p> : <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-lg sm:text-xl"><thead><tr className="border-b border-slate-600 text-sm text-slate-300"><th className="p-3">Rank</th><th className="p-3">Player</th><th className="p-3 text-right">Station 1</th><th className="p-3 text-right">Station 2</th><th className="p-3 text-right">Total</th></tr></thead><tbody>{data.rows.map(row => <tr key={row.participantId} className={`border-b border-slate-800 ${row.qualification === 'contested' ? 'bg-amber-950/60' : row.qualification ? 'bg-emerald-950/60' : ''}`}><td className="p-3">{row.rank ?? '—'}</td><td className="p-3 font-semibold">{row.displayName}{row.qualification && <span className={`ml-2 text-sm ${row.qualification === 'contested' ? 'text-amber-300' : 'text-emerald-300'}`}>{row.qualification === 'contested' ? 'Tie at cutoff' : row.qualification === 'qualified' ? 'Qualified' : 'Qualifying place'}</span>}{row.forfeited && <span className="ml-2 text-sm text-amber-300">{row.withdrawn ? 'Withdrawn' : 'Forfeited'}</span>}</td><td className="p-3 text-right">{row.stationPoints[0] ?? '—'}</td><td className="p-3 text-right">{row.stationPoints[1] ?? '—'}</td><td className="p-3 text-right font-bold text-violet-200">{row.total ?? '—'}</td></tr>)}</tbody></table></div>}
    </>}
  </section>;
}

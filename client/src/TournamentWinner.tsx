import { useEffect, useState } from 'react';
import { WinnerCelebration } from './WinnerCelebration';

type Winner = { id: string; name: string; fingerprint: string };
export function TournamentWinner({ tournamentId, revision }: { tournamentId: string; revision: number }) {
  const [winner, setWinner] = useState<Winner | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    let current = true;
    fetch(`/api/tournaments/${tournamentId}/winner`).then(response => { if (!response.ok) throw new Error('Unable to load winner'); return response.json() as Promise<{ winner: Winner | null }>; }).then(data => {
      if (!current) return;
      setWinner(data.winner);
      const key = `celebrated:${tournamentId}`;
      if (!data.winner) { sessionStorage.removeItem(key); setCelebrating(false); return; }
      if (sessionStorage.getItem(key) !== data.winner.fingerprint) { sessionStorage.setItem(key, data.winner.fingerprint); setCelebrating(true); }
    }).catch(() => { /* Keep the last known winner if the network is unavailable. */ });
    return () => { current = false; };
  }, [tournamentId, revision]);
  return <>
    {winner && <button type="button" className="mt-3 rounded-lg border border-amber-400 bg-amber-950 px-4 py-2 font-bold text-amber-200" onClick={() => setCelebrating(true)}>Tournament winner: {winner.name}</button>}
    {winner && celebrating && <WinnerCelebration winner={winner.name} onClose={() => setCelebrating(false)} />}
  </>;
}

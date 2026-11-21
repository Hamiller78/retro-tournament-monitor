import { useState } from 'react';

type Props = { tournamentId: string; name: string; token: string; onError: (message: string) => void; onDeleted: () => void };
export function DeleteTournament({ tournamentId, name, token, onError, onDeleted }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true); onError('');
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not delete the tournament.');
      onDeleted();
    } catch (error) { onError(error instanceof TypeError ? 'Could not connect to the server.' : (error as Error).message); setBusy(false); }
  }
  return <section className="mt-6 border-t border-slate-700 pt-4" aria-label="Delete tournament"><h3 className="font-semibold">Delete tournament</h3>
    {!confirming ? <button type="button" className="mt-3 rounded-lg border border-red-500 px-3 py-2 text-red-200" onClick={() => setConfirming(true)}>Delete tournament</button> : <div className="mt-3 rounded-lg border border-red-500 bg-red-950/50 p-4" role="group" aria-label="Confirm tournament deletion"><p>Delete <strong>{name}</strong> and its participants, stages and results?</p><p className="mt-2 text-sm text-slate-300">Downloaded and automatic backup files are kept.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} className="rounded-lg bg-red-700 px-3 py-2 font-semibold disabled:opacity-50" onClick={() => void remove()}>Confirm deletion</button><button type="button" disabled={busy} className="rounded-lg border border-slate-500 px-3 py-2 disabled:opacity-50" onClick={() => setConfirming(false)}>Cancel</button></div></div>}
  </section>;
}

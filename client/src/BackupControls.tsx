import { useState, type FormEvent } from 'react';

type Props = { onError: (message: string) => void; onRestored: (id: string) => void };
const input = 'w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white';
const button = 'rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white hover:bg-violet-500 disabled:opacity-50';
export function RestoreBackup({ onError, onRestored }: Props) {
  const [file, setFile] = useState<File | null>(null); const [pin, setPin] = useState(''); const [busy, setBusy] = useState(false);
  async function restore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; onError(''); if (!file) return;
    if (file.size > 900000) { onError('This backup is too large to restore.'); return; }
    setBusy(true);
    try {
      let backup: unknown;
      try { backup = JSON.parse(await file.text()); } catch { throw new Error('Choose a valid Retromania backup file.'); }
      const response = await fetch('/api/tournaments/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backup, pin }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not restore backup.');
      setPin(''); setFile(null); form.reset(); onRestored(data.id);
    } catch (error) { onError((error as Error).message); } finally { setBusy(false); }
  }
  return <form onSubmit={restore} className="space-y-3 border-t border-slate-700 pt-4"><h3 className="font-semibold">Restore backup</h3><p className="text-sm text-slate-400">Creates a separate tournament copy. Use the PIN from the backup.</p><label className="block text-sm">Backup file<input className={input} type="file" accept=".json,application/json" required onChange={event => setFile(event.target.files?.[0] ?? null)} /></label><label className="block text-sm">Backup PIN<input className={input} type="password" inputMode="numeric" pattern="[0-9]{4,12}" required value={pin} onChange={event => setPin(event.target.value)} /></label><button className={button} disabled={busy}>Restore copy</button></form>;
}
export function DownloadBackup({ tournamentId, token, onError }: { tournamentId: string; token: string; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true); onError('');
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/backup`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'Could not download backup.'); }
      const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'retromania-backup.json'; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { onError((error as Error).message); } finally { setBusy(false); }
  }
  return <div className="mt-6 border-t border-slate-700 pt-4"><h3 className="font-semibold">Backup</h3><p className="mt-1 text-sm text-slate-400">Save a copy of this tournament, including participants and results.</p><button type="button" className={`${button} mt-3`} disabled={busy} onClick={() => void download()}>Download backup</button></div>;
}

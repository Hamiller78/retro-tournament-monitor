import { useState, type ChangeEvent } from 'react';

export function TrophySetup({ tournamentId, token, hasImage, revision, onChange, onError }: { tournamentId: string; token: string; hasImage: boolean; revision: number; onChange: () => void; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2_000_000) { onError('Choose a PNG, JPEG or WebP image up to 2 MB.'); return; }
    setBusy(true); onError('');
    try {
      const image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read the image.')); reader.readAsDataURL(file); });
      const response = await fetch(`/api/tournaments/${tournamentId}/trophy`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ image }) });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not save the image.');
      onChange();
    } catch (error) { onError((error as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); onError('');
    try { const response = await fetch(`/api/tournaments/${tournamentId}/trophy`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error('Could not remove the image.'); onChange(); }
    catch (error) { onError((error as Error).message); } finally { setBusy(false); }
  }
  return <section className="mt-6 border-t border-slate-700 pt-4"><h3 className="font-semibold">Winner celebration image</h3><p className="mt-1 text-sm text-slate-400">Choose a trophy image for the winner dialog. PNG, JPEG or WebP, up to 2 MB. Included in backups.</p>{hasImage && <img src={`/api/tournaments/${tournamentId}/trophy?revision=${revision}`} alt="Current trophy" className="mt-3 max-h-32 max-w-full rounded object-contain" />}<label className="mt-3 block text-sm">{hasImage ? 'Replace image' : 'Choose image'}<input className="mt-2 block w-full text-sm" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => void choose(event)} /></label>{hasImage && <button type="button" className="mt-3 rounded-lg border border-slate-600 px-3 py-2 text-sm" disabled={busy} onClick={() => void remove()}>Remove image</button>}</section>;
}

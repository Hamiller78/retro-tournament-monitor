import { useEffect, useRef, useState } from 'react';
import type { Stage } from '../../shared/contracts';
import { useSound } from './Sound';

const colors = ['#7c3aed', '#be185d', '#0369a1', '#047857', '#b45309', '#4338ca', '#9f1239', '#0f766e'];
type Props = { stage: Stage; station: number; tournamentId: string; token: string; onError: (message: string) => void; onChange: () => void; displayOnly?: boolean; label?: string };
export function GameWheel({ stage, station, tournamentId, token, onError, onChange, displayOnly = false, label }: Props) {
  const heading = label ?? `Station ${station + 1}`;
  const games = stage.settings?.stations?.[station]?.games ?? [];
  const fixed = stage.settings?.stations?.[station]?.mode === 'fixed';
  const draw = stage.draws.find(item => item.station === station);
  const game = draw ? games[draw.gameIndex] : undefined;
  const initialRotation = draw && games.length ? (270 - (draw.gameIndex + 0.5) * 360 / games.length + 360) % 360 : 0;
  const [rotation, setRotation] = useState(initialRotation);
  const [spinning, setSpinning] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const wheelRef = useRef<HTMLDivElement>(null);
  const { tick, reveal } = useSound();
  const lastDraw = useRef(draw?.drawId);
  const angle = useRef(initialRotation);
  useEffect(() => () => { clearTimeout(timer.current); if (frame.current !== undefined) cancelAnimationFrame(frame.current); }, []);
  useEffect(() => {
    if (fixed) { lastDraw.current = draw?.drawId; setSpinning(false); return; }
    if (!draw || !games.length) { lastDraw.current = undefined; clearTimeout(timer.current); if (frame.current !== undefined) cancelAnimationFrame(frame.current); setSpinning(false); return; }
    if (draw.drawId === lastDraw.current) return;
    lastDraw.current = draw.drawId;
    const target = (270 - (draw.gameIndex + 0.5) * 360 / games.length + 360) % 360;
    const extra = (target - (angle.current % 360) + 360) % 360;
    let unwrapped = angle.current;
    let lastNormalized = ((unwrapped % 360) + 360) % 360;
    let lastSector = Math.floor((unwrapped - 270) / (360 / games.length));
    let lastTick = 0;
    angle.current += 360 * 5 + extra;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    clearTimeout(timer.current); if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    setSpinning(!reduced); setRotation(angle.current);
    if (reduced) { reveal(); return; }
    function followWheel(now: number) {
      if (!wheelRef.current) return;
      const matrix = new DOMMatrixReadOnly(getComputedStyle(wheelRef.current).transform);
      const normalized = (Math.atan2(matrix.b, matrix.a) * 180 / Math.PI + 360) % 360;
      const delta = (normalized - lastNormalized + 540) % 360 - 180;
      unwrapped += delta; lastNormalized = normalized;
      const sector = Math.floor((unwrapped - 270) / (360 / games.length));
      if (sector !== lastSector && now - lastTick >= 70) { tick(); lastTick = now; }
      lastSector = sector; frame.current = requestAnimationFrame(followWheel);
    }
    frame.current = requestAnimationFrame(followWheel);
    timer.current = setTimeout(() => { if (frame.current !== undefined) cancelAnimationFrame(frame.current); frame.current = undefined; setSpinning(false); reveal(); }, 3200);
  }, [draw?.drawId, draw?.gameIndex, games.length, fixed, tick, reveal]);
  async function action(actionName: string, body?: object) {
    setBusy(true); onError('');
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/stages/${stage.id}/stations/${station}/${actionName}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body ?? {}) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not update the game selection.');

      onChange();
    } catch (error) { onError((error as Error).message); } finally { setBusy(false); }
  }
  if (fixed) return <section aria-label={`${heading} game`} className="arcade-wheel-panel rounded-xl border border-slate-700 bg-slate-950 p-6"><h4 className="arcade-wheel-title text-lg font-bold">{heading}</h4><p className="mt-4 text-xl">{games[0]?.name ?? 'Add a fixed game in settings.'}</p></section>;
  const background = games.length ? `conic-gradient(${games.map((_, index) => `${colors[index % colors.length]} ${index * 100 / games.length}% ${(index + 1) * 100 / games.length}%`).join(', ')})` : '#334155';
  return <section aria-label={`${heading} wheel`} className="arcade-wheel-panel rounded-xl border border-slate-700 bg-slate-950 p-4">
    <h4 className="arcade-wheel-title text-lg font-bold">{heading}</h4>
    <div className="wheel-layout"><div className="wheel-shell mx-auto mt-4"><div className="wheel-pointer" aria-hidden="true"/><div ref={wheelRef} className={`wheel ${spinning ? 'wheel-spinning' : ''}`} style={{ background, transform: `rotate(${rotation}deg)` }} aria-hidden="true">{games.map((item, index) => <div className="wheel-label" key={`${index}-${item.name}`} style={{ transform: `translate(-100%, -50%) rotate(${(index + 0.5) * 360 / games.length - 270}deg)`, fontSize: `clamp(0.45rem, ${Math.max(0.9, Math.min(5.2, 65 / Math.max(item.name.length, 1), 70 / games.length))}cqw, 2.5rem)` }}><span>{item.name}</span></div>)}</div></div>
    <div className="wheel-info"><p className="wheel-result mt-4 min-h-8 text-center text-xl font-bold sm:text-2xl" aria-live="polite">{spinning ? 'Spinning…' : game ? `${draw?.confirmed ? 'Selected' : 'Drawn'}: ${game.name}` : games.length ? 'Ready to spin' : 'Add games to this station’s pool.'}</p>
    {draw?.confirmed && game && <section className="game-info mt-5 rounded-lg border border-violet-500 bg-slate-900 p-4 text-left" aria-label="Selected game information">
      <h5 className="game-info-heading font-bold text-cyan-200">ABOUT THE GAME</h5>
      {game.developer?.trim() || game.platform?.trim() || game.releaseYear || game.description?.trim() ? <>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-lg">
          {game.developer?.trim() && <><dt className="text-violet-300">Developer</dt><dd>{game.developer}</dd></>}
          {game.platform?.trim() && <><dt className="text-violet-300">Platform</dt><dd>{game.platform}</dd></>}
          {game.releaseYear && <><dt className="text-violet-300">Released</dt><dd>{game.releaseYear}</dd></>}
        </dl>
        {game.description?.trim() && <p className="game-description mt-3 whitespace-pre-wrap text-slate-100">{game.description}</p>}
      </> : <p className="mt-2 text-slate-400">No game information added yet.</p>}
    </section>}
    {!displayOnly && games.length > 0 && <p className="mt-1 text-center text-xs text-slate-400">Games: {games.map(g => g.name).join(', ')}</p>}
    {!displayOnly && <div className="wheel-controls mt-3 flex flex-wrap justify-center gap-2">{draw?.confirmed ? token && <button type="button" disabled={busy} onClick={() => void action('unlock')} className="rounded-lg border border-slate-600 px-3 py-2 text-sm disabled:opacity-50">Unlock game</button> : <><button type="button" disabled={busy || spinning || !games.length} onClick={() => void action('spin')} className="rounded-lg bg-violet-600 px-4 py-2 font-semibold disabled:opacity-50">{draw ? 'Spin again' : 'Spin'}</button>{draw && <button type="button" disabled={busy || spinning || !game} onClick={() => void action('confirm', { drawId: draw.drawId })} className="rounded-lg border border-emerald-600 px-3 py-2 disabled:opacity-50">Confirm game</button>}</>}</div>}</div></div>
  </section>;
}


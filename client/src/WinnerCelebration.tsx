import { useEffect, useRef } from 'react';

type Props = { winner: string; imageUrl?: string; onClose: () => void };
export function WinnerCelebration({ winner, imageUrl, onClose }: Props) {
  const button = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    button.current?.focus();
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') closeRef.current(); else if (event.key === 'Tab') { event.preventDefault(); button.current?.focus(); } }
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, []);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-6" role="dialog" aria-modal="true" aria-labelledby="winner-celebration-title">
    <div className="arcade-winner max-h-[90vh] overflow-y-auto w-full max-w-2xl rounded-3xl border-2 border-amber-300 bg-gradient-to-br from-violet-950 via-slate-900 to-fuchsia-950 p-8 text-center shadow-2xl sm:p-14">
      {imageUrl ? <img src={imageUrl} alt="Tournament trophy" className="mx-auto max-h-[25vh] max-w-full rounded-lg object-contain" /> : <p className="text-5xl" aria-hidden="true">🏆</p>}
      <p className="arcade-winner-kicker mt-4 text-sm font-bold tracking-[0.3em] text-amber-300">TOURNAMENT CHAMPION</p>
      <h2 id="winner-celebration-title" className="mt-4 text-3xl font-black text-white sm:text-5xl">We have a winner!</h2>
      <p className="mt-5 break-words text-4xl font-black text-violet-200 sm:text-6xl">{winner}</p>
      <p className="mt-5 text-xl text-slate-200">Congratulations!</p>
      <button ref={button} type="button" onClick={onClose} className="mt-8 rounded-xl bg-violet-500 px-6 py-3 text-lg font-bold text-white hover:bg-violet-400 focus:outline-2 focus:outline-offset-4 focus:outline-white">Continue</button>
    </div>
  </div>;
}


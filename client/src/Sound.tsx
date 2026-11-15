import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type SoundControls = { volume: number; ready: boolean; error: string; setVolume: (volume: number) => void; toggle: () => void; tick: () => void; reveal: () => void; ranking: () => void };
const SoundContext = createContext<SoundControls | null>(null);
const storageKey = 'retromania-sound-volume';
function initialVolume() {
  try { const saved = localStorage.getItem(storageKey); if (saved === null) return 0; const value = Number(saved); return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0; }
  catch { return 0; }
}
export function SoundProvider({ children }: { children: ReactNode }) {
  const [volume, setLevel] = useState(initialVolume);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const context = useRef<AudioContext | null>(null);
  const master = useRef<GainNode | null>(null);
  const level = useRef(volume); level.current = volume;
  const enabled = useRef(false);
  useEffect(() => () => { enabled.current = false; if (context.current) void context.current.close().catch(() => {}); }, []);
  function save(value: number) { try { localStorage.setItem(storageKey, String(value)); } catch { /* Sound still works for this session. */ } }
  function applyLevel(value: number) { if (master.current && context.current) master.current.gain.setTargetAtTime(value / 100, context.current.currentTime, 0.02); }
  function activate(value: number) {
    try {
      if (!context.current || context.current.state === 'closed') {
        const audio = new AudioContext(), gain = audio.createGain();
        gain.gain.value = value / 100; gain.connect(audio.destination);
        context.current = audio; master.current = gain;
      }
      const audio = context.current;
      applyLevel(value);
      void audio.resume().then(() => { if (context.current === audio && level.current > 0 && audio.state === 'running') { enabled.current = true; setReady(true); setError(''); } }).catch(() => { enabled.current = false; setReady(false); setError('Sound could not be enabled on this device.'); });
    } catch { enabled.current = false; setReady(false); setError('Sound is not available on this device.'); }
  }
  function setVolume(value: number) {
    const next = Math.max(0, Math.min(100, value));
    level.current = next; setLevel(next); save(next); applyLevel(next);
    if (next === 0) { enabled.current = false; setReady(false); setError(''); }
    else if (!enabled.current) activate(next);
  }
  function toggle() {
    if (ready && volume > 0) { setVolume(0); return; }
    const next = volume || 30; level.current = next; setLevel(next); save(next); activate(next);
  }
  const tone = useCallback((frequency: number, delay: number, duration: number, strength: number, type: OscillatorType = 'square') => {
    const audio = context.current, output = master.current;
    if (!enabled.current || !audio || !output || audio.state !== 'running' || level.current <= 0) return;
    try {
      const start = audio.currentTime + delay, oscillator = audio.createOscillator(), envelope = audio.createGain();
      oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, start);
      envelope.gain.setValueAtTime(0.0001, start); envelope.gain.exponentialRampToValueAtTime(strength, start + 0.008); envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(envelope); envelope.connect(output); oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
      oscillator.start(start); oscillator.stop(start + duration + 0.01);
    } catch { /* Audio must never interrupt tournament operation. */ }
  }, []);
  const tick = useCallback(() => tone(550, 0, 0.04, 0.09), [tone]);
  const reveal = useCallback(() => { tone(523, 0, 0.12, 0.1); tone(659, 0.11, 0.12, 0.1); tone(784, 0.22, 0.25, 0.1); }, [tone]);
  const ranking = useCallback(() => { tone(660, 0, 0.09, 0.08, 'triangle'); tone(880, 0.09, 0.15, 0.08, 'triangle'); }, [tone]);
  return <SoundContext.Provider value={{ volume, ready, error, setVolume, toggle, tick, reveal, ranking }}>{children}</SoundContext.Provider>;
}
export function useSound() { const value = useContext(SoundContext); if (!value) throw new Error('SoundProvider is missing'); return value; }
export function SoundControl() {
  const sound = useSound();
  return <section aria-label="Sound controls" className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-sm">
    <button type="button" className="rounded border border-violet-400 px-3 py-1 font-semibold hover:bg-violet-900" onClick={sound.toggle}>{sound.ready && sound.volume > 0 ? 'Mute sound' : 'Enable sound'}</button>
    <label className="flex items-center gap-2">Volume <input aria-label="Sound volume" type="range" min="0" max="100" step="5" value={sound.volume} onChange={event => sound.setVolume(Number(event.target.value))} /></label>
    <span>{sound.ready && sound.volume > 0 ? `${sound.volume}%` : 'Off'}</span>
    {sound.error && <span role="status" className="text-amber-300">{sound.error}</span>}
  </section>;
}

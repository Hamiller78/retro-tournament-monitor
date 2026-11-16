import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

type RankingRow = { participantId: string };
const emptyRows: RankingRow[] = [];

/** Animates existing table rows after React reorders them, without changing their data. */
export function useRankingAnimation<T extends RankingRow>(rows: T[] | undefined, signature: (row: T) => unknown): { tableBody: RefObject<HTMLTableSectionElement | null>; capture: () => void } {
  const tableBody = useRef<HTMLTableSectionElement>(null);
  const previousValues = useRef<Map<string, string> | null>(null);
  const previousPositions = useRef(new Map<string, number>());
  const motions = useRef(new Map<string, Animation>());
  const flashes = useRef(new Map<string, Animation>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const currentRows = rows ?? emptyRows;
  const capture = useCallback(() => {
    previousPositions.current = new Map(Array.from(tableBody.current?.querySelectorAll<HTMLTableRowElement>('tr[data-ranking-id]') ?? []).map(element => [element.dataset.rankingId!, element.getBoundingClientRect().top]));
  }, []);

  useLayoutEffect(() => {
    const elements = Array.from(tableBody.current?.querySelectorAll<HTMLTableRowElement>('tr[data-ranking-id]') ?? []);
    const values = new Map(currentRows.map(row => [row.participantId, JSON.stringify(signature(row as T))]));
    const previous = previousValues.current;
    if (previous && previous.size === values.size && Array.from(previous).every(([id, value], index) => currentRows[index]?.participantId === id && values.get(id) === value)) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const element of elements) {
      const id = element.dataset.rankingId!;
      const oldTop = previousPositions.current.get(id);
      motions.current.get(id)?.cancel(); motions.current.delete(id);
      const newTop = element.getBoundingClientRect().top;
      if (!reducedMotion && oldTop !== undefined && Math.abs(oldTop - newTop) > 1 && typeof element.animate === 'function') {
        const motion = element.animate([{ transform: `translateY(${oldTop - newTop}px)` }, { transform: 'translateY(0)' }], { duration: 650, easing: 'cubic-bezier(.2,.75,.25,1)' });
        motions.current.set(id, motion);
        motion.onfinish = () => { if (motions.current.get(id) === motion) motions.current.delete(id); };
      }
      if (previous?.has(id) && previous.get(id) !== values.get(id)) {
        flashes.current.get(id)?.cancel();
        clearTimeout(timers.current.get(id));
        element.dataset.rankingUpdated = 'true';
        if (!reducedMotion && typeof element.animate === 'function') {
          const flash = element.animate([
            { filter: 'brightness(1.8)' },
            { filter: 'brightness(1)' },
            { filter: 'brightness(1.45)' },
            { filter: 'brightness(1)' },
          ], { duration: 1500, easing: 'ease-out', fill: 'none' });
          flashes.current.set(id, flash);
        }
        timers.current.set(id, setTimeout(() => { delete element.dataset.rankingUpdated; timers.current.delete(id); flashes.current.delete(id); }, 1500));
      }
    }
    previousValues.current = values;
  }, [currentRows, signature]);

  useEffect(() => () => {
    motions.current.forEach(animation => animation.cancel());
    flashes.current.forEach(animation => animation.cancel());
    timers.current.forEach(timer => clearTimeout(timer));
    motions.current.clear(); flashes.current.clear(); timers.current.clear();
  }, []);
  return { tableBody, capture };
}

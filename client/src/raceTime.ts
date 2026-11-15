/** Convert a racing time such as 01:23.45 to the seconds stored by the server. */
export function parseRaceTime(input: string): number | null {
  const match = /^(\d+):([0-5]\d)(?:[.,](\d{1,6}))?$/.exec(input.trim());
  if (!match) return null;
  const seconds = Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] ?? '0'}`);
  return Number.isFinite(seconds) && seconds <= 1_000_000_000 ? seconds : null;
}

/** Display stored seconds as minutes and seconds, with up to six decimal places. */
export function formatRaceTime(seconds: number): string {
  const units = Math.round(seconds * 1_000_000);
  const minutes = Math.floor(units / 60_000_000);
  const remainder = units % 60_000_000;
  const wholeSeconds = Math.floor(remainder / 1_000_000);
  const fraction = String(remainder % 1_000_000).padStart(6, '0').replace(/0+$/, '');
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}${fraction ? `.${fraction}` : ''}`;
}

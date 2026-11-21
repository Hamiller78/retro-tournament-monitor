import type { Stage } from '../../shared/contracts';

export function stageGameWheel(stage: Stage): Stage | null {
  const settings = stage.settings;
  if (settings?.gameSelection !== 'pool' || stage.kind === 'two-station') return null;
  const names = settings.gameSelection === 'pool' ? settings.gamePool ?? [] : settings.game ? [settings.game] : [];
  return { ...stage, settings: { ...settings, stations: [{ mode: settings.gameSelection, games: names.map(game => ({ ...(typeof game === 'string' ? { name: game } : game), resultKind: 'score', higherIsBetter: true, attempts: 1 })) }] } };
}

export interface ServerStatus { status: 'ok' }
export interface Participant { id: string; displayName: string; realName?: string; withdrawn?: boolean }
export type StageKind = 'two-station' | 'elimination' | 'duel' | 'tie-breaker';
export interface StationDraw { station: number; drawId: string; gameIndex: number; confirmed: boolean }
export interface Stage { id: string; name: string; kind: StageKind; participantCount: number | null; settings: StageSettings | null; draws: StationDraw[]; status: 'pending' | 'active' | 'closed'; entrants: { id: string; displayName: string }[] }
export interface Tournament { id: string; name: string; isAdmin: boolean; stages: Stage[]; participants: Participant[] }
export interface TournamentSummary { id: string; name: string }
export type ResultKind = 'score' | 'time';
export interface GameSettings { name: string; resultKind: ResultKind; higherIsBetter: boolean; attempts: number; players?: 1 | 2 }
export interface StationSettings { games: GameSettings[] }
export interface StageSettings { stations?: StationSettings[]; points?: number[]; game?: string; bestOf?: 1 | 3 | 5 }

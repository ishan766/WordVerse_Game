import type { Guess } from './engine';

export const TOURNAMENT_ROUNDS = 6;
export type ArenaStatus = 'lobby' | 'playing' | 'round_results' | 'finished';
export type PlayerStatus = 'waiting' | 'ready' | 'active' | 'solved' | 'failed' | 'timedout';
export type ArenaSettings = { capacity: 2 | 3 | 4 | 5 | 6; duration: 90 | 180 | 300; difficulty: 'standard' | 'hard' };
export type ArenaPlayer = {
  id: string; name: string; host: boolean; connected: boolean; status: PlayerStatus;
  attempts: number; roundPoints: number; totalPoints: number; wordsSolved: number;
  totalGuesses: number; totalSolveMs: number; solveMs?: number;
  rank: number; tie: boolean;
};
export type ArenaRoundResult = {
  round: number; answer: string;
  players: { id: string; status: 'solved' | 'failed' | 'timedout'; guesses: number; solveMs?: number; points: number; totalPoints: number }[];
};
export type ArenaView = {
  code: string; status: ArenaStatus; settings: ArenaSettings; players: ArenaPlayer[];
  selfId: string; ownGuesses: Guess[]; serverNow: number; round: number; completedRounds: ArenaRoundResult[];
  startedAt?: number; deadline?: number; answer?: string; roundId?: string;
};
export type ArenaAction =
  | { type: 'create'; name: string; settings: ArenaSettings }
  | { type: 'join'; code: string; name: string }
  | { type: 'resume'; code: string; token: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'start' }
  | { type: 'guess'; word: string; sequence: number; roundId: string }
  | { type: 'next_round'; roundId: string }
  | { type: 'play_again' }
  | { type: 'leave' };
export type ArenaReply = { ok: true; view?: ArenaView; token?: string } | { ok: false; error: string };

export function arenaShareText(view: ArenaView, invite: string): string {
  if (view.status !== 'round_results' && view.status !== 'finished') return '';
  const ranking = [...view.players].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .map(p => `${p.rank}. ${p.name} · ${p.totalPoints} pts · ${p.wordsSolved}/${view.round} solved${p.tie ? ' · tie' : ''}`).join('\n');
  return `WORDVERSE ARENA · ${view.status === 'finished' ? 'TOURNAMENT COMPLETE' : `ROUND ${view.round}/${TOURNAMENT_ROUNDS}`}\n${ranking}\n${invite}`;
}

import type { Guess } from './engine';

export type ArenaStatus = 'lobby' | 'playing' | 'finished';
export type PlayerStatus = 'waiting' | 'ready' | 'active' | 'solved' | 'failed' | 'timedout';
export type ArenaSettings = { capacity: 2 | 3 | 4; duration: 90 | 180 | 300; difficulty: 'standard' | 'hard' };
export type ArenaPlayer = { id: string; name: string; host: boolean; connected: boolean; status: PlayerStatus; attempts: number; rank?: number; points?: number; solvedAt?: number; progress?: number; tie?: boolean };
export type ArenaView = {
  code: string; status: ArenaStatus; settings: ArenaSettings; players: ArenaPlayer[];
  selfId: string; ownGuesses: Guess[]; serverNow: number; startedAt?: number; deadline?: number;
  answer?: string; roundId?: string;
};
export type ArenaAction =
  | { type: 'create'; name: string; settings: ArenaSettings }
  | { type: 'join'; code: string; name: string }
  | { type: 'resume'; code: string; token: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'start' }
  | { type: 'guess'; word: string; sequence: number }
  | { type: 'rematch' }
  | { type: 'leave' };
export type ArenaReply = { ok: true; view?: ArenaView; token?: string } | { ok: false; error: string };

export function arenaShareText(view: ArenaView, invite: string): string {
  if (view.status !== 'finished') return '';
  const ranking = [...view.players].sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9))
    .map(p => `${p.rank}. ${p.name} · ${p.status === 'solved' ? `${p.attempts}/6` : 'unsolved'} · ${p.points} pts`).join('\n');
  return `WORDVERSE ARENA ${view.code}\n${ranking}\n${invite}`;
}

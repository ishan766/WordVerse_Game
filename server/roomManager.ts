import { randomBytes, randomInt } from 'node:crypto';
import { DAILY_WORDS_V1, VALID_WORDS } from '../src/words';
import { evaluateGuess, hardModeError, MAX_GUESSES, type Guess } from '../src/engine';
import { TOURNAMENT_ROUNDS, type ArenaAction, type ArenaPlayer, type ArenaReply, type ArenaRoundResult, type ArenaSettings, type ArenaStatus, type ArenaView, type PlayerStatus } from '../src/arenaProtocol';

type Player = {
  id: string; token: string; name: string; connected: boolean; disconnectedAt?: number;
  ready: boolean; host: boolean; guesses: Guess[]; status: PlayerStatus;
  solvedAt?: number; lastAction: number; sequence: number;
  roundPoints: number; totalPoints: number; wordsSolved: number; totalGuesses: number; totalSolveMs: number;
};
type Room = {
  code: string; settings: ArenaSettings; players: Player[]; status: ArenaStatus;
  round: number; answer?: string; startedAt?: number; deadline?: number; roundId?: string;
  usedAnswers: string[]; completedRounds: ArenaRoundResult[]; updatedAt: number;
};
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,17}$/u;
const ok = (view?: ArenaView, token?: string): ArenaReply => ({ ok: true, view, token });
const fail = (error: string): ArenaReply => ({ ok: false, error });
const settingsValid = (s: ArenaSettings) => !!s && typeof s === 'object' && [2, 3, 4, 5, 6].includes(s.capacity) && [90, 180, 300].includes(s.duration) && ['standard', 'hard'].includes(s.difficulty);

// A first-guess solve has five unused guesses, so the attainable maximum is 200.
export function roundScore(guesses: number, solvedAt: number, startedAt: number, durationSeconds: number): number {
  if (!Number.isInteger(guesses) || guesses < 1 || guesses > MAX_GUESSES) return 0;
  const elapsed = Math.max(0, solvedAt - startedAt);
  const remainingFraction = Math.max(0, Math.min(1, 1 - elapsed / (durationSeconds * 1000)));
  return 100 + Math.floor(50 * remainingFraction) + 10 * (MAX_GUESSES - guesses);
}

function comparePlayers(a: Player, b: Player): number {
  return b.totalPoints - a.totalPoints || b.wordsSolved - a.wordsSolved || a.totalGuesses - b.totalGuesses || a.totalSolveMs - b.totalSolveMs;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  constructor(
    private now = () => Date.now(),
    private chooseAnswer = (used: readonly string[]) => {
      const pool = DAILY_WORDS_V1.filter(word => !used.includes(word.toUpperCase()));
      return (pool.length ? pool : DAILY_WORDS_V1)[randomInt((pool.length ? pool : DAILY_WORDS_V1).length)].toUpperCase();
    },
  ) {}
  private code() { let code = ''; for (let i = 0; i < 7; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)]; return code; }
  private token() { return randomBytes(32).toString('base64url'); }
  private player(name: string, host: boolean): Player {
    return { id: this.token().slice(0, 12), token: this.token(), name: name.trim(), connected: true,
      ready: host, host, guesses: [], status: host ? 'ready' : 'waiting', lastAction: -Infinity,
      sequence: 0, roundPoints: 0, totalPoints: 0, wordsSolved: 0, totalGuesses: 0, totalSolveMs: 0 };
  }
  private standings(room: Room): ArenaPlayer[] {
    const sorted = [...room.players].sort(comparePlayers);
    return room.players.map(p => {
      const place = sorted.indexOf(p);
      let first = place;
      while (first > 0 && comparePlayers(sorted[first - 1], p) === 0) first--;
      const tie = sorted.some(other => other !== p && comparePlayers(other, p) === 0);
      return { id: p.id, name: p.name, host: p.host, connected: p.connected, status: p.status,
        attempts: p.guesses.length, roundPoints: p.roundPoints, totalPoints: p.totalPoints,
        wordsSolved: p.wordsSolved, totalGuesses: p.totalGuesses, totalSolveMs: p.totalSolveMs,
        ...(p.solvedAt !== undefined && room.startedAt !== undefined ? { solveMs: p.solvedAt - room.startedAt } : {}),
        rank: first + 1, tie };
    });
  }
  private view(room: Room, self: Player): ArenaView {
    const resolved = room.status === 'round_results' || room.status === 'finished';
    return { code: room.code, status: room.status, settings: room.settings, players: this.standings(room),
      selfId: self.id, ownGuesses: self.guesses, serverNow: this.now(), round: room.round,
      completedRounds: room.completedRounds,
      startedAt: room.startedAt, deadline: room.deadline, roundId: room.roundId,
      ...(resolved ? { answer: room.answer } : {}) };
  }
  viewFor(code: string, id: string): ArenaView | undefined {
    const room = this.rooms.get(code), player = room?.players.find(p => p.id === id);
    return room && player ? this.view(room, player) : undefined;
  }
  private transferHost(room: Room) {
    if (room.players.some(p => p.host && p.connected)) return;
    const next = room.players.find(p => p.connected);
    if (next) for (const p of room.players) { p.host = p === next; if (p.host && room.status === 'lobby') { p.ready = true; p.status = 'ready'; } }
  }
  private startRound(room: Room) {
    if (room.round >= TOURNAMENT_ROUNDS) throw Error('Tournament already complete');
    let answer = this.chooseAnswer(room.usedAnswers).toUpperCase();
    // A tournament never repeats a target, including when a custom selector does.
    if (room.usedAnswers.includes(answer)) {
      const unused = DAILY_WORDS_V1.find(word => !room.usedAnswers.includes(word.toUpperCase()));
      if (!unused) throw Error('Arena answer pool exhausted');
      answer = unused.toUpperCase();
    }
    if (!/^[A-Z]{5}$/.test(answer) || !VALID_WORDS.has(answer.toLowerCase())) throw Error('Invalid Arena answer');
    room.round++;
    room.status = 'playing'; room.answer = answer; room.usedAnswers.push(answer);
    room.startedAt = this.now(); room.deadline = room.startedAt + room.settings.duration * 1000;
    room.roundId = this.token().slice(0, 12); room.updatedAt = this.now();
    for (const p of room.players) {
      p.guesses = []; p.status = 'active'; p.solvedAt = undefined; p.sequence = 0;
      p.lastAction = -Infinity; p.roundPoints = 0;
    }
  }
  private finishRound(room: Room) {
    if (room.status !== 'playing') return;
    room.status = room.round === TOURNAMENT_ROUNDS ? 'finished' : 'round_results';
    room.updatedAt = this.now();
    for (const p of room.players) if (p.status === 'active') p.status = 'timedout';
    room.completedRounds.push({ round: room.round, answer: room.answer!, players: room.players.map(p => ({
      id: p.id, status: p.status as 'solved' | 'failed' | 'timedout', guesses: p.guesses.length,
      ...(p.solvedAt !== undefined ? { solveMs: p.solvedAt - room.startedAt! } : {}),
      points: p.roundPoints, totalPoints: p.totalPoints,
    })) });
    this.transferHost(room);
  }
  tick(): string[] {
    const changed: string[] = [];
    for (const [code, room] of this.rooms) {
      if (room.status === 'playing' && this.now() >= room.deadline!) { this.finishRound(room); changed.push(code); }
      if (this.now() - room.updatedAt > (room.status === 'lobby' ? 30 * 60_000 : 2 * 60 * 60_000)) { this.rooms.delete(code); continue; }
      if (room.status === 'lobby') {
        const previous = room.players.length;
        room.players = room.players.filter(p => p.connected || !p.disconnectedAt || this.now() - p.disconnectedAt < 2 * 60_000);
        if (!room.players.length) { this.rooms.delete(code); continue; }
        if (room.players.length !== previous) { this.transferHost(room); changed.push(code); }
      }
    }
    return changed;
  }
  disconnect(code: string, id: string) {
    const room = this.rooms.get(code), p = room?.players.find(x => x.id === id);
    if (room && p) { p.connected = false; p.disconnectedAt = this.now(); room.updatedAt = this.now(); this.transferHost(room); }
  }
  act(action: ArenaAction, context?: { code: string; id: string }): ArenaReply {
    this.tick();
    if (action.type === 'create') {
      if (typeof action.name !== 'string' || !NAME.test(action.name.trim())) return fail('Enter a name of 1–18 letters, numbers or simple punctuation.');
      if (!settingsValid(action.settings)) return fail('Choose valid room settings.');
      let code = this.code(); while (this.rooms.has(code)) code = this.code();
      const p = this.player(action.name, true);
      const room: Room = { code, settings: { ...action.settings }, players: [p], status: 'lobby', round: 0, usedAnswers: [], completedRounds: [], updatedAt: this.now() };
      this.rooms.set(code, room); return ok(this.view(room, p), p.token);
    }
    if (action.type === 'join' || action.type === 'resume') {
      const code = typeof action.code === 'string' ? action.code.toUpperCase().trim() : '';
      if (!/^[A-HJ-NP-Z2-9]{7}$/.test(code)) return fail('Enter a valid seven-character room code.');
      const room = this.rooms.get(code); if (!room) return fail('Room not found or expired.');
      if (action.type === 'resume') {
        const p = room.players.find(x => typeof action.token === 'string' && x.token === action.token && action.token.length >= 32);
        if (!p) return fail('This reconnect link has expired.');
        p.connected = true; p.disconnectedAt = undefined; room.updatedAt = this.now(); return ok(this.view(room, p), p.token);
      }
      if (typeof action.name !== 'string' || !NAME.test(action.name.trim())) return fail('Enter a name of 1–18 letters, numbers or simple punctuation.');
      if (room.status !== 'lobby') return fail('This tournament has already started.');
      if (room.players.length >= room.settings.capacity) return fail('This room is full.');
      if (room.players.some(p => p.name.toLocaleLowerCase() === action.name.trim().toLocaleLowerCase())) return fail('That name is already in this room. Reconnect with your saved session.');
      const p = this.player(action.name, false); room.players.push(p); room.updatedAt = this.now(); return ok(this.view(room, p), p.token);
    }
    const room = context && this.rooms.get(context.code), p = room?.players.find(x => x.id === context?.id);
    if (!room || !p) return fail('Join a room first.');
    if (action.type === 'leave') {
      if (room.status === 'lobby') {
        room.players = room.players.filter(x => x !== p);
        if (!room.players.length) this.rooms.delete(room.code); else this.transferHost(room);
      } else { p.connected = false; p.disconnectedAt = this.now(); this.transferHost(room); }
      room.updatedAt = this.now(); return ok();
    }
    if (action.type === 'ready') {
      if (room.status !== 'lobby') return fail('The lobby is closed.');
      if (typeof action.ready !== 'boolean') return fail('Invalid ready status.');
      p.ready = action.ready; p.status = p.ready ? 'ready' : 'waiting'; room.updatedAt = this.now(); return ok(this.view(room, p));
    }
    if (action.type === 'start') {
      if (!p.host) return fail('Only the host can start a tournament.');
      if (room.status !== 'lobby') return fail('The tournament has already started.');
      if (room.players.length !== room.settings.capacity || room.players.some(x => !x.connected || !x.ready)) return fail(`All ${room.settings.capacity} players must be connected and ready.`);
      this.startRound(room); return ok(this.view(room, p));
    }
    if (action.type === 'next_round') {
      if (!p.host) return fail('Only the host can start the next round.');
      if (room.status !== 'round_results' || room.round >= TOURNAMENT_ROUNDS) return fail('The next round is not available.');
      if (action.roundId !== room.roundId) return fail('Stale round request.');
      this.startRound(room); return ok(this.view(room, p));
    }
    if (action.type === 'play_again') {
      if (!p.host) return fail('Only the host can start a new tournament.');
      if (room.status !== 'finished') return fail('Finish the tournament first.');
      room.players = room.players.filter(x => x.connected);
      room.status = 'lobby'; room.round = 0; room.answer = undefined; room.startedAt = undefined;
      room.deadline = undefined; room.roundId = undefined; room.usedAnswers = []; room.completedRounds = []; room.updatedAt = this.now();
      for (const x of room.players) {
        x.guesses = []; x.status = x.host ? 'ready' : 'waiting'; x.ready = x.host;
        x.solvedAt = undefined; x.sequence = 0; x.lastAction = -Infinity;
        x.roundPoints = 0; x.totalPoints = 0; x.wordsSolved = 0; x.totalGuesses = 0; x.totalSolveMs = 0;
      }
      return ok(this.view(room, p));
    }
    if (action.type === 'guess') {
      if (room.status !== 'playing' || this.now() >= room.deadline!) { this.tick(); return fail('The round has ended.'); }
      if (action.roundId !== room.roundId) return fail('Stale round request.');
      if (p.status !== 'active') return fail('Your board is already complete.');
      const word = typeof action.word === 'string' ? action.word.toUpperCase() : '';
      if (!/^[A-Z]{5}$/.test(word)) return fail('Enter a five-letter word.');
      if (!Number.isSafeInteger(action.sequence) || action.sequence !== p.sequence + 1) return fail('Stale or duplicate guess. Refresh your room state.');
      if (this.now() - p.lastAction < 250) return fail('Please wait a moment between guesses.');
      if (!VALID_WORDS.has(word.toLowerCase())) return fail('That word is not in our dictionary.');
      if (room.settings.difficulty === 'hard') { const error = hardModeError(p.guesses, word); if (error) return fail(error); }
      p.lastAction = this.now(); p.sequence++; p.totalGuesses++;
      p.guesses.push({ word, marks: evaluateGuess(room.answer!, word) });
      if (word === room.answer) {
        p.status = 'solved'; p.solvedAt = this.now(); p.wordsSolved++;
        p.roundPoints = roundScore(p.guesses.length, p.solvedAt, room.startedAt!, room.settings.duration);
        p.totalPoints += p.roundPoints;
      } else if (p.guesses.length === MAX_GUESSES) p.status = 'failed';
      room.updatedAt = this.now();
      if (room.players.every(x => x.status !== 'active')) this.finishRound(room);
      return ok(this.view(room, p));
    }
    return fail('Unknown action.');
  }
}

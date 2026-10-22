import { randomBytes, randomInt } from 'node:crypto';
import { DAILY_WORDS_V1, VALID_WORDS } from '../src/words';
import { evaluateGuess, hardModeError, MAX_GUESSES, type Guess } from '../src/engine';
import type { ArenaAction, ArenaPlayer, ArenaReply, ArenaSettings, ArenaView, PlayerStatus } from '../src/arenaProtocol';

type Player = { id: string; token: string; name: string; connected: boolean; disconnectedAt?: number; ready: boolean; host: boolean; guesses: Guess[]; status: PlayerStatus; solvedAt?: number; lastAction: number; sequence: number; lastWord?: string; rank?: number; points?: number; tie?: boolean };
type Room = { code: string; settings: ArenaSettings; players: Player[]; status: 'lobby' | 'playing' | 'finished'; answer?: string; startedAt?: number; deadline?: number; roundId?: string; updatedAt: number };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ok = (view?: ArenaView, token?: string): ArenaReply => ({ ok: true, view, token });
const fail = (error: string): ArenaReply => ({ ok: false, error });
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,17}$/u;
const settingsValid = (s: ArenaSettings) => !!s && typeof s === 'object' && [2, 3, 4].includes(s.capacity) && [90, 180, 300].includes(s.duration) && ['standard', 'hard'].includes(s.difficulty);

export class RoomManager {
  private rooms = new Map<string, Room>();
  constructor(private now = () => Date.now(), private chooseAnswer = () => DAILY_WORDS_V1[randomInt(DAILY_WORDS_V1.length)].toUpperCase()) {}
  private code() { let code = ''; for (let i = 0; i < 7; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)]; return code; }
  private token() { return randomBytes(32).toString('base64url'); }
  private player(name: string, host: boolean): Player { return { id: this.token().slice(0, 12), token: this.token(), name: name.trim(), connected: true, ready: host, host, guesses: [], status: host ? 'ready' : 'waiting', lastAction: -Infinity, sequence: 0 }; }
  private view(room: Room, self: Player): ArenaView {
    const finished = room.status === 'finished';
    return { code: room.code, status: room.status, settings: room.settings, selfId: self.id,
      players: room.players.map(p => ({ id: p.id, name: p.name, host: p.host, connected: p.connected, status: p.status, attempts: p.guesses.length,
        ...(finished ? { rank: p.rank, points: p.points, solvedAt: p.solvedAt, progress: this.progress(p), tie: p.tie } : {}) })),
      ownGuesses: self.guesses, serverNow: this.now(), startedAt: room.startedAt, deadline: room.deadline,
      ...(finished ? { answer: room.answer, roundId: room.roundId } : {}) };
  }
  viewFor(code: string, id: string): ArenaView | undefined { const room = this.rooms.get(code); const player = room?.players.find(p => p.id === id); return room && player ? this.view(room, player) : undefined; }
  participants(code: string): string[] { return this.rooms.get(code)?.players.map(p => p.id) ?? []; }
  private progress(p: Player) { return Math.max(0, ...p.guesses.map(g => g.marks.reduce((n, m) => n + (m === 'correct' ? 2 : m === 'present' ? 1 : 0), 0))); }
  private finish(room: Room) {
    if (room.status !== 'playing') return;
    room.status = 'finished'; room.updatedAt = this.now();
    for (const p of room.players) if (p.status === 'active') p.status = 'timedout';
    const sorted = [...room.players].sort((a, b) => {
      if ((a.status === 'solved') !== (b.status === 'solved')) return a.status === 'solved' ? -1 : 1;
      if (a.status === 'solved') return a.guesses.length - b.guesses.length || (a.solvedAt! - b.solvedAt!);
      return this.progress(b) - this.progress(a);
    });
    sorted.forEach((p, i) => {
      const previous = sorted[i - 1];
      const tie = previous && (p.status === 'solved') === (previous.status === 'solved') && (p.status === 'solved'
        ? p.guesses.length === previous.guesses.length && p.solvedAt === previous.solvedAt
        : this.progress(p) === this.progress(previous));
      p.rank = tie ? previous.rank : i + 1;
      p.points = p.status === 'solved' ? Math.max(20, 120 - (p.guesses.length - 1) * 15 - (p.rank! - 1) * 10) : 0;
    });
    for (const p of sorted) p.tie = sorted.some(other => other !== p && other.rank === p.rank);
    if (!room.players.some(p => p.host && p.connected)) {
      const next = room.players.find(p => p.connected);
      if (next) { for (const p of room.players) p.host = p === next; }
    }
  }
  tick(): string[] {
    const changed: string[] = [];
    for (const [code, room] of this.rooms) {
      if (this.now() - room.updatedAt > (room.status === 'lobby' ? 30 * 60_000 : 2 * 60 * 60_000)) { this.rooms.delete(code); continue; }
      if (room.status === 'lobby') {
        const previous = room.players.length;
        const oldHost = room.players.find(p => p.host);
        room.players = room.players.filter(p => p.connected || !p.disconnectedAt || this.now() - p.disconnectedAt < 2 * 60_000);
        if (!room.players.length) { this.rooms.delete(code); continue; }
        if (oldHost && !room.players.includes(oldHost)) { room.players[0].host = true; room.players[0].ready = true; room.players[0].status = 'ready'; }
        if (room.players.length !== previous) changed.push(code);
      }
      if (room.status === 'playing' && this.now() >= room.deadline!) { this.finish(room); changed.push(code); }
    }
    return changed;
  }
  disconnect(code: string, id: string) { const room = this.rooms.get(code), p = room?.players.find(x => x.id === id); if (room && p) { p.connected = false; p.disconnectedAt = this.now(); room.updatedAt = this.now(); } }
  act(action: ArenaAction, context?: { code: string; id: string }): ArenaReply {
    this.tick();
    if (action.type === 'create') {
      if (typeof action.name !== 'string' || !NAME.test(action.name.trim())) return fail('Enter a name of 1–18 letters, numbers or simple punctuation.');
      if (!settingsValid(action.settings)) return fail('Choose valid room settings.');
      let code = this.code(); while (this.rooms.has(code)) code = this.code();
      const p = this.player(action.name, true);
      const room: Room = { code, settings: action.settings, players: [p], status: 'lobby', updatedAt: this.now() };
      this.rooms.set(code, room); return ok(this.view(room, p), p.token);
    }
    if (action.type === 'join' || action.type === 'resume') {
      const code = typeof action.code === 'string' ? action.code.toUpperCase().trim() : '';
      if (!/^[A-HJ-NP-Z2-9]{7}$/.test(code ?? '')) return fail('Enter a valid seven-character room code.');
      const room = this.rooms.get(code); if (!room) return fail('Room not found or expired.');
      if (action.type === 'resume') {
        const p = room.players.find(x => typeof action.token === 'string' && x.token === action.token && action.token.length >= 32);
        if (!p) return fail('This reconnect link has expired.');
        p.connected = true; p.disconnectedAt = undefined; room.updatedAt = this.now(); return ok(this.view(room, p), p.token);
      }
      if (typeof action.name !== 'string' || !NAME.test(action.name.trim())) return fail('Enter a name of 1–18 letters, numbers or simple punctuation.');
      if (room.status !== 'lobby') return fail('This match has already started.');
      if (room.players.length >= room.settings.capacity) return fail('This room is full.');
      const p = this.player(action.name, false); room.players.push(p); room.updatedAt = this.now(); return ok(this.view(room, p), p.token);
    }
    const room = context && this.rooms.get(context.code), p = room?.players.find(x => x.id === context?.id);
    if (!room || !p) return fail('Join a room first.');
    room.updatedAt = this.now();
    if (action.type === 'leave') {
      if (room.status === 'lobby') {
        room.players = room.players.filter(x => x !== p);
        if (!room.players.length) this.rooms.delete(room.code);
        else if (p.host) { room.players[0].host = true; room.players[0].ready = true; room.players[0].status = 'ready'; }
      } else {
        p.connected = false; p.disconnectedAt = this.now();
        if (p.host) { const next = room.players.find(x => x !== p && x.connected); if (next) { p.host = false; next.host = true; } }
      }
      return ok();
    }
    if (action.type === 'ready') {
      if (room.status !== 'lobby') return fail('The lobby is closed.');
      if (typeof action.ready !== 'boolean') return fail('Invalid ready status.');
      p.ready = action.ready; p.status = p.ready ? 'ready' : 'waiting'; return ok(this.view(room, p));
    }
    if (action.type === 'start' || action.type === 'rematch') {
      if (!p.host) return fail('Only the host can start a match.');
      if (action.type === 'start' && room.status !== 'lobby') return fail('The match has already started.');
      if (action.type === 'rematch' && room.status !== 'finished') return fail('Finish this round first.');
      if (room.players.length < 2 || room.players.some(x => !x.connected || !x.ready)) return fail('At least two connected players must be ready.');
      room.status = 'playing'; room.answer = this.chooseAnswer(); room.startedAt = this.now(); room.deadline = room.startedAt + room.settings.duration * 1000; room.roundId = this.token().slice(0, 12);
      for (const x of room.players) { x.guesses = []; x.status = 'active'; x.solvedAt = undefined; x.sequence = 0; x.lastAction = -Infinity; x.lastWord = undefined; x.rank = undefined; x.points = undefined; x.tie = undefined; }
      return ok(this.view(room, p));
    }
    if (action.type === 'guess') {
      if (room.status !== 'playing' || this.now() >= room.deadline!) { this.tick(); return fail('The round has ended.'); }
      if (p.status !== 'active') return fail('Your board is already complete.');
      const word = typeof action.word === 'string' ? action.word.toUpperCase() : '';
      if (!/^[A-Z]{5}$/.test(word ?? '')) return fail('Enter a five-letter word.');
      if (!Number.isSafeInteger(action.sequence) || action.sequence !== p.sequence + 1) return fail('Stale or duplicate guess. Refresh your room state.');
      if (this.now() - p.lastAction < 250) return fail('Please wait a moment between guesses.');
      if (!VALID_WORDS.has(word.toLowerCase())) return fail('That word is not in our dictionary.');
      if (room.settings.difficulty === 'hard') { const error = hardModeError(p.guesses, word); if (error) return fail(error); }
      p.lastAction = this.now(); p.sequence++; p.lastWord = word;
      p.guesses.push({ word, marks: evaluateGuess(room.answer!, word) });
      if (word === room.answer) { p.status = 'solved'; p.solvedAt = this.now(); }
      else if (p.guesses.length === MAX_GUESSES) p.status = 'failed';
      if (room.players.every(x => x.status !== 'active')) this.finish(room);
      return ok(this.view(room, p));
    }
    return fail('Unknown action.');
  }
}

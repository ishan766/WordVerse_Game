import { describe, expect, it } from 'vitest';
import { RoomManager, roundScore } from './roomManager';
import type { ArenaSettings } from '../src/arenaProtocol';

type Context = { code: string; id: string };
function setup(answers = ['APPLE', 'BRAVE', 'CRANE', 'DELTA', 'EAGLE']) {
  let now = 1000;
  const manager = new RoomManager(() => now, used => answers[used.length] ?? answers[0]);
  const advance = (ms = 300) => { now += ms; };
  const create = (capacity: ArenaSettings['capacity'] = 2, difficulty: ArenaSettings['difficulty'] = 'standard') => {
    const result = manager.act({ type: 'create', name: 'Host', settings: { capacity, duration: 90, difficulty } });
    if (!result.ok || !result.view || !result.token) throw Error('create failed');
    return { code: result.view.code, host: { code: result.view.code, id: result.view.selfId }, token: result.token };
  };
  const join = (code: string, name: string) => {
    const result = manager.act({ type: 'join', code, name });
    if (!result.ok || !result.view || !result.token) throw Error('join failed');
    return { context: { code, id: result.view.selfId }, token: result.token };
  };
  const current = (context: Context) => { const view = manager.viewFor(context.code, context.id); if (!view) throw Error('room missing'); return view; };
  const guess = (context: Context, word: string, sequence: number, roundId = current(context).roundId!) => manager.act({ type: 'guess', word, sequence, roundId }, context);
  return { manager, advance, create, join, current, guess };
}

describe('Arena tournament authority', () => {
  it.each([2, 3, 4, 5, 6] as const)('requires exactly %i ready players and enforces capacity', capacity => {
    const { manager, create, join, current } = setup();
    const { code, host } = create(capacity);
    expect(manager.act({ type: 'start' }, host)).toMatchObject({ ok: false });
    const guests = Array.from({ length: capacity - 1 }, (_, i) => join(code, `Guest${i}`));
    expect(manager.act({ type: 'join', code, name: 'Extra' })).toMatchObject({ ok: false, error: 'This room is full.' });
    expect(manager.act({ type: 'start' }, host).ok).toBe(false);
    guests.forEach(guest => expect(manager.act({ type: 'ready', ready: true }, guest.context).ok).toBe(true));
    const started = manager.act({ type: 'start' }, host);
    expect(started.ok && started.view?.round).toBe(1);
    expect(current(host).players).toHaveLength(capacity);
    expect(current(host).answer).toBeUndefined();
    expect(manager.act({ type: 'join', code, name: 'Late' }).ok).toBe(false);
  });

  it('validates codes and names, blocks duplicate seats, and enforces host permissions', () => {
    const { manager, create, join } = setup();
    expect(manager.act({ type: 'join', code: 'bad', name: 'A' }).ok).toBe(false);
    expect(manager.act({ type: 'create', name: '<script>', settings: { capacity: 2, duration: 90, difficulty: 'standard' } }).ok).toBe(false);
    const { code, host } = create(3);
    const guest = join(code, 'Guest');
    expect(manager.act({ type: 'join', code, name: 'guest' })).toMatchObject({ ok: false, error: expect.stringContaining('already') });
    expect(manager.act({ type: 'start' }, guest.context)).toMatchObject({ ok: false, error: 'Only the host can start a tournament.' });
    expect(manager.act({ type: 'ready', ready: true }, guest.context).ok).toBe(true);
    expect(manager.act({ type: 'start' }, host).ok).toBe(false);
    expect(manager.act({ type: 'resume', code, token: 'wrong' }).ok).toBe(false);
  });

  it('scores a solve once, keeps guesses private, and rejects stale round actions', () => {
    const { manager, create, join, current, guess, advance } = setup();
    const { code, host } = create(), guest = join(code, 'Guest');
    manager.act({ type: 'ready', ready: true }, guest.context);
    manager.act({ type: 'start' }, host);
    const roundId = current(host).roundId!;
    expect(guess(host, 'XXXXX', 1).ok).toBe(false);
    expect(guess(host, 'CRANE', 1).ok).toBe(true);
    expect(current(guest.context).ownGuesses).toHaveLength(0);
    expect(guess(host, 'CRANE', 1).ok).toBe(false);
    expect(guess(host, 'APPLE', 2).ok).toBe(false); // Action throttle.
    advance();
    expect(guess(host, 'APPLE', 2).ok).toBe(true);
    const score = current(host).players.find(p => p.id === host.id)!;
    expect(score.roundPoints).toBe(roundScore(2, 1300, 1000, 90));
    expect(score.totalPoints).toBe(score.roundPoints);
    expect(score.wordsSolved).toBe(1);
    expect(guess(host, 'APPLE', 3).ok).toBe(false);
    expect(guess(guest.context, 'APPLE', 1, 'old-round-id').ok).toBe(false);
    expect(current(guest.context).answer).toBeUndefined();
    expect(guess(guest.context, 'APPLE', 1).ok).toBe(true);
    expect(current(host).status).toBe('round_results');
    expect(current(host).answer).toBe('APPLE');
    expect(manager.act({ type: 'next_round', roundId }, guest.context).ok).toBe(false);
    expect(manager.act({ type: 'next_round', roundId }, host).ok).toBe(true);
    expect(manager.act({ type: 'next_round', roundId }, host).ok).toBe(false);
    expect(guess(host, 'BRAVE', 1, roundId).ok).toBe(false);
    expect(current(host).players.find(p => p.id === host.id)?.totalPoints).toBe(score.totalPoints);
  });

  it('runs exactly five rounds, accumulates totals, and starts a clean new tournament', () => {
    const answers = ['APPLE', 'BRAVE', 'CRANE', 'DELTA', 'EAGLE'];
    const { manager, create, join, current, guess, advance } = setup(answers);
    const { code, host } = create(), guest = join(code, 'Guest');
    manager.act({ type: 'ready', ready: true }, guest.context);
    manager.act({ type: 'start' }, host);
    for (let round = 1; round <= 5; round++) {
      const view = current(host);
      expect(view.round).toBe(round);
      expect(view.status).toBe('playing');
      expect(view.answer).toBeUndefined();
      expect(guess(host, answers[round - 1], 1).ok).toBe(true);
      expect(guess(guest.context, 'ALBUM', 1).ok).toBe(true);
      advance();
      expect(guess(guest.context, answers[round - 1], 2).ok).toBe(true);
      const result = current(host);
      expect(result.status).toBe(round === 5 ? 'finished' : 'round_results');
      expect(result.answer).toBe(answers[round - 1]);
      expect(result.completedRounds).toHaveLength(round);
      expect(result.completedRounds[round - 1].players).toHaveLength(2);
      expect(result.players.find(p => p.id === host.id)?.totalPoints).toBe(200 * round);
      expect(result.players.find(p => p.id === guest.context.id)?.wordsSolved).toBe(round);
      if (round < 5) expect(manager.act({ type: 'next_round', roundId: result.roundId! }, host).ok).toBe(true);
    }
    const final = current(host);
    expect(final.players.find(p => p.id === host.id)).toMatchObject({ rank: 1, totalPoints: 1000, wordsSolved: 5, totalGuesses: 5 });
    expect(final.players.find(p => p.id === guest.context.id)).toMatchObject({ rank: 2, wordsSolved: 5, totalGuesses: 10 });
    expect(manager.act({ type: 'next_round', roundId: final.roundId! }, host).ok).toBe(false);
    expect(current(host).completedRounds).toHaveLength(5);
    expect(manager.act({ type: 'play_again' }, guest.context).ok).toBe(false);
    expect(manager.act({ type: 'play_again' }, host).ok).toBe(true);
    expect(current(host)).toMatchObject({ status: 'lobby', round: 0 });
    expect(current(host).completedRounds).toHaveLength(0);
    expect(current(host).players.every(p => p.totalPoints === 0 && p.wordsSolved === 0)).toBe(true);
  });

  it('expires a round exactly once and preserves scores and reconnect state', () => {
    const { manager, create, join, advance, current, guess } = setup();
    const { code, host } = create(), guest = join(code, 'Guest');
    manager.act({ type: 'ready', ready: true }, guest.context);
    manager.act({ type: 'start' }, host);
    expect(guess(host, 'APPLE', 1).ok).toBe(true);
    manager.disconnect(code, guest.context.id);
    expect(current(host).players.find(p => p.id === guest.context.id)?.connected).toBe(false);
    advance(90_001);
    expect(manager.tick()).toContain(code);
    expect(manager.tick()).not.toContain(code);
    expect(current(host).players.find(p => p.id === guest.context.id)?.status).toBe('timedout');
    expect(current(host).players.find(p => p.id === host.id)?.totalPoints).toBe(200);
    expect(guess(guest.context, 'APPLE', 1).ok).toBe(false);
    const resumed = manager.act({ type: 'resume', code, token: guest.token });
    expect(resumed.ok && resumed.view?.status).toBe('round_results');
    expect(resumed.ok && resumed.view?.players.find(p => p.id === host.id)?.totalPoints).toBe(200);
  });

  it('uses competition ranks for genuine ties', () => {
    const { manager, create, join, current, guess, advance } = setup();
    const { code, host } = create(3), first = join(code, 'First'), third = join(code, 'Third');
    manager.act({ type: 'ready', ready: true }, first.context);
    manager.act({ type: 'ready', ready: true }, third.context);
    manager.act({ type: 'start' }, host);
    expect(guess(host, 'APPLE', 1).ok).toBe(true);
    expect(guess(first.context, 'APPLE', 1).ok).toBe(true);
    expect(guess(third.context, 'ALBUM', 1).ok).toBe(true);
    advance();
    expect(guess(third.context, 'APPLE', 2).ok).toBe(true);
    const standings = current(host).players;
    expect(standings.find(p => p.name === 'Host')).toMatchObject({ rank: 1, tie: true });
    expect(standings.find(p => p.name === 'First')).toMatchObject({ rank: 1, tie: true });
    expect(standings.find(p => p.name === 'Third')).toMatchObject({ rank: 3, tie: false });
  });

  it('transfers the host, releases old lobby seats, and isolates rooms', () => {
    const { manager, create, join, advance, current } = setup();
    const first = create(3), second = create();
    const guest = join(first.code, 'Guest');
    manager.disconnect(first.code, first.host.id);
    expect(current(guest.context).players.find(p => p.id === guest.context.id)?.host).toBe(true);
    advance(2 * 60_000 + 1); manager.tick();
    expect(manager.viewFor(first.code, first.host.id)).toBeUndefined();
    expect(current(second.host).players).toHaveLength(1);
    expect(join(first.code, 'New guest').context.code).toBe(first.code);
  });

  it('enforces hard-mode clues without consuming an attempt', () => {
    const { manager, create, join, advance, current, guess } = setup();
    const { code, host } = create(2, 'hard'), guest = join(code, 'Guest');
    manager.act({ type: 'ready', ready: true }, guest.context);
    manager.act({ type: 'start' }, host);
    expect(guess(host, 'CRANE', 1).ok).toBe(true);
    advance();
    expect(guess(host, 'STONE', 2)).toMatchObject({ ok: false, error: expect.stringContaining('A') });
    expect(current(host).ownGuesses).toHaveLength(1);
  });
});

describe('round score', () => {
  it('uses the attainable 200-point maximum and clamps time and guess inputs', () => {
    expect(roundScore(1, 1000, 1000, 90)).toBe(200);
    expect(roundScore(6, 91_000, 1000, 90)).toBe(100);
    expect(roundScore(0, 1000, 1000, 90)).toBe(0);
    expect(roundScore(7, 1000, 1000, 90)).toBe(0);
  });
});

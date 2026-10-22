import { describe, expect, it } from 'vitest';
import { RoomManager } from './roomManager';

function setup() {
  let now = 1000;
  const manager = new RoomManager(() => now, () => 'APPLE');
  const advance = (ms = 300) => { now += ms; };
  const create = (capacity: 2 | 3 | 4 = 2) => {
    const result = manager.act({ type: 'create', name: 'Host', settings: { capacity, duration: 90, difficulty: 'standard' } });
    if (!result.ok || !result.view || !result.token) throw Error('create failed');
    return { code: result.view.code, host: { code: result.view.code, id: result.view.selfId }, token: result.token };
  };
  const join = (code: string, name: string) => {
    const result = manager.act({ type: 'join', code, name });
    if (!result.ok || !result.view || !result.token) throw Error('join failed');
    return { context: { code, id: result.view.selfId }, token: result.token };
  };
  return { manager, advance, create, join };
}

describe('Arena room authority', () => {
  it.each([2, 3, 4] as const)('supports %i players and enforces capacity', capacity => {
    const { manager, create, join } = setup();
    const { code, host } = create(capacity);
    const guests = Array.from({ length: capacity - 1 }, (_, i) => join(code, `Guest${i}`));
    expect(manager.act({ type: 'join', code, name: 'Extra' })).toMatchObject({ ok: false, error: 'This room is full.' });
    expect(manager.act({ type: 'start' }, host)).toMatchObject({ ok: false });
    for (const guest of guests) expect(manager.act({ type: 'ready', ready: true }, guest.context).ok).toBe(true);
    const started = manager.act({ type: 'start' }, host);
    expect(started.ok && started.view?.players.length).toBe(capacity);
    expect(started.ok && started.view?.answer).toBeUndefined();
    expect(manager.act({ type: 'join', code, name: 'Late' })).toMatchObject({ ok: false });
  });

  it('validates codes, names, host actions and reconnect tokens', () => {
    const { manager, create, join } = setup();
    expect(manager.act({ type: 'join', code: 'bad', name: 'A' }).ok).toBe(false);
    expect(manager.act({ type: 'join', code: 123, name: 'A' } as never).ok).toBe(false);
    expect(manager.act({ type: 'create', name: 123, settings: { capacity: 2, duration: 90, difficulty: 'standard' } } as never).ok).toBe(false);
    expect(manager.act({ type: 'create', name: '<script>', settings: { capacity: 2, duration: 90, difficulty: 'standard' } }).ok).toBe(false);
    const { code, host } = create();
    const guest = join(code, 'Guest');
    expect(manager.act({ type: 'start' }, guest.context)).toMatchObject({ ok: false, error: 'Only the host can start a match.' });
    manager.disconnect(code, guest.context.id);
    expect(manager.viewFor(code, guest.context.id)?.players.find(p => p.id === guest.context.id)?.connected).toBe(false);
    expect(manager.act({ type: 'resume', code, token: 'wrong' }).ok).toBe(false);
    const resumed = manager.act({ type: 'resume', code, token: guest.token });
    expect(resumed.ok && resumed.view?.ownGuesses).toEqual([]);
    expect(manager.act({ type: 'leave' }, host).ok).toBe(true);
    expect(manager.viewFor(code, guest.context.id)?.players[0].host).toBe(true);
  });

  it('keeps guesses private, validates words and sequences, then ranks server-accepted solves', () => {
    const { manager, create, join, advance } = setup();
    const { code, host } = create(); const guest = join(code, 'Guest');
    manager.act({ type: 'ready', ready: true }, guest.context);
    manager.act({ type: 'start' }, host);
    expect(manager.act({ type: 'guess', word: 'xxxxx', sequence: 1 }, host).ok).toBe(false);
    expect(manager.viewFor(code, host.id)?.ownGuesses).toHaveLength(0);
    expect(manager.act({ type: 'guess', word: 'CRANE', sequence: 1 }, host).ok).toBe(true);
    expect(manager.viewFor(code, guest.context.id)?.ownGuesses).toHaveLength(0);
    expect(manager.act({ type: 'guess', word: 'CRANE', sequence: 1 }, host).ok).toBe(false);
    advance();
    expect(manager.act({ type: 'guess', word: 'APPLE', sequence: 2 }, host).ok).toBe(true);
    advance();
    const final = manager.act({ type: 'guess', word: 'APPLE', sequence: 1 }, guest.context);
    expect(final.ok && final.view?.status).toBe('finished');
    const players = manager.viewFor(code, host.id)!.players;
    expect(players.find(p => p.id === guest.context.id)?.rank).toBe(1);
    expect(players.find(p => p.id === host.id)?.rank).toBe(2);
    expect(manager.viewFor(code, host.id)?.answer).toBe('APPLE');
    expect(manager.act({ type: 'guess', word: 'APPLE', sequence: 3 }, host).ok).toBe(false);
  });

  it('closes a timed round once, supports rematch and expires abandoned rooms', () => {
    const { manager, create, join, advance } = setup();
    const { code, host } = create(); const guest = join(code, 'Guest');
    manager.act({ type: 'ready', ready: true }, guest.context);
    manager.act({ type: 'start' }, host);
    advance(90_001);
    expect(manager.tick()).toContain(code);
    expect(manager.tick()).not.toContain(code);
    expect(manager.viewFor(code, host.id)?.players.every(p => p.status === 'timedout')).toBe(true);
    expect(manager.act({ type: 'rematch' }, host).ok).toBe(true);
    advance(2 * 60 * 60_000 + 1);
    manager.tick();
    expect(manager.viewFor(code, host.id)).toBeUndefined();
  });

  it('releases disconnected lobby seats and transfers host after the reconnect window', () => {
    const { manager, create, join, advance } = setup();
    const { code, host } = create(3); const guest = join(code, 'Guest');
    manager.disconnect(code, host.id);
    advance(2 * 60_000 + 1); manager.tick();
    expect(manager.viewFor(code, host.id)).toBeUndefined();
    expect(manager.viewFor(code, guest.context.id)?.players[0].host).toBe(true);
    expect(join(code, 'New guest').context.code).toBe(code);
  });

  it('enforces hard-mode clues on the server without using an attempt', () => {
    const { manager, join, advance } = setup();
    const created = manager.act({ type: 'create', name: 'Host', settings: { capacity: 2, duration: 90, difficulty: 'hard' } });
    if (!created.ok || !created.view) throw Error('create failed');
    const host = { code: created.view.code, id: created.view.selfId }, guest = join(host.code, 'Guest');
    manager.act({ type: 'ready', ready: true }, guest.context);
    manager.act({ type: 'start' }, host);
    expect(manager.act({ type: 'guess', word: 'CRANE', sequence: 1 }, host).ok).toBe(true);
    advance();
    expect(manager.act({ type: 'guess', word: 'STONE', sequence: 2 }, host)).toMatchObject({ ok: false, error: expect.stringContaining('A') });
    expect(manager.viewFor(host.code, host.id)?.ownGuesses).toHaveLength(1);
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession, evaluateGuess, submitGuess } from './engine';
import { loadProfile, loadSessions, recordFinish, saveSessions } from './storage';

beforeEach(() => localStorage.clear());

describe('storage recovery', () => {
  it('keeps valid progress while rejecting impossible feedback and statuses', () => {
    const valid = submitGuess({ ...createSession('classic', '2026-10-22', 'APPLE'), draft: 'CRANE' }).session;
    const invalid = { ...createSession('hard', '2026-10-22', 'APPLE'), guesses: [
      { word: 'CRANE', marks: ['correct', 'correct', 'correct', 'correct', 'correct'] },
    ] };
    saveSessions({ classic: valid, hard: invalid as never });
    const restored = loadSessions();
    expect(restored.classic?.guesses).toHaveLength(1);
    expect(restored.hard).toBeUndefined();
    saveSessions({ classic: { ...valid, status: 'won' } });
    expect(loadSessions().classic).toBeUndefined();
  });

  it('recovers from malformed data without losing a valid profile', () => {
    const won = submitGuess({ ...createSession('classic', '2026-10-22', 'APPLE'), draft: 'APPLE' }).session;
    const profile = recordFinish(loadProfile(), won, '2026-10-22');
    localStorage.setItem('wordverse-profile-v1', JSON.stringify({ ...profile, records: [...profile.records, ...profile.records] }));
    localStorage.setItem('wordverse-sessions-v1', '{bad json');
    expect(loadProfile().records).toHaveLength(1);
    expect(loadSessions()).toEqual({});
    expect(loadProfile().xp).toBe(profile.xp);
  });

  it('survives a storage access failure and never records an active puzzle', () => {
    const active = createSession('daily', '2026-10-22', 'APPLE');
    expect(recordFinish(loadProfile(), active, '2026-10-22').records).toHaveLength(0);
    const getter = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('blocked'); });
    expect(loadSessions()).toEqual({});
    expect(loadProfile().records).toHaveLength(0);
    getter.mockRestore();
    const setter = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('blocked'); });
    expect(() => saveSessions({ daily: active })).not.toThrow();
    setter.mockRestore();
  });

  it('retains duplicate-letter feedback only when it matches the evaluator', () => {
    const session = createSession('classic', '2026-10-22', 'APPLE');
    const guess = { word: 'ALLEY', marks: evaluateGuess('APPLE', 'ALLEY') };
    saveSessions({ classic: { ...session, guesses: [guess] } });
    expect(loadSessions().classic?.guesses[0].marks).toEqual(guess.marks);
  });
});

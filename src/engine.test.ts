import { describe, expect, it } from 'vitest';
import { createSession, dailyAnswer, evaluateGuess, hardModeError, keyboardMarks, scoreForSolve, shareText, submitGuess, useHint } from './engine';
import { recordFinish, streakInfo, type Profile } from './storage';
import { DAILY_WORDS_V1 } from './words';

describe('word evaluator', () => {
  it('scores exact and misplaced matches using remaining letter counts', () => {
    expect(evaluateGuess('APPLE', 'ALLEY')).toEqual(['correct', 'present', 'absent', 'present', 'absent']);
    expect(evaluateGuess('LEVEL', 'ELVES')).toEqual(['present', 'present', 'correct', 'correct', 'absent']);
    expect(evaluateGuess('SHEEP', 'SPEED')).toEqual(['correct', 'present', 'correct', 'correct', 'absent']);
    expect(evaluateGuess('CRANE', 'AAAAA')).toEqual(['absent', 'absent', 'correct', 'absent', 'absent']);
  });
  it('keeps stronger keyboard feedback', () => {
    expect(keyboardMarks([
      { word: 'APPLE', marks: ['correct', 'absent', 'absent', 'absent', 'absent'] },
      { word: 'ABOUT', marks: ['present', 'absent', 'absent', 'absent', 'absent'] },
    ]).A).toBe('correct');
  });
});

describe('gameplay rules', () => {
  it('has only five-letter daily answers and a stable date selection', () => {
    expect(DAILY_WORDS_V1.length).toBeGreaterThan(300);
    expect(DAILY_WORDS_V1.every(w => w.length === 5)).toBe(true);
    expect(dailyAnswer('2026-10-22')).toBe(dailyAnswer('2026-10-22'));
    expect(createSession('daily', '2026-10-22').answer).toBe(createSession('daily', '2026-10-22').answer);
  });
  it('rejects invalid guesses without consuming a turn and wins immediately', () => {
    const initial = createSession('classic', '2026-10-22', 'APPLE');
    expect(submitGuess({ ...initial, draft: 'ZZZZZ' }).session.guesses).toHaveLength(0);
    const won = submitGuess({ ...initial, draft: 'APPLE' }).session;
    expect(won.status).toBe('won');
    expect(won.guesses).toHaveLength(1);
    expect(submitGuess({ ...won, draft: 'ABOUT' }).session.guesses).toHaveLength(1);
  });
  it('ends after six valid wrong guesses', () => {
    let session = createSession('classic', '2026-10-22', 'APPLE');
    for (let i = 0; i < 6; i++) session = submitGuess({ ...session, draft: 'CRANE' }).session;
    expect(session.status).toBe('lost');
    expect(session.guesses).toHaveLength(6);
    expect(submitGuess({ ...session, draft: 'APPLE' }).session.guesses).toHaveLength(6);
  });
  it('enforces known hard-mode positions and letter quantities', () => {
    const guess = { word: 'ALLEY', marks: evaluateGuess('APPLE', 'ALLEY') };
    expect(hardModeError([guess], 'CRANE')).toMatch(/position 1/);
    expect(hardModeError([guess], 'ABOUT')).toMatch(/include L/);
    expect(hardModeError([guess], 'AMPLE')).toBeNull();
  });
  it('applies a hint penalty and never reveals the only remaining letter', () => {
    const session = createSession('hard', '2026-10-22', 'APPLE');
    const hinted = useHint(session).session;
    expect(hinted.hintsUsed).toBe(1);
    expect(scoreForSolve('hard', 2, 1)).toBe(scoreForSolve('hard', 2, 0) - 35);
    const almostKnown = { ...session, guesses: [{ word: 'APPLY', marks: evaluateGuess('APPLE', 'APPLY') }] };
    expect(useHint(almostKnown).error).toMatch(/last letter/);
  });
  it('shares the grid without the answer', () => {
    const lost = { ...createSession('classic', '2026-10-22', 'APPLE'), status: 'lost' as const,
      guesses: [{ word: 'CRANE', marks: evaluateGuess('APPLE', 'CRANE') }] };
    expect(shareText(lost)).not.toContain('APPLE');
    expect(shareText(lost)).toContain('⬛');
  });
});

describe('records and streaks', () => {
  const empty: Profile = { xp: 0, records: [], bestStreak: 0, settings: { sound: false, animations: true, theme: 'dark', highContrast: false } };
  it('records a finished puzzle exactly once', () => {
    const solved = submitGuess({ ...createSession('daily', '2026-10-22', 'APPLE'), draft: 'APPLE' }).session;
    const once = recordFinish(empty, solved, '2026-10-22');
    const twice = recordFinish(once, solved, '2026-10-22');
    expect(twice.records).toHaveLength(1);
    expect(twice.xp).toBe(once.xp);
  });
  it('preserves yesterday’s streak until today is played', () => {
    const records = [{ id: 'daily-v1-2026-10-21', mode: 'daily' as const, date: '2026-10-21', won: true, attempts: 3, score: 160, hints: 0 }];
    expect(streakInfo(records, '2026-10-22').current).toBe(1);
    expect(streakInfo(records, '2026-10-23').current).toBe(0);
  });
});

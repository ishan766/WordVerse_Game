import { describe, expect, it } from 'vitest';
import { createSession, evaluateGuess, type Guess } from './engine';
import { analyzeWordDna, dnaScore, expectedInformationGain, filterCandidates, improvementTip, solvingPersonality, wordDnaShareText, type GuessInsight } from './wordDna';

const guess = (answer: string, word: string): Guess => ({ word, marks: evaluateGuess(answer, word) });
const row = (word: string, index = 1, marks: Guess['marks'] | null = null): GuessInsight => ({
  index, word, marks, before: 10, after: 5, eliminated: 5, expectedBits: 1, observedBits: 1,
  newPositions: 0, newConfirmedLetters: 0, newLetters: new Set(word).size, newAbsentLetters: 0, explanation: '',
});

describe('candidate math', () => {
  it('retains only words matching every recorded feedback pattern', () => {
    const pool = ['APPLE', 'AMPLE', 'ALIEN', 'ALLEY', 'LEVEL'];
    const afterFirst = filterCandidates(pool, 'ALLEY', evaluateGuess('APPLE', 'ALLEY'));
    expect(afterFirst).toEqual(['APPLE', 'AMPLE']);
    expect(filterCandidates(afterFirst, 'APPLE', evaluateGuess('APPLE', 'APPLE'))).toEqual(['APPLE']);
  });
  it('handles duplicates without crediting extra occurrences', () => {
    const pool = ['CRANE', 'ABACA', 'AORTA'];
    const marks = evaluateGuess('CRANE', 'AAAAA');
    expect(filterCandidates(pool, 'AAAAA', marks)).toEqual(['CRANE']);
  });
  it('calculates hand-verifiable expected entropy, including probe guesses', () => {
    expect(expectedInformationGain(['APPLE', 'BERRY'], 'APPLE')).toBeCloseTo(1);
    expect(expectedInformationGain(['APPLE', 'BERRY'], 'ZZZZZ')).toBe(0);
    expect(expectedInformationGain(['APPLE'], 'ZZZZZ')).toBe(0);
    expect(expectedInformationGain([], 'APPLE')).toBeNull();
  });
});

describe('Word DNA analysis', () => {
  it('normalizes scores and keeps losses out of the win classification', () => {
    expect(dnaScore('won', 1, 100, 1)).toBe(100);
    expect(dnaScore('lost', 6, 100, 1)).toBeLessThan(50);
    expect(dnaScore('won', 0, 0, 1)).toBeNull();
    expect(dnaScore('won', 3, -1, 1)).toBeNull();
  });
  it('uses explicit personality rules in precedence order', () => {
    expect(solvingPersonality({ status: 'won', attempts: 2, firstReduction: 1, firstNewLetters: 5, uniqueLetters: 20, narrowingGuesses: 3 }).name).toBe('THE SNIPER');
    expect(solvingPersonality({ status: 'lost', attempts: 6, firstReduction: .8, firstNewLetters: 5, uniqueLetters: 10, narrowingGuesses: 1 }).name).toBe('THE SCOUT');
    expect(solvingPersonality({ status: 'lost', attempts: 6, firstReduction: .1, firstNewLetters: 5, uniqueLetters: 19, narrowingGuesses: 1 }).name).toBe('THE EXPLORER');
    expect(solvingPersonality({ status: 'won', attempts: 4, firstReduction: .1, firstNewLetters: 5, uniqueLetters: 10, narrowingGuesses: 2 }).name).toBe('THE DETECTIVE');
    expect(solvingPersonality({ status: 'lost', attempts: 6, firstReduction: 0, firstNewLetters: 4, uniqueLetters: 10, narrowingGuesses: 0 }).name).toBe('THE PERSISTENT MIND');
  });
  it('makes tips only from recorded behavior', () => {
    expect(improvementTip([])).toBeNull();
    expect(improvementTip([row('AABBC')])).toMatch(/distinct letters/);
    expect(improvementTip([row('CRANE', 1, ['absent', 'absent', 'absent', 'absent', 'absent']), row('CLOUD', 2)])).toMatch(/reused a letter/);
    expect(improvementTip([row('CRANE', 1, ['correct', 'absent', 'absent', 'absent', 'absent']), row('PILOT', 2)])).toMatch(/confirmed a position/);
  });
  it('scores a completed win from its real sequence and shares without the answer', () => {
    const session = { ...createSession('classic', '2026-10-22', 'APPLE'), status: 'won' as const,
      guesses: [guess('APPLE', 'ALLEY'), guess('APPLE', 'APPLE')] };
    const analysis = analyzeWordDna(session, ['APPLE', 'AMPLE', 'ALIEN', 'ALLEY']);
    expect(analysis?.timeline.map(r => [r.before, r.after])).toEqual([[4, 2], [2, 1]]);
    expect(analysis?.timeline[0].newPositions).toBe(1);
    expect(analysis?.timeline[0].newConfirmedLetters).toBe(3);
    expect(analysis?.score).toBeGreaterThan(0);
    expect(analysis?.personality.name).toBe('THE SNIPER');
    expect(wordDnaShareText(analysis!)).not.toContain('APPLE');
    expect(wordDnaShareText(analysis!)).toContain('SOLVED');
    expect(wordDnaShareText(analysis!)).toContain('🟩');
  });
  it('handles a loss, a missing history, and inconsistent data without invented metrics', () => {
    const guesses = Array.from({ length: 6 }, () => guess('APPLE', 'CRANE'));
    const loss = analyzeWordDna({ ...createSession('classic', '2026-10-22', 'APPLE'), status: 'lost', guesses }, ['APPLE', 'CRANE']);
    expect(loss?.status).toBe('lost');
    expect(loss?.score).toBeLessThan(50);
    expect(wordDnaShareText(loss!)).toContain('UNSOLVED');
    expect(analyzeWordDna({ status: 'playing' })).toBeNull();
    const missing = analyzeWordDna({ status: 'won', answer: 'APPLE', guesses: [] }, ['APPLE']);
    expect(missing?.score).toBeNull();
    expect(missing?.timeline).toEqual([]);
    const inconsistent = analyzeWordDna({ status: 'won', answer: 'APPLE', guesses: [{ word: 'APPLE', marks: ['absent', 'absent', 'absent', 'absent', 'absent'] }] }, ['APPLE']);
    expect(inconsistent?.score).toBeNull();
    expect(inconsistent?.finalCandidates).toBe(0);
    expect(inconsistent?.diagnostic).toMatch(/inconsistent/);
    expect(analyzeWordDna({ status: 'won', answer: 'APPLE', guesses: [guess('APPLE', 'APPLE')] }, [])?.score).toBeNull();
  });
  it('never marks a positive duplicate as absent in the letter map', () => {
    const analysis = analyzeWordDna({ status: 'lost', answer: 'APPLE', guesses: Array.from({ length: 6 }, () => guess('APPLE', 'ALLEY')) }, ['APPLE', 'AMPLE']);
    expect(analysis?.letters.find(l => l.letter === 'L')?.state).toBe('present');
    expect(analysis?.letters.find(l => l.letter === 'Y')?.state).toBe('absent');
    expect(analysis?.letters.find(l => l.letter === 'Z')?.state).toBe('untested');
  });
  it('does not leak an answer that matches a personality name', () => {
    const session = { ...createSession('classic', '2026-10-22', 'SCOUT'), status: 'won' as const,
      guesses: [guess('SCOUT', 'CRANE'), guess('SCOUT', 'SOUND'), guess('SCOUT', 'SCOUT')] };
    const analysis = analyzeWordDna(session, ['SCOUT', 'SOUND', 'CRANE', 'SHOUT']);
    expect(analysis?.personality.name).toBe('THE SCOUT');
    expect(analysis?.sharePersonality).toBe('THE DISCOVERER');
    expect(wordDnaShareText(analysis!)).not.toContain('SCOUT');
  });
});

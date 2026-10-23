import { expect, it } from 'vitest';
import { arenaShareText, type ArenaView } from './arenaProtocol';

it('shares ranked results without the answer or private guesses', () => {
  const view: ArenaView = {
    code: 'ABCDEFG', status: 'finished', settings: { capacity: 2, duration: 90, difficulty: 'standard' },
    selfId: 'a', serverNow: 100, round: 6, completedRounds: [], answer: 'APPLE', ownGuesses: [{ word: 'CRANE', marks: ['absent', 'absent', 'present', 'absent', 'correct'] }],
    players: [{ id: 'a', name: 'Alex', host: true, connected: true, status: 'solved', attempts: 2, rank: 1, tie: false, roundPoints: 105, totalPoints: 105, wordsSolved: 1, totalGuesses: 2, totalSolveMs: 1000 }],
  };
  const text = arenaShareText(view, 'https://example.com/?room=ABCDEFG');
  expect(text).toContain('Alex'); expect(text).toContain('105 pts');
  expect(text).not.toContain('APPLE'); expect(text).not.toContain('CRANE');
  expect(arenaShareText({ ...view, status: 'round_results', round: 5 }, '')).toContain('ROUND 5/6');
  expect(arenaShareText({ ...view, status: 'playing' }, '')).toBe('');
});

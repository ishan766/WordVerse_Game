// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ArenaLeaderboard, ArenaScoreBreakdown } from './ArenaLeaderboard';
import { standingRows } from './arenaStandings';
import type { ArenaPlayer, ArenaView } from './arenaProtocol';

afterEach(cleanup);

function viewFor(count: number): ArenaView {
  const players: ArenaPlayer[] = Array.from({ length: count }, (_, index) => ({
    id: String(index), name: `Player ${index + 1}`, host: index === 0, connected: true,
    status: index === 0 ? 'solved' : 'timedout', attempts: index === 0 ? 1 : 0,
    roundPoints: index === 0 ? 200 : 0, totalPoints: index === 0 ? 200 : 0,
    wordsSolved: index === 0 ? 1 : 0, totalGuesses: index === 0 ? 1 : 0,
    totalSolveMs: 0, rank: index === 0 ? 1 : 2, tie: index > 0 && count > 2,
  }));
  return {
    code: 'ABCDEFG', status: 'round_results', settings: { capacity: count as ArenaView['settings']['capacity'], duration: 90, difficulty: 'standard' },
    players: [...players].reverse(), selfId: '0', ownGuesses: [], serverNow: 1000, round: 1, answer: 'APPLE',
    completedRounds: [{ round: 1, answer: 'APPLE', players: players.map(player => ({
      id: player.id, status: player.status as 'solved' | 'timedout', guesses: player.attempts,
      points: player.roundPoints, totalPoints: player.totalPoints,
    })) }],
  };
}

describe('Arena standings', () => {
  it.each([2, 3, 4, 5, 6])('renders %i server-ranked players without clipping score data', count => {
    render(<ArenaLeaderboard view={viewFor(count)} results />);
    const board = screen.getByLabelText('Tournament standings');
    const rows = within(board).getAllByRole('row');
    expect(rows).toHaveLength(count + 1);
    expect(rows[1].textContent).toContain('Player 1');
    expect(rows[1].textContent).toContain('200');
    expect(rows[count].textContent).toContain('0');
    expect(within(board).getByRole('columnheader', { name: 'Failed rounds' })).toBeTruthy();
    expect(board.querySelector('.arena-table-scroll')).toBeTruthy();
  });

  it('shows a completed failure as 0 and future rounds as unplayed', () => {
    const view = viewFor(2);
    render(<ArenaScoreBreakdown view={view} />);
    const board = screen.getByLabelText('Round-by-round scores');
    const rows = within(board).getAllByRole('row');
    const failed = rows[2];
    expect(within(failed).getByRole('cell', { name: 'Round 1: 0 points' }).textContent).toBe('0');
    expect(within(failed).getByRole('cell', { name: 'Round 2: not played' }).textContent).toBe('—');
    expect(failed.lastElementChild?.textContent).toBe('0');
    expect(standingRows(view).find(player => player.id === '1')?.failedRounds).toBe(1);
  });

  it('preserves shared ranks without awarding arbitrary medals', () => {
    const view = viewFor(3);
    render(<ArenaLeaderboard view={view} results />);
    const board = screen.getByLabelText('Tournament standings');
    expect(board.querySelectorAll('.arena-rank-tie')).toHaveLength(2);
    expect(board.querySelectorAll('.arena-rank-silver')).toHaveLength(0);
    expect(within(board).getAllByText('Tied #2')).toHaveLength(2);
  });
});

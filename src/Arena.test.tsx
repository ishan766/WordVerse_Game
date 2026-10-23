// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Arena from './Arena';
import type { ArenaView } from './arenaProtocol';

const connection = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    connected: false,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => { handlers.set(event, handler); }),
    removeAllListeners: vi.fn(() => handlers.clear()),
    disconnect: vi.fn(),
  };
  return { handlers, socket };
});

vi.mock('socket.io-client', () => ({ io: vi.fn(() => connection.socket) }));

afterEach(() => { cleanup(); sessionStorage.clear(); connection.handlers.clear(); connection.socket.connected = false; });

describe('Arena connection recovery', () => {
  it('clears a transient connection error once Socket.IO reconnects', () => {
    render(<Arena onHome={() => {}} onSolo={() => {}} />);
    act(() => connection.handlers.get('connect_error')?.());
    expect(screen.getByRole('status').textContent).toMatch(/retrying automatically/i);
    expect(screen.getByText('OFFLINE')).toBeTruthy();

    connection.socket.connected = true;
    act(() => connection.handlers.get('connect')?.());
    expect(screen.getByText('LIVE')).toBeTruthy();
    expect(screen.queryByText(/server is unavailable/i)).toBeNull();
    expect(screen.getByRole('button', { name: /create room/i }).hasAttribute('disabled')).toBe(false);
  });

  it('renders gold, silver, bronze, and genuine ties in final standings', () => {
    render(<Arena onHome={() => {}} onSolo={() => {}} />);
    const players = [1, 2, 3, 4, 4, 6].map((rank, index) => ({
      id: String(index), name: `Player ${index + 1}`, host: index === 0, connected: true,
      status: 'solved' as const, attempts: 1, roundPoints: 200, totalPoints: 1000 - rank * 10,
      wordsSolved: 5, totalGuesses: 5, totalSolveMs: 1000, rank, tie: rank === 4,
    }));
    const view: ArenaView = { code: 'ABCDEFG', status: 'finished', settings: { capacity: 6, duration: 90, difficulty: 'standard' },
      selfId: '0', ownGuesses: [], serverNow: 1000, round: 5, answer: 'APPLE', roundId: 'last', completedRounds: [], players };
    act(() => connection.handlers.get('arena:state')?.(view));
    const board = screen.getByLabelText('Tournament standings');
    expect(board.querySelectorAll('.arena-rank-gold')).toHaveLength(1);
    expect(board.querySelectorAll('.arena-rank-silver')).toHaveLength(1);
    expect(board.querySelectorAll('.arena-rank-bronze')).toHaveLength(1);
    expect(board.querySelectorAll('.arena-rank-tie')).toHaveLength(2);
    expect(screen.getByText('TOURNAMENT COMPLETE')).toBeTruthy();
  });
});

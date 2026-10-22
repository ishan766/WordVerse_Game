// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Arena from './Arena';

const connection = vi.hoisted(() => {
  const handlers = new Map<string, () => void>();
  const socket = {
    connected: false,
    on: vi.fn((event: string, handler: () => void) => { handlers.set(event, handler); }),
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
});

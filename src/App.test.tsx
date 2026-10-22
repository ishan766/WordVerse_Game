// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createSession, localDate, submitGuess } from './engine';
import { loadProfile, recordFinish, saveProfile } from './storage';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('interface flows', () => {
  it('accepts physical keys, backspace, and one valid guess', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /play classic/i }));
    const board = screen.getByRole('grid');
    await user.keyboard('CRANX');
    expect(within(board).getByRole('gridcell', { name: 'X' })).toBeTruthy();
    await user.keyboard('{Backspace}E{Enter}');
    expect(within(board).getAllByRole('gridcell', { name: /, (correct|present|absent)$/ })).toHaveLength(5);
    expect(screen.getByText(/GUESS 2 OF 6|WORD FOUND/)).toBeTruthy();
  });

  it('keeps rapid batched letters and submits a valid word only once', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /play classic/i }));
    act(() => {
      for (const key of 'AMBER') fireEvent.keyDown(window, { key });
      fireEvent.keyDown(window, { key: 'Enter' });
      fireEvent.keyDown(window, { key: 'Enter' });
    });
    expect(screen.getByRole('grid').getAttribute('aria-label')).toContain('1 of 6');
    expect(screen.getByRole('dialog', { name: /word well found/i })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('wordverse-profile-v1')!).records).toHaveLength(1);
  });

  it('rejects an unknown word without using an attempt', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /play classic/i }));
    await user.keyboard('ZZZZZ{Enter}');
    expect(screen.getByRole('status').textContent).toMatch(/dictionary/);
    expect(screen.getByText('GUESS 1 OF 6')).toBeTruthy();
  });

  it('supports on-screen keys and an accessible help dialog', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'How to play' }));
    expect(screen.getByRole('dialog', { name: 'Find the hidden word' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: /play classic/i }));
    await user.click(screen.getByRole('button', { name: 'A' }));
    expect(within(screen.getByRole('grid')).getByRole('gridcell', { name: 'A' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete letter' }));
    expect(within(screen.getByRole('grid')).queryByRole('gridcell', { name: 'A' })).toBeNull();
  });

  it('restores the daily board after a fresh mount', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await user.click(screen.getByRole('button', { name: /play today’s puzzle/i }));
    await user.keyboard('CRANE{Enter}');
    expect(screen.getByRole('grid').getAttribute('aria-label')).toContain('1 of 6');
    first.unmount();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /today’s puzzle/i }));
    expect(screen.getByRole('grid').getAttribute('aria-label')).toContain('1 of 6');
  });

  it('does not reopen a completed Daily Challenge when its board is missing', () => {
    const date = localDate();
    const active = createSession('daily', date);
    const finished = submitGuess({ ...active, draft: active.answer }).session;
    saveProfile(recordFinish(loadProfile(), finished, date));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /view today.s puzzle/i }));
    expect(screen.getByRole('status').textContent).toMatch(/saved board is unavailable/i);
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('ends Time Attack when its countdown expires', async () => {
    vi.useFakeTimers();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /time attack/i }));
    expect(screen.getByText('1:30')).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(90000); });
    expect(screen.getByText(/Time's up/)).toBeTruthy();
  });

  it('starts a fresh Time Attack clock after returning home', () => {
    vi.useFakeTimers();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /time attack/i }));
    act(() => vi.advanceTimersByTime(30000));
    expect(screen.getByText('1:00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /all modes/i }));
    act(() => vi.advanceTimersByTime(90000));
    fireEvent.click(screen.getByRole('button', { name: /time attack/i }));
    expect(screen.getByText('1:30')).toBeTruthy();
  });

  it('blocks a Time Attack guess at the deadline before the display timer ticks', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /time attack/i }));
    act(() => { for (const key of 'AMBER') fireEvent.keyDown(window, { key }); });
    act(() => vi.setSystemTime(Date.now() + 90001));
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.getByRole('grid').getAttribute('aria-label')).toContain('0 of 6');
  });

  it('persists accessible settings and restores keyboard play after closing a dialog', () => {
    const first = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const switchControl = screen.getByRole('switch', { name: /high contrast/i });
    expect(switchControl.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(switchControl);
    expect(switchControl.getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /play classic/i }));
    fireEvent.keyDown(window, { key: 'A' });
    expect(within(screen.getByRole('grid')).getByRole('gridcell', { name: 'A' })).toBeTruthy();
    first.unmount();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('switch', { name: /high contrast/i }).getAttribute('aria-checked')).toBe('true');
  });

  it('ignores physical guess keys while a dialog is open, then resumes play', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /play classic/i }));
    fireEvent.click(screen.getByRole('button', { name: 'How to play' }));
    fireEvent.keyDown(window, { key: 'A' });
    expect(within(screen.getByRole('grid')).queryByRole('gridcell', { name: 'A' })).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'A' });
    expect(within(screen.getByRole('grid')).getByRole('gridcell', { name: 'A' })).toBeTruthy();
  });

  it('opens Word DNA after a solve and copies an answer-free summary', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const mounted = render(<App />);
    await user.click(screen.getByRole('button', { name: /play classic/i }));
    await user.keyboard('AMBER{Enter}');
    const result = screen.getByRole('dialog', { name: /word well found/i });
    await user.click(within(result).getByRole('button', { name: /reveal your word dna/i }));
    const dna = screen.getByRole('dialog', { name: 'Your Word DNA' });
    expect(within(dna).getByText('01 / THE GUESS TRAIL')).toBeTruthy();
    expect(within(dna).getByText('04 / INFORMATION GAIN')).toBeTruthy();
    expect(within(dna).getAllByText('THE SNIPER').length).toBeGreaterThan(0);
    await user.click(within(dna).getByRole('button', { name: 'A: correct position' }));
    expect(within(dna).getByText(/Guess 1, position 1/)).toBeTruthy();
    await user.click(within(dna).getByRole('button', { name: /copy summary/i }));
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).not.toContain('AMBER');
    const recorded = JSON.parse(localStorage.getItem('wordverse-profile-v1')!).records.length;
    mounted.unmount();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /play classic/i }));
    await user.click(screen.getByRole('button', { name: /reveal your word dna/i }));
    expect(screen.getByRole('dialog', { name: 'Your Word DNA' })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('wordverse-profile-v1')!).records).toHaveLength(recorded);
  });

  it('reveals the answer and Word DNA after six wrong Classic guesses', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /play classic/i }));
    for (let i = 0; i < 6; i++) {
      act(() => {
        for (const key of 'CRANE') fireEvent.keyDown(window, { key });
        fireEvent.keyDown(window, { key: 'Enter' });
      });
    }
    expect(screen.getByRole('dialog', { name: /word lives on/i })).toBeTruthy();
    expect(screen.getByText(/The word was AMBER/)).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog', { name: /word lives on/i })).getByRole('button', { name: /reveal your word dna/i }));
    expect(screen.getByRole('dialog', { name: 'Your Word DNA' })).toBeTruthy();
    expect(screen.getAllByText('UNSOLVED').length).toBeGreaterThan(0);
    expect(JSON.parse(localStorage.getItem('wordverse-profile-v1')!).records).toHaveLength(1);
  });
});

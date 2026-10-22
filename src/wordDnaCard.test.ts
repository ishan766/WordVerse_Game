// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession, evaluateGuess } from './engine';
import { analyzeWordDna } from './wordDna';
import { downloadWordDnaImage } from './wordDnaCard';

afterEach(() => vi.restoreAllMocks());

describe('Word DNA PNG export', () => {
  it('draws an answer-free card and starts a PNG download', async () => {
    const context = {
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      roundRect: vi.fn(), fill: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['png'], { type: 'image/png' })));
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:word-dna-test') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const session = { ...createSession('classic', '2026-10-22', 'APPLE'), status: 'won' as const,
      guesses: [{ word: 'APPLE', marks: evaluateGuess('APPLE', 'APPLE') }] };
    const analysis = analyzeWordDna(session)!;
    await downloadWordDnaImage(analysis);
    expect(clicked).toHaveBeenCalledOnce();
    expect(context.fillText.mock.calls.flat().join(' ')).not.toContain('APPLE');
  });
});

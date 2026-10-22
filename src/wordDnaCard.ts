import type { WordDnaAnalysis } from './wordDna';

const COLORS = { background: '#080c16', panel: '#111e28', line: '#334751', text: '#f5f7f4', muted: '#a3b5bf', mint: '#72edc8', cyan: '#72cddd' };

export async function downloadWordDnaImage(analysis: WordDnaAnalysis): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 1180;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image export is unavailable in this browser');

  const gradient = ctx.createLinearGradient(0, 0, 1000, 1180);
  gradient.addColorStop(0, '#142e35'); gradient.addColorStop(.45, COLORS.background); gradient.addColorStop(1, '#0b1220');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1000, 1180);
  ctx.strokeStyle = '#35545b'; ctx.lineWidth = 2; ctx.strokeRect(45, 45, 910, 1090);
  ctx.fillStyle = COLORS.mint; ctx.font = '700 25px Arial, sans-serif'; ctx.letterSpacing = '4px'; ctx.fillText('WORDVERSE', 100, 130);
  ctx.fillStyle = COLORS.muted; ctx.font = '700 18px Arial, sans-serif'; ctx.letterSpacing = '2px'; ctx.fillText('YOUR WORD DNA', 100, 192);
  ctx.fillStyle = COLORS.text; ctx.font = '700 88px Arial, sans-serif'; ctx.letterSpacing = '-3px'; ctx.fillText(analysis.score === null ? '—' : String(analysis.score), 96, 315);
  ctx.fillStyle = COLORS.muted; ctx.font = '24px Arial, sans-serif'; ctx.letterSpacing = '0px'; ctx.fillText('/ 100', 250, 314);
  ctx.fillStyle = COLORS.mint; ctx.font = '700 27px Arial, sans-serif'; ctx.fillText(analysis.sharePersonality, 100, 375);
  ctx.strokeStyle = COLORS.line; ctx.beginPath(); ctx.moveTo(100, 414); ctx.lineTo(900, 414); ctx.stroke();
  ctx.fillStyle = COLORS.text; ctx.font = '700 22px Arial, sans-serif'; ctx.fillText(analysis.puzzleLabel, 100, 475);
  ctx.fillStyle = COLORS.muted; ctx.font = '20px Arial, sans-serif';
  ctx.fillText(`${analysis.status === 'won' ? 'SOLVED' : 'UNSOLVED'}  ·  ${analysis.attempts}/6 GUESSES`, 100, 514);

  const tile = 64, gap = 12, startX = 100, startY = 568;
  analysis.timeline.forEach((row, rowIndex) => {
    row.marks?.forEach((mark, col) => {
      ctx.fillStyle = mark === 'correct' ? '#278b72' : mark === 'present' ? '#327d93' : '#343f50';
      const x = startX + col * (tile + gap), y = startY + rowIndex * (tile + gap);
      ctx.beginPath(); ctx.roundRect(x, y, tile, tile, 8); ctx.fill();
    });
  });
  ctx.fillStyle = COLORS.cyan; ctx.font = '700 18px Arial, sans-serif'; ctx.letterSpacing = '2px'; ctx.fillText('ONE WORD AT A TIME', 100, 1090);

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Image export is unavailable in this browser');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'wordverse-word-dna.png';
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

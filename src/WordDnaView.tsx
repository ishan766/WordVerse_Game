import { useMemo, useState, type CSSProperties } from 'react';
import { ArrowDownRight, Check, Copy, Download, Dna, Share2, Sparkles } from 'lucide-react';
import type { Mark, Session } from './engine';
import { analyzeWordDna, wordDnaShareText, type GuessInsight, type LetterInsight } from './wordDna';
import { downloadWordDnaImage } from './wordDnaCard';
import './wordDna.css';

const markLabel: Record<Mark, string> = { correct: 'correct position', present: 'in the word, different position', absent: 'absent in this guess' };
const displayCount = (n: number | null) => n === null ? '—' : n.toLocaleString();
const displayBits = (n: number | null) => n === null ? '—' : `${n.toFixed(2)} bits`;

function Feedback({ row }: { row: GuessInsight }) {
  return <span className="dna-feedback" aria-label={row.marks ? `Feedback: ${row.marks.map(mark => markLabel[mark]).join(', ')}` : 'Feedback unavailable'}>
    {Array.from({ length: 5 }, (_, i) => <span key={i} className={`dna-feedback-tile ${row.marks?.[i] ?? 'unknown'}`} aria-hidden="true">{row.word[i] === '?' ? '·' : row.word[i]}</span>)}
  </span>;
}

function LetterMap({ letters }: { letters: LetterInsight[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const chosen = letters.find(item => item.letter === selected);
  return <div className="dna-letter-section">
    <div className="dna-section-heading"><span>03 / LETTER MAP</span><p>Tap a letter to inspect its trail.</p></div>
    <div className="dna-letter-grid" role="group" aria-label="Letter elimination map">
      {letters.map(item => <button key={item.letter} type="button" className={`dna-letter ${item.state} ${selected === item.letter ? 'selected' : ''}`}
        aria-label={`${item.letter}: ${item.state === 'untested' ? 'never tested' : item.state === 'unknown' ? 'feedback unavailable' : markLabel[item.state]}`}
        aria-pressed={selected === item.letter} onClick={() => setSelected(item.letter)}>{item.letter}</button>)}
    </div>
    <div className="dna-legend"><span><i className="correct" /> Right spot</span><span><i className="present" /> In the word</span><span><i className="absent" /> Ruled out</span><span><i className="untested" /> Untested</span></div>
    {chosen && <div className="dna-letter-detail" role="status"><strong>{chosen.letter} / {chosen.state === 'untested' ? 'NOT TESTED' : chosen.state.toUpperCase()}</strong>
      <p>{!chosen.uses.length ? 'This letter was never used in your guesses.' : chosen.uses.map(use => `Guess ${use.guess}, position ${use.position}: ${use.mark ? markLabel[use.mark] : 'feedback unavailable'}`).join(' · ')}</p>
      {chosen.uses.some(use => use.mark === 'absent') && chosen.uses.some(use => use.mark === 'correct' || use.mark === 'present') &&
        <small>A gray duplicate means that extra occurrence was ruled out; the letter itself remains in the answer.</small>}
    </div>}
  </div>;
}

export default function WordDnaView({ session, announce }: { session: Session; announce: (message: string) => void }) {
  const analysis = useMemo(() => analyzeWordDna(session), [session]);
  if (!analysis) return null;
  const maxBits = Math.max(1, ...analysis.timeline.map(row => row.expectedBits ?? 0));
  const candidatePath = [analysis.initialCandidates, ...analysis.timeline.map(row => row.after)];

  const copy = async () => {
    try { await navigator.clipboard.writeText(wordDnaShareText(analysis)); announce('Word DNA summary copied'); }
    catch { announce('Clipboard is unavailable in this browser'); }
  };
  const share = async () => {
    if (!navigator.share) { await copy(); return; }
    try { await navigator.share({ title: 'My Word DNA · Wordverse', text: wordDnaShareText(analysis) }); }
    catch (error) { if ((error as Error).name !== 'AbortError') announce('Sharing is unavailable in this browser'); }
  };
  const download = async () => {
    try { await downloadWordDnaImage(analysis); announce('Word DNA image downloaded'); }
    catch { announce('Image export is unavailable in this browser'); }
  };

  return <div className="dna-panel">
    <span className="sr-only" role="status">Word DNA analysis ready. {analysis.status === 'won' ? 'Puzzle solved.' : 'Puzzle not solved.'} DNA score {analysis.score ?? 'unavailable'}.</span>
    <div className="dna-hero dna-reveal-1"><div className="dna-hero-copy"><span className="dna-overline"><Dna size={16} /> YOUR SOLVING SIGNATURE</span><h3>{analysis.status === 'won' ? 'Every clue led here.' : 'Every guess left a trail.'}</h3><p>{analysis.scoreReason}</p><div className="dna-hero-meta"><span>{analysis.puzzleLabel}</span><span>{analysis.status === 'won' ? 'SOLVED' : 'UNSOLVED'}</span></div></div>
      <div className={`dna-score-orbit ${analysis.status}`} style={{ '--dna-percent': `${analysis.score ?? 0}%` } as CSSProperties}><div><strong>{analysis.score ?? '—'}</strong><span>/ 100 DNA</span></div></div></div>
    {analysis.diagnostic && <div className="dna-diagnostic" role="note">{analysis.diagnostic} The guess timeline and letter history below use the feedback that was saved.</div>}
    <details className="dna-method"><summary>How the DNA score works</summary><p>Score = 20 for a solve + 35 × (7 − guesses) ÷ 6 + 25 × the fraction of starting uncertainty removed + 20 × observed information per guess ÷ 2 bits, with the last two parts capped at their maximum. Two bits means reducing possibilities fourfold per guess. The result is rounded to 0–100; losses are capped at 49. This is a game score, not an optimal-solver rating.</p></details>

    <section className="dna-section dna-reveal-2" aria-label="Guess by guess intelligence"><div className="dna-section-heading"><span>01 / THE GUESS TRAIL</span><p>{analysis.attempts} {analysis.attempts === 1 ? 'guess' : 'guesses'} recorded</p></div>
      {analysis.timeline.length ? <ol className="dna-timeline">{analysis.timeline.map(row => <li className="dna-guess" key={row.index}>
        <span className="dna-guess-index">{String(row.index).padStart(2, '0')}</span><div className="dna-guess-main"><div className="dna-guess-top"><strong>{row.word}</strong><Feedback row={row} /></div><p>{row.explanation}</p><div className="dna-guess-metrics"><span><b>{row.newConfirmedLetters}</b> new answer letters</span><span><b>{row.newPositions}</b> new positions</span><span><b>{displayCount(row.eliminated)}</b> candidates removed</span><span><b>{displayBits(row.expectedBits)}</b> expected gain</span></div><div className="dna-guess-track"><div style={{ width: `${row.before && row.eliminated !== null ? row.eliminated / row.before * 100 : 0}%` }} /></div></div>
      </li>)}</ol> : <p className="dna-empty">No guess history was saved for this puzzle.</p>}
    </section>

    <section className="dna-section dna-reveal-3" aria-label="Letter elimination map"><LetterMap letters={analysis.letters} /></section>

    <section className="dna-section dna-reveal-4" aria-label="Information gain chart"><div className="dna-section-heading"><span>04 / INFORMATION GAIN</span><p>Expected bits per guess</p></div>
      <div className="dna-chart" role="img" aria-label={`Expected information gain in bits: ${analysis.timeline.map(row => `guess ${row.index} ${displayBits(row.expectedBits)}`).join('; ')}`}>
        {analysis.timeline.map(row => <div className="dna-chart-column" key={row.index}><span>{row.expectedBits === null ? '—' : row.expectedBits.toFixed(1)}</span><div className="dna-chart-track"><div style={{ height: `${row.expectedBits === null ? 0 : Math.max(4, row.expectedBits / maxBits * 100)}%` }} /></div><small>G{row.index}</small></div>)}
      </div>
      <div className="dna-candidate-path"><span>POSSIBLE ANSWERS</span><strong>{candidatePath.map(displayCount).join(' → ')}</strong></div>
      <p className="dna-method-note">{analysis.candidateBasis} Each count keeps only answers that match every earlier feedback pattern. Bars show expected Shannon information before seeing that guess’s feedback; the counts show the actual reduction.</p>
    </section>

    <section className="dna-insights dna-reveal-5" aria-label="Solving style and improvement tip"><div className="dna-personality"><span className="dna-overline"><Sparkles size={15} /> YOUR SOLVING STYLE</span><h3>{analysis.personality.name}</h3><p>{analysis.personality.reason}</p></div>{analysis.tip && <div className="dna-tip"><span className="dna-overline"><ArrowDownRight size={15} /> NEXT TIME</span><p>{analysis.tip}</p></div>}</section>

    <section className="dna-share-section dna-reveal-5" aria-label="Shareable Word DNA card"><div className="dna-section-heading"><span>05 / TAKE YOUR DNA WITH YOU</span><p>Answer never included</p></div>
      <div className="dna-share-card"><div className="dna-card-top"><span className="dna-card-brand">word<span>verse.</span></span><span>WORD DNA</span></div><div className="dna-card-middle"><div><small>{analysis.puzzleLabel}</small><strong>{analysis.sharePersonality}</strong><span>{analysis.status === 'won' ? 'SOLVED' : 'UNSOLVED'} · {analysis.attempts}/6 GUESSES</span></div><div className="dna-card-score"><strong>{analysis.score ?? '—'}</strong><span>DNA / 100</span></div></div><div className="dna-card-grid">{analysis.timeline.map(row => <div key={row.index}>{row.marks?.map((mark, i) => <i className={mark} key={i} />) ?? Array.from({ length: 5 }, (_, i) => <i key={i} />)}</div>)}</div></div>
      <div className="dna-share-actions"><button className="button primary" onClick={copy}><Copy size={16} /> Copy summary</button><button className="button secondary" onClick={share}><Share2 size={16} /> Share</button><button className="button secondary" onClick={download}><Download size={16} /> Download PNG</button></div>
      <p className="dna-share-note"><Check size={14} /> The answer is never included in shared text or the image.</p>
    </section>
  </div>;
}

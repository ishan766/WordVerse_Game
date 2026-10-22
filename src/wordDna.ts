import { DAILY_VERSION, dailyNumber, evaluateGuess, type Guess, type Mark, type Mode, type Session } from './engine';
import { DAILY_WORDS_V1 } from './words';

export type LetterUse = { guess: number; position: number; mark: Mark | null; word: string };
export type LetterInsight = { letter: string; state: Mark | 'untested' | 'unknown'; uses: LetterUse[] };
export type GuessInsight = {
  index: number; word: string; marks: Mark[] | null; before: number | null; after: number | null;
  eliminated: number | null; expectedBits: number | null; observedBits: number | null;
  newPositions: number; newConfirmedLetters: number; newLetters: number; newAbsentLetters: number; explanation: string;
};
export type Personality = { name: string; reason: string };
export type WordDnaAnalysis = {
  mode: Mode; puzzleLabel: string; status: 'won' | 'lost'; attempts: number;
  score: number | null; scoreReason: string; personality: Personality;
  sharePersonality: string; tip: string | null; timeline: GuessInsight[]; letters: LetterInsight[];
  initialCandidates: number; finalCandidates: number | null; initialEntropy: number;
  candidateBasis: string; diagnostic: string | null;
};

const MARKS: Mark[] = ['correct', 'present', 'absent'];
const rank: Record<Mark, number> = { absent: 0, present: 1, correct: 2 };
const samePattern = (a: readonly Mark[], b: readonly Mark[]) => a.length === 5 && b.length === 5 && a.every((mark, i) => mark === b[i]);
const patternKey = (marks: readonly Mark[]) => marks.map(mark => mark[0]).join('');
const isWord = (value: unknown): value is string => typeof value === 'string' && /^[A-Z]{5}$/.test(value.toUpperCase());
const validMarks = (value: unknown): value is Mark[] => Array.isArray(value) && value.length === 5 && value.every(mark => MARKS.includes(mark));
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function filterCandidates(candidates: readonly string[], guess: string, observed: readonly Mark[]): string[] {
  if (!isWord(guess) || !validMarks(observed)) return [];
  return candidates.filter(candidate => isWord(candidate) && samePattern(evaluateGuess(candidate, guess), observed));
}

/** Uniform prior across the supplied candidate set. The guess may be outside that set. */
export function expectedInformationGain(candidates: readonly string[], guess: string): number | null {
  if (!isWord(guess) || candidates.length === 0) return null;
  if (candidates.length === 1) return 0;
  const partitions = new Map<string, number>();
  for (const candidate of candidates) {
    if (!isWord(candidate)) return null;
    const key = patternKey(evaluateGuess(candidate, guess));
    partitions.set(key, (partitions.get(key) ?? 0) + 1);
  }
  const total = candidates.length;
  const posterior = [...partitions.values()].reduce((sum, size) => sum + size / total * Math.log2(size), 0);
  return Math.max(0, Math.log2(total) - posterior);
}

/** 20 completion + up to 35 speed + 25 uncertainty removed + 20 against a 2-bit/guess benchmark. */
export function dnaScore(status: 'won' | 'lost', attempts: number, observedBits: number, initialEntropy: number): number | null {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 6 || !Number.isFinite(observedBits) || observedBits < 0 ||
      !Number.isFinite(initialEntropy) || initialEntropy < 0) return null;
  const speed = 35 * (7 - attempts) / 6;
  const coverage = 25 * (initialEntropy === 0 ? 1 : clamp(observedBits / initialEntropy, 0, 1));
  const efficiency = 20 * clamp(observedBits / (2 * attempts), 0, 1);
  const result = (status === 'won' ? 20 : 0) + speed + coverage + efficiency;
  return Math.round(clamp(status === 'won' ? result : Math.min(49, result), 0, 100));
}

export function solvingPersonality(metrics: {
  status: 'won' | 'lost'; attempts: number; firstReduction: number; firstNewLetters: number;
  uniqueLetters: number; narrowingGuesses: number;
}): Personality {
  if (metrics.status === 'won' && metrics.attempts <= 2)
    return { name: 'THE SNIPER', reason: `Found the word in ${metrics.attempts} ${metrics.attempts === 1 ? 'guess' : 'guesses'}.` };
  if (metrics.firstReduction >= .75 && metrics.firstNewLetters >= 4)
    return { name: 'THE SCOUT', reason: 'Your opening guess ruled out at least three quarters of the answer list.' };
  if (metrics.uniqueLetters >= 18)
    return { name: 'THE EXPLORER', reason: `You tested ${metrics.uniqueLetters} distinct letters across your guesses.` };
  if (metrics.narrowingGuesses >= 2)
    return { name: 'THE DETECTIVE', reason: 'More than one guess narrowed the remaining answer list.' };
  return { name: 'THE PERSISTENT MIND', reason: 'You kept working the clues through a challenging puzzle.' };
}

export function improvementTip(timeline: readonly GuessInsight[]): string | null {
  if (!timeline.length) return null;
  if (timeline[0].newLetters <= 3) return 'Try four or five distinct letters in your opening guess to test a wider range of clues.';
  const knownAbsent = new Set<string>();
  const knownGreen = new Map<number, string>();
  for (const row of timeline) {
    if (row.index > 1) {
      if ([...row.word].some(letter => knownAbsent.has(letter)))
        return 'A later guess reused a letter already ruled out. Try a fresh candidate next time.';
      if ([...knownGreen].some(([position, letter]) => row.word[position] !== letter))
        return 'You had confirmed a position earlier. Keep that letter fixed while testing new options.';
    }
    row.marks?.forEach((mark, i) => {
      if (mark === 'correct') knownGreen.set(i, row.word[i]);
      if (mark !== 'absent') knownAbsent.delete(row.word[i]);
    });
    const positive = new Set(row.marks?.flatMap((mark, i) => mark === 'absent' ? [] : [row.word[i]]) ?? []);
    row.marks?.forEach((mark, i) => { if (mark === 'absent' && !positive.has(row.word[i])) knownAbsent.add(row.word[i]); });
  }
  const last = timeline[timeline.length - 1];
  if (last.after !== null && last.after > 1 && last.newLetters === 0)
    return 'Several answers still fit. Testing a new letter could separate the remaining possibilities.';
  if (timeline.some(row => row.eliminated !== null && row.before !== null && row.before > 0 && row.eliminated / row.before >= .75))
    return 'Your guesses sharply reduced the answer list. Keep using those constraints to choose each next word.';
  if (timeline.some(row => row.newPositions > 0))
    return 'You uncovered exact positions. Use them as anchors when trying the remaining letters.';
  return null;
}

function puzzleLabel(session: Partial<Session>): string {
  if (session.id?.startsWith('arena-')) return `Arena round ${session.id.slice(6, 12).toUpperCase()}`;
  if (session.mode === 'daily') {
    const date = session.id?.match(/^daily-v\d+-(\d{4}-\d{2}-\d{2})$/)?.[1];
    return date ? `Daily #${dailyNumber(date)} · ${date}` : 'Daily Challenge';
  }
  return session.mode === 'time' ? 'Time Attack' : session.mode === 'hard' ? 'Hard Mode' : 'Classic Play';
}

function explain(row: Omit<GuessInsight, 'explanation'>, solved: boolean): string {
  if (!row.marks) return 'Feedback for this guess is unavailable in the saved session.';
  if (solved) return 'Every letter landed in place. Puzzle solved.';
  if (row.after === 0) return 'No words in the reference answer list match this feedback.';
  const parts: string[] = [];
  if (row.newPositions > 0) parts.push(`Confirmed ${row.newPositions} new ${row.newPositions === 1 ? 'position' : 'positions'}`);
  if (row.newAbsentLetters > 0) parts.push(`ruled out ${row.newAbsentLetters} new ${row.newAbsentLetters === 1 ? 'letter' : 'letters'}`);
  if (row.eliminated !== null && row.eliminated > 0) parts.push(`removed ${row.eliminated} possible ${row.eliminated === 1 ? 'answer' : 'answers'}`);
  if (!parts.length) return 'This guess added no new position or answer-list constraint.';
  return `${parts.join('; ')}.`;
}

export function analyzeWordDna(session: Partial<Session>, answerPool: readonly string[] = DAILY_WORDS_V1): WordDnaAnalysis | null {
  if (session.status !== 'won' && session.status !== 'lost') return null;
  const pool = [...new Set(answerPool.filter(isWord).map(word => word.toUpperCase()))];
  const rawGuesses = Array.isArray(session.guesses) ? session.guesses : [];
  const answer = isWord(session.answer) ? session.answer.toUpperCase() : null;
  const priorLetters = new Set<string>();
  const knownAnswerLetters = new Set<string>();
  const knownPositions = new Set<number>();
  const absentLetters = new Set<string>();
  const letterUses = new Map<string, LetterUse[]>();
  let candidates: string[] | null = pool.length ? pool : null;
  let dataValid = !!answer && pool.includes(answer) && rawGuesses.length >= 1 && rawGuesses.length <= 6;
  let totalObservedBits = 0;
  const timeline: GuessInsight[] = rawGuesses.map((saved: Guess, index) => {
    const word = isWord(saved?.word) ? saved.word.toUpperCase() : '?????';
    const marks = validMarks(saved?.marks) ? saved.marks : null;
    if (!marks || !isWord(word) || (answer && !samePattern(evaluateGuess(answer, word), marks))) dataValid = false;
    const before = candidates?.length ?? null;
    const expectedBits = candidates && marks ? expectedInformationGain(candidates, word) : null;
    candidates = candidates && marks ? filterCandidates(candidates, word, marks) : null;
    const after = candidates?.length ?? null;
    const eliminated = before !== null && after !== null ? before - after : null;
    const observedBits = before && after ? Math.log2(before / after) : null;
    if (observedBits !== null) totalObservedBits += observedBits;
    if (after === 0) dataValid = false;
    const newLetters = [...new Set([...word].filter(letter => /[A-Z]/.test(letter) && !priorLetters.has(letter)))].length;
    [...word].forEach(letter => { if (/[A-Z]/.test(letter)) priorLetters.add(letter); });
    const positive = new Set(marks?.flatMap((mark, i) => mark === 'absent' ? [] : [word[i]]) ?? []);
    let newPositions = 0, newConfirmedLetters = 0, newAbsentLetters = 0;
    marks?.forEach((mark, position) => {
      if (mark === 'correct' && !knownPositions.has(position)) { knownPositions.add(position); newPositions++; }
      if (mark !== 'absent' && !knownAnswerLetters.has(word[position])) { knownAnswerLetters.add(word[position]); newConfirmedLetters++; }
      if (mark === 'absent' && !positive.has(word[position]) && !absentLetters.has(word[position])) {
        absentLetters.add(word[position]); newAbsentLetters++;
      }
    });
    [...word].forEach((letter, position) => {
      if (!/[A-Z]/.test(letter)) return;
      const uses = letterUses.get(letter) ?? [];
      uses.push({ guess: index + 1, position: position + 1, mark: marks?.[position] ?? null, word });
      letterUses.set(letter, uses);
    });
    const base = { index: index + 1, word, marks, before, after, eliminated, expectedBits, observedBits, newPositions, newConfirmedLetters, newLetters, newAbsentLetters };
    return { ...base, explanation: explain(base, session.status === 'won' && index === rawGuesses.length - 1 && word === answer) };
  });
  const last = timeline[timeline.length - 1];
  if (!last || (session.status === 'won' && last.word !== answer) ||
      (session.status === 'lost' && timeline.length !== 6) ||
      timeline.some((row, index) => row.word === answer && (session.status === 'lost' || index !== timeline.length - 1))) dataValid = false;
  if (session.answerListVersion !== undefined && session.answerListVersion !== DAILY_VERSION) dataValid = false;
  const diagnostic = !pool.length ? 'The answer dictionary is unavailable.' : !answer ? 'The saved answer is missing.' :
    !pool.includes(answer) ? 'The saved answer is outside the current answer list.' :
    !dataValid ? 'This older or incomplete session has inconsistent feedback. Exact DNA scoring is unavailable.' : null;
  const initialEntropy = pool.length ? Math.log2(pool.length) : 0;
  const score = dataValid ? dnaScore(session.status, timeline.length, totalObservedBits, initialEntropy) : null;
  const first = timeline[0];
  const firstReduction = first?.before && first.eliminated !== null ? first.eliminated / first.before : 0;
  const personality = dataValid ? solvingPersonality({ status: session.status, attempts: timeline.length, firstReduction,
    firstNewLetters: first?.newLetters ?? 0, uniqueLetters: priorLetters.size,
    narrowingGuesses: timeline.filter(row => row.eliminated !== null && row.eliminated > 0).length }) :
    { name: 'STYLE UNAVAILABLE', reason: 'There is not enough reliable feedback to classify this saved puzzle.' };
  const sharePersonality = answer && personality.name.split(/[^A-Z]+/).includes(answer) ? 'THE DISCOVERER' : personality.name;
  const letters: LetterInsight[] = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(letter => {
    const uses = letterUses.get(letter) ?? [];
    const strongest = uses.reduce<Mark | null>((mark, use) => use.mark && (!mark || rank[use.mark] > rank[mark]) ? use.mark : mark, null);
    return { letter, state: !uses.length ? 'untested' : strongest ?? 'unknown', uses };
  });
  return {
    mode: session.mode ?? 'classic', puzzleLabel: puzzleLabel(session), status: session.status, attempts: timeline.length,
    score, scoreReason: 'DNA score reflects how efficiently you narrowed the answer list, using guess count, observed information, and a two-bit-per-guess benchmark.',
    personality, sharePersonality, tip: dataValid ? improvementTip(timeline) : null, timeline, letters, initialCandidates: pool.length,
    finalCandidates: candidates?.length ?? null, initialEntropy,
    candidateBasis: session.answerListVersion === DAILY_VERSION || session.id?.startsWith(`daily-v${DAILY_VERSION}-`)
      ? `Exact within Wordverse answer list v${DAILY_VERSION}; all listed answers are treated as equally likely.`
      : `Reference analysis against current Wordverse answer list v${DAILY_VERSION}; original list version was not saved. All listed answers are treated as equally likely.`,
    diagnostic,
  };
}

export function wordDnaShareText(analysis: WordDnaAnalysis): string {
  const grid = analysis.timeline.map(row => row.marks?.map(mark => mark === 'correct' ? '🟩' : mark === 'present' ? '🟦' : '⬛').join('') ?? '▫️▫️▫️▫️▫️').join('\n');
  return `WORDVERSE · WORD DNA\n${analysis.puzzleLabel}\n${analysis.status === 'won' ? 'SOLVED' : 'UNSOLVED'} · ${analysis.attempts}/6 guesses · DNA ${analysis.score ?? '—'}/100\n${analysis.sharePersonality}\n${grid}`;
}

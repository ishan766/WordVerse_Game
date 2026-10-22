import { DAILY_WORDS_V1, VALID_WORDS } from './words';

export type Mode = 'daily' | 'classic' | 'hard' | 'time';
export type Mark = 'correct' | 'present' | 'absent';
export type Guess = { word: string; marks: Mark[] };
export type Status = 'playing' | 'won' | 'lost';
export type Session = {
  id: string; mode: Mode; answer: string; guesses: Guess[]; draft: string;
  status: Status; hintIndex: number | null; hintsUsed: number; score: number;
  startedAt: number; endedAt?: number; answerListVersion?: number;
};

export const MAX_GUESSES = 6;
export const DAILY_VERSION = 1;
const DAY_MS = 86400000;
const DAILY_EPOCH = Date.UTC(2025, 0, 1);

export function localDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function dailyNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - DAILY_EPOCH) / DAY_MS) + 1;
}

export function dailyAnswer(date: string): string {
  // Multiplication by a coprime stride keeps adjacent days varied and the list version stable.
  const n = dailyNumber(date) - 1;
  return DAILY_WORDS_V1[((n * 137 + 43) % DAILY_WORDS_V1.length + DAILY_WORDS_V1.length) % DAILY_WORDS_V1.length];
}

export function evaluateGuess(answer: string, guess: string): Mark[] {
  const target = answer.toUpperCase();
  const attempt = guess.toUpperCase();
  const marks: Mark[] = Array(5).fill('absent');
  const remaining = new Map<string, number>();
  for (let i = 0; i < 5; i++) {
    if (attempt[i] === target[i]) marks[i] = 'correct';
    else remaining.set(target[i], (remaining.get(target[i]) ?? 0) + 1);
  }
  for (let i = 0; i < 5; i++) {
    if (marks[i] === 'correct') continue;
    const count = remaining.get(attempt[i]) ?? 0;
    if (count > 0) {
      marks[i] = 'present';
      remaining.set(attempt[i], count - 1);
    }
  }
  return marks;
}

export function keyboardMarks(guesses: Guess[]): Record<string, Mark> {
  const rank: Record<Mark, number> = { absent: 0, present: 1, correct: 2 };
  const result: Record<string, Mark> = {};
  for (const guess of guesses) guess.word.split('').forEach((letter, index) => {
    const mark = guess.marks[index];
    if (!result[letter] || rank[mark] > rank[result[letter]]) result[letter] = mark;
  });
  return result;
}

export function hardModeError(guesses: Guess[], word: string): string | null {
  const next = word.toUpperCase();
  const minimum = new Map<string, number>();
  for (const guess of guesses) {
    const inThisGuess = new Map<string, number>();
    guess.marks.forEach((mark, i) => {
      const letter = guess.word[i];
      if (mark !== 'absent') inThisGuess.set(letter, (inThisGuess.get(letter) ?? 0) + 1);
    });
    inThisGuess.forEach((count, letter) => minimum.set(letter, Math.max(count, minimum.get(letter) ?? 0)));
  }
  for (const guess of guesses) {
    for (let i = 0; i < 5; i++) {
      if (guess.marks[i] === 'correct' && next[i] !== guess.word[i]) return `${guess.word[i]} must stay in position ${i + 1}`;
      if (guess.marks[i] === 'present' && next[i] === guess.word[i]) return `${guess.word[i]} cannot be in position ${i + 1}`;
    }
  }
  for (const [letter, count] of minimum) {
    if (next.split(letter).length - 1 < count) return `Your guess must include ${count > 1 ? `${count} ${letter}s` : letter}`;
  }
  return null;
}

export function scoreForSolve(mode: Mode, attempts: number, hintsUsed: number): number {
  return Math.max(0, 150 - (attempts - 1) * 20 - hintsUsed * 35 + (mode === 'daily' ? 50 : 0) + (mode === 'hard' ? 30 : 0));
}

export function createSession(mode: Mode, date = localDate(), answer?: string): Session {
  const picked = answer ?? (mode === 'daily' ? dailyAnswer(date) : DAILY_WORDS_V1[Math.floor(Math.random() * DAILY_WORDS_V1.length)]);
  return {
    id: mode === 'daily' ? `daily-v${DAILY_VERSION}-${date}` : `${mode}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    mode, answer: picked.toUpperCase(), guesses: [], draft: '', status: 'playing', hintIndex: null,
    hintsUsed: 0, score: 0, startedAt: Date.now(), answerListVersion: DAILY_VERSION,
  };
}

export function submitGuess(session: Session): { session: Session; error?: string } {
  const word = session.draft.toUpperCase();
  if (session.status !== 'playing') return { session };
  if (word.length !== 5) return { session, error: 'Enter a five-letter word' };
  if (!VALID_WORDS.has(word.toLowerCase())) return { session, error: 'That word is not in our dictionary' };
  if (session.mode === 'hard') {
    const error = hardModeError(session.guesses, word);
    if (error) return { session, error };
    if (session.hintIndex !== null && word[session.hintIndex] !== session.answer[session.hintIndex])
      return { session, error: `Your hint letter must stay in position ${session.hintIndex + 1}` };
  }
  const marks = evaluateGuess(session.answer, word);
  const guesses = [...session.guesses, { word, marks }];
  const status = word === session.answer ? 'won' : guesses.length === MAX_GUESSES ? 'lost' : 'playing';
  return {
    session: { ...session, guesses, draft: '', status, endedAt: status === 'playing' ? undefined : Date.now(),
      score: status === 'won' ? scoreForSolve(session.mode, guesses.length, session.hintsUsed) : 0 },
  };
}

export function useHint(session: Session): { session: Session; error?: string } {
  if (session.status !== 'playing') return { session };
  if (session.hintsUsed >= 1) return { session, error: 'One hint is available per puzzle' };
  const known = new Set<number>();
  session.guesses.forEach(guess => guess.marks.forEach((mark, i) => { if (mark === 'correct') known.add(i); }));
  const unknown = [0, 1, 2, 3, 4].filter(i => !known.has(i));
  if (unknown.length <= 1) return { session, error: 'The last letter is yours to find' };
  const index = unknown[Math.floor(Math.random() * unknown.length)];
  return { session: { ...session, hintIndex: index, hintsUsed: 1 } };
}

export function shareText(session: Session): string {
  const heading = session.mode === 'daily' ? `Daily #${dailyNumber(session.id.slice(-10))}` :
    session.mode === 'time' ? 'Time Attack' : session.mode === 'hard' ? 'Hard Mode' : 'Classic';
  const grid = session.guesses.map(g => g.marks.map(m => m === 'correct' ? '🟩' : m === 'present' ? '🟦' : '⬛').join('')).join('\n');
  return `WORDVERSE · ${heading} ${session.status === 'won' ? session.guesses.length : 'X'}/${MAX_GUESSES}\n${grid}\nPlay at Wordverse`;
}

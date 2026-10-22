import { DAILY_VERSION, evaluateGuess, type Mode, type Session } from './engine';

export type RecordEntry = { id: string; mode: Mode; date: string; won: boolean; attempts: number; score: number; hints: number };
export type Settings = { sound: boolean; animations: boolean; theme: 'dark' | 'light'; highContrast: boolean };
export type Profile = { xp: number; records: RecordEntry[]; bestStreak: number; settings: Settings };

const PROFILE_KEY = 'wordverse-profile-v1';
const SESSIONS_KEY = 'wordverse-sessions-v1';
const DEFAULT_SETTINGS: Settings = { sound: false, animations: true, theme: 'light', highContrast: false };

function read(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Game remains playable without storage. */ }
}
const isMode = (value: unknown): value is Mode => ['daily', 'classic', 'hard', 'time'].includes(String(value));

export function loadProfile(): Profile {
  const raw = read(PROFILE_KEY);
  if (!raw || typeof raw !== 'object') return { xp: 0, records: [], bestStreak: 0, settings: DEFAULT_SETTINGS };
  const p = raw as Partial<Profile>;
  const validRecords = Array.isArray(p.records) ? p.records.filter((r): r is RecordEntry =>
    !!r && typeof r.id === 'string' && isMode(r.mode) && typeof r.date === 'string' &&
    typeof r.won === 'boolean' && Number.isInteger(r.attempts) && r.attempts >= 1 && r.attempts <= 6 &&
    Number.isFinite(r.score) && r.score >= 0 && Number.isInteger(r.hints) && r.hints >= 0 && r.hints <= 1).slice(-2000) : [];
  const seen = new Set<string>();
  const records = validRecords.filter(r => !seen.has(r.id) && !!seen.add(r.id));
  const s = p.settings && typeof p.settings === 'object' ? p.settings : DEFAULT_SETTINGS;
  return {
    xp: Number.isFinite(p.xp) && p.xp! >= 0 ? p.xp! : 0,
    records,
    bestStreak: Number.isInteger(p.bestStreak) && p.bestStreak! >= 0 ? p.bestStreak! : 0,
    settings: {
      sound: typeof s.sound === 'boolean' ? s.sound : false,
      animations: typeof s.animations === 'boolean' ? s.animations : true,
      theme: s.theme === 'dark' ? 'dark' : 'light',
      highContrast: typeof s.highContrast === 'boolean' ? s.highContrast : false,
    },
  };
}

export function saveProfile(profile: Profile) { write(PROFILE_KEY, profile); }

export function loadSessions(): Partial<Record<Mode, Session>> {
  const raw = read(SESSIONS_KEY);
  if (!raw || typeof raw !== 'object') return {};
  const result: Partial<Record<Mode, Session>> = {};
  for (const mode of ['daily', 'classic', 'hard', 'time'] as const) {
    const s = (raw as Record<string, unknown>)[mode];
    if (!s || typeof s !== 'object') continue;
    const v = s as Partial<Session>;
    if (v.mode !== mode || typeof v.id !== 'string' || !/^[A-Z]{5}$/.test(v.answer ?? '') ||
        !Array.isArray(v.guesses) || v.guesses.length > 6 || !v.guesses.every(g =>
          g && typeof g.word === 'string' && /^[A-Z]{5}$/.test(g.word) && Array.isArray(g.marks) &&
          g.marks.length === 5 && g.marks.every(m => ['correct', 'present', 'absent'].includes(m))) ||
        typeof v.draft !== 'string' || !/^[A-Z]{0,5}$/.test(v.draft) ||
        !['playing', 'won', 'lost'].includes(v.status ?? '') ||
        !(v.hintIndex === null || (Number.isInteger(v.hintIndex) && v.hintIndex! >= 0 && v.hintIndex! < 5)) ||
        !Number.isInteger(v.hintsUsed) || v.hintsUsed! < 0 || v.hintsUsed! > 1 ||
        !Number.isFinite(v.score) || v.score! < 0 || !Number.isFinite(v.startedAt) ||
        (v.endedAt !== undefined && (!Number.isFinite(v.endedAt) || v.endedAt < v.startedAt!)) ||
        !(v.answerListVersion === undefined || v.answerListVersion === DAILY_VERSION)) continue;
    if (mode === 'daily' && !v.id.startsWith(`daily-v${DAILY_VERSION}-`)) continue;
    const guesses = v.guesses as Session['guesses'];
    if (guesses.some(g => g.marks.some((mark, i) => mark !== evaluateGuess(v.answer!, g.word)[i]))) continue;
    const answerGuesses = guesses.filter(g => g.word === v.answer).length;
    if (v.status === 'playing' && (guesses.length >= 6 || answerGuesses > 0 || v.score !== 0)) continue;
    if (v.status === 'won' && (answerGuesses !== 1 || guesses.at(-1)?.word !== v.answer || v.draft !== '')) continue;
    if (v.status === 'lost' && (guesses.length !== 6 || answerGuesses > 0 || v.score !== 0 || v.draft !== '')) continue;
    result[mode] = v as Session;
  }
  return result;
}

export function saveSessions(sessions: Partial<Record<Mode, Session>>) { write(SESSIONS_KEY, sessions); }

export function streakInfo(records: RecordEntry[], today: string) {
  const daily = records.filter(r => r.mode === 'daily').sort((a, b) => b.date.localeCompare(a.date));
  const latest = daily[0];
  if (!latest) return { current: 0, best: 0 };
  const yesterday = addDays(today, -1);
  if (latest.date !== today && latest.date !== yesterday) return { current: 0, best: longestStreak(daily) };
  if (!latest.won) return { current: 0, best: longestStreak(daily) };
  let current = 0;
  let expected = latest.date;
  for (const record of daily) {
    if (record.date !== expected || !record.won) break;
    current++;
    expected = addDays(expected, -1);
  }
  return { current, best: longestStreak(daily) };
}

function longestStreak(daily: RecordEntry[]): number {
  let best = 0, run = 0, previous = '';
  for (const record of [...daily].reverse()) {
    run = record.won ? (previous === addDays(record.date, -1) ? run + 1 : 1) : 0;
    best = Math.max(best, run);
    previous = record.date;
  }
  return best;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

export function recordFinish(profile: Profile, session: Session, date: string): Profile {
  if (session.status === 'playing') return profile;
  if (profile.records.some(r => r.id === session.id)) return profile;
  const records = [...profile.records, { id: session.id, mode: session.mode, date, won: session.status === 'won',
    attempts: session.guesses.length, score: session.score, hints: session.hintsUsed }];
  const streak = streakInfo(records, date).current;
  const milestone = session.mode === 'daily' && session.status === 'won' && [3, 7, 14, 30].includes(streak) ? 50 : 0;
  const xp = profile.xp + (session.status === 'won' ? session.score + milestone : 0);
  return { ...profile, xp, records, bestStreak: Math.max(profile.bestStreak, streak) };
}

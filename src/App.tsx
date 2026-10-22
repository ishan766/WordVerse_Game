import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, BarChart3, BookOpen, Check, ChevronRight, Clock3, Dna, Flame, HelpCircle, Lightbulb, Medal, Moon, RotateCcw, Settings2, Share2, Sparkles, Sun, Target, Trophy, Users, Volume2, VolumeX, X } from 'lucide-react';
import { createSession, dailyAnswer, dailyNumber, keyboardMarks, localDate, shareText, submitGuess, useHint, type Mode, type Session } from './engine';
import { loadProfile, loadSessions, recordFinish, saveProfile, saveSessions, streakInfo, type Profile } from './storage';
import WordDnaView from './WordDnaView';
import Arena from './Arena';

type Dialog = 'help' | 'stats' | 'achievements' | 'settings' | 'result' | 'leaderboard' | 'dna' | null;
type Screen = 'home' | 'game' | 'arena';
type TimeRun = { deadline: number; solved: number; rounds: number; score: number; finished: boolean };

const MODE_INFO: Record<Mode, { title: string; eyebrow: string; description: string; accent: string }> = {
  daily: { title: 'Daily challenge', eyebrow: 'THE SHARED PUZZLE', description: 'One word. One day. Everyone plays the same puzzle.', accent: 'mint' },
  classic: { title: 'Classic play', eyebrow: 'AT YOUR OWN PACE', description: 'A fresh word whenever you want one.', accent: 'cyan' },
  time: { title: 'Time attack', eyebrow: '90 SECONDS ON THE CLOCK', description: 'Solve as many words as you can before time runs out.', accent: 'violet' },
  hard: { title: 'Hard mode', eyebrow: 'EVERY CLUE COUNTS', description: 'Revealed hints must be used in every next guess.', accent: 'gold' },
};

const ACHIEVEMENTS = [
  { icon: '✦', title: 'First light', detail: 'Solve your first puzzle', unlocked: (p: Profile) => p.records.some(r => r.won) },
  { icon: '◈', title: 'Sharp mind', detail: 'Solve in three guesses or fewer', unlocked: (p: Profile) => p.records.some(r => r.won && r.attempts <= 3) },
  { icon: '☼', title: 'Daybreak', detail: 'Win a daily challenge', unlocked: (p: Profile) => p.records.some(r => r.mode === 'daily' && r.won) },
  { icon: '♢', title: 'On a roll', detail: 'Reach a 3-day daily streak', unlocked: (p: Profile) => p.bestStreak >= 3 },
  { icon: '◆', title: 'Untouchable', detail: 'Solve a puzzle without a hint', unlocked: (p: Profile) => p.records.some(r => r.won && r.hints === 0) },
  { icon: '✳', title: 'Word runner', detail: 'Solve a Time Attack word', unlocked: (p: Profile) => p.records.some(r => r.mode === 'time' && r.won) },
];

function Logo({ onClick }: { onClick: () => void }) {
  return <button className="logo" onClick={onClick} aria-label="Wordverse home"><span className="logo-symbol"><span /><span /><span /><span /></span><span>word<span className="logo-highlight">verse</span><span className="logo-period">.</span></span></button>;
}

function GameBoard({ session, animations }: { session: Session; animations: boolean }) {
  return <div className="board" role="grid" aria-label={`Word puzzle, ${session.guesses.length} of 6 guesses made`}>
    {Array.from({ length: 6 }, (_, row) => {
      const guess = session.guesses[row];
      const letters = guess?.word ?? (row === session.guesses.length && session.status === 'playing' ? session.draft : '');
      return <div className={`board-row ${guess && animations ? 'revealed-row' : ''} ${session.status === 'won' && row === session.guesses.length - 1 ? 'winning-row' : ''} ${session.status === 'lost' && row === session.guesses.length - 1 ? 'losing-row' : ''}`} role="row" key={row}>
        {Array.from({ length: 5 }, (_, col) => {
          const mark = guess?.marks[col];
          const isHint = session.hintIndex === col && !guess && row === session.guesses.length;
          return <div role="gridcell" aria-label={guess ? `${guess.word[col]}, ${mark}` : letters[col] ? letters[col] : isHint ? `Hint: ${session.answer[col]}` : 'empty'}
            className={`tile ${mark ?? ''} ${letters[col] ? 'filled' : ''} ${isHint ? 'hint-tile' : ''}`}
            style={animations && guess ? { animationDelay: `${col * 95}ms` } : undefined} key={col}>
            {letters[col] ?? (isHint ? session.answer[col] : '')}
          </div>;
        })}
      </div>;
    })}
  </div>;
}

function Keyboard({ session, onKey }: { session: Session; onKey: (key: string) => void }) {
  const marks = keyboardMarks(session.guesses);
  return <div className="keyboard" aria-label="On-screen keyboard">
    {['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'].map((row, index) => <div className="key-row" key={row}>
      {index === 2 && <button className="key key-wide" onClick={() => onKey('ENTER')} aria-label="Submit guess">ENTER</button>}
      {row.split('').map(letter => <button className={`key ${marks[letter] ?? ''}`} onClick={() => onKey(letter)} aria-label={`${letter}${marks[letter] ? `, ${marks[letter]}` : ''}`} key={letter}>{letter}</button>)}
      {index === 2 && <button className="key key-wide" onClick={() => onKey('BACKSPACE')} aria-label="Delete letter">⌫</button>}
    </div>)}
  </div>;
}

function DialogShell({ title, eyebrow, children, onClose, wide = false }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);
  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') ?? [])];
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className="dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section ref={dialogRef} onKeyDown={trapFocus} className={`dialog ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="dialog-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div><button ref={closeRef} className="icon-button close-button" onClick={onClose} aria-label="Close dialog"><X size={20} /></button></div>
      {children}
    </section>
  </div>;
}

function HowTo({ onClose }: { onClose: () => void }) {
  return <DialogShell title="Find the hidden word" eyebrow="HOW TO PLAY" onClose={onClose}>
    <p className="dialog-intro">You have six tries to find a five-letter word. Each guess must be a real word. The tiles tell you how close you are.</p>
    <div className="example-list">
      <div><div className="mini-row"><span className="correct">W</span><span>O</span><span>R</span><span>D</span><span>S</span></div><p><strong>W</strong> is in the word and in the right spot.</p></div>
      <div><div className="mini-row"><span>P</span><span className="present">L</span><span>A</span><span>N</span><span>T</span></div><p><strong>L</strong> is in the word, but elsewhere.</p></div>
      <div><div className="mini-row"><span>C</span><span>R</span><span className="absent">A</span><span>N</span><span>E</span></div><p><strong>A</strong> is not in the word.</p></div>
    </div>
    <p className="helper-note">A fresh Daily Challenge arrives at your local midnight. Your streak grows with consecutive daily wins; you can miss today and keep yesterday’s streak until tomorrow.</p>
    <button className="button primary full" onClick={onClose}>Got it <ArrowRight size={17} /></button>
  </DialogShell>;
}

function Stats({ profile, today, onClose }: { profile: Profile; today: string; onClose: () => void }) {
  const played = profile.records.length;
  const wins = profile.records.filter(r => r.won);
  const streak = streakInfo(profile.records, today);
  const average = wins.length ? (wins.reduce((sum, r) => sum + r.attempts, 0) / wins.length).toFixed(1) : '—';
  const distribution = [1, 2, 3, 4, 5, 6].map(n => wins.filter(r => r.attempts === n).length);
  const max = Math.max(1, ...distribution);
  return <DialogShell title="Your numbers" eyebrow="THE STORY SO FAR" onClose={onClose}>
    <div className="stats-grid"><Stat value={played} label="Played" /><Stat value={`${played ? Math.round(wins.length / played * 100) : 0}%`} label="Win rate" /><Stat value={average} label="Avg. guesses" /><Stat value={streak.current} label="Daily streak" /></div>
    <div className="section-heading"><span>GUESS DISTRIBUTION</span><span>{wins.length} WINS</span></div>
    <div className="distribution">{distribution.map((count, i) => <div className="distribution-row" key={i}><span>{i + 1}</span><div className="bar-track"><div style={{ width: `${Math.max(count ? 9 : 0, count / max * 100)}%` }} /></div><b>{count}</b></div>)}</div>
    <div className="stats-foot"><Flame size={18} /> Best daily streak <strong>{Math.max(profile.bestStreak, streak.best)} days</strong></div>
  </DialogShell>;
}

function Stat({ value, label }: { value: string | number; label: string }) { return <div className="stat"><strong>{value}</strong><span>{label}</span></div>; }

function AchievementPanel({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const unlocked = ACHIEVEMENTS.filter(a => a.unlocked(profile)).length;
  return <DialogShell title="The constellation" eyebrow={`${unlocked} OF ${ACHIEVEMENTS.length} UNLOCKED`} onClose={onClose}>
    <p className="dialog-intro">Every word found leaves a little light behind.</p>
    <div className="achievement-list">{ACHIEVEMENTS.map(a => <div className={`achievement ${a.unlocked(profile) ? 'unlocked' : ''}`} key={a.title}><span className="achievement-icon">{a.icon}</span><div><strong>{a.title}</strong><small>{a.detail}</small></div><span className="achievement-status">{a.unlocked(profile) ? <Check size={18} /> : 'LOCKED'}</span></div>)}</div>
  </DialogShell>;
}

function SettingsPanel({ profile, onChange, onClose }: { profile: Profile; onChange: (profile: Profile) => void; onClose: () => void }) {
  const s = profile.settings;
  const toggle = (key: 'sound' | 'animations' | 'highContrast') => onChange({ ...profile, settings: { ...s, [key]: !s[key] } });
  return <DialogShell title="Make it yours" eyebrow="PREFERENCES" onClose={onClose}>
    <div className="setting-list">
      <button className="setting-row" role="switch" aria-checked={s.sound} onClick={() => toggle('sound')}><span className="setting-icon">{s.sound ? <Volume2 size={19} /> : <VolumeX size={19} />}</span><span><strong>Sound effects</strong><small>Quiet by default. Tap to enable.</small></span><span className={`switch ${s.sound ? 'on' : ''}`} /></button>
      <button className="setting-row" role="switch" aria-checked={s.animations} onClick={() => toggle('animations')}><span className="setting-icon"><Sparkles size={19} /></span><span><strong>Animations</strong><small>Tile flips and small celebrations.</small></span><span className={`switch ${s.animations ? 'on' : ''}`} /></button>
      <button className="setting-row" role="switch" aria-checked={s.highContrast} onClick={() => toggle('highContrast')}><span className="setting-icon"><Target size={19} /></span><span><strong>High contrast</strong><small>Stronger outlines and tile colors.</small></span><span className={`switch ${s.highContrast ? 'on' : ''}`} /></button>
      <button className="setting-row" role="switch" aria-label="Midnight theme" aria-checked={s.theme === 'dark'} onClick={() => onChange({ ...profile, settings: { ...s, theme: s.theme === 'dark' ? 'light' : 'dark', themeSelected: true } })}><span className="setting-icon">{s.theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}</span><span><strong>Appearance</strong><small>{s.theme === 'dark' ? 'Midnight' : 'Daylight'} theme selected</small></span><span className="setting-value">SWITCH TO {s.theme === 'dark' ? 'DAYLIGHT' : 'MIDNIGHT'}</span></button>
    </div>
    <p className="helper-note">Progress is stored only in this browser. Sound never plays unless you turn it on.</p>
  </DialogShell>;
}

function Leaderboard({ profile, today, onClose }: { profile: Profile; today: string; onClose: () => void }) {
  const scores = profile.records.filter(r => r.mode === 'daily' && r.won).sort((a, b) => b.score - a.score || a.attempts - b.attempts).slice(0, 10);
  return <DialogShell title="Daily hall of fame" eyebrow="LOCAL LEADERBOARD" onClose={onClose}>
    <p className="dialog-intro">Your best daily scores on this device. A future online leaderboard could use the same scoring rules.</p>
    {scores.length ? <div className="leader-list">{scores.map((r, i) => <div className="leader-row" key={r.id}><span className="leader-rank">{String(i + 1).padStart(2, '0')}</span><span><strong>{r.date === today ? 'Today' : r.date}</strong><small>{r.attempts} guesses · {r.hints ? 'hint used' : 'no hint'}</small></span><b>{r.score}</b></div>)}</div> : <div className="empty-state"><Trophy size={28} /><strong>Your story starts today.</strong><span>Finish a Daily Challenge to claim the first spot.</span></div>}
  </DialogShell>;
}

function Result({ session, streak, onClose, onShare, onAgain, onDna }: { session: Session; streak: number; onClose: () => void; onShare: () => void; onAgain: () => void; onDna: () => void }) {
  const won = session.status === 'won';
  return <DialogShell title={won ? 'A word well found.' : 'The word lives on.'} eyebrow={won ? 'PUZZLE COMPLETE' : 'KEEP YOUR CURIOSITY'} onClose={onClose}>
    <div className={`result-orbit ${won ? 'won' : 'lost'}`}>{won ? <Sparkles size={32} /> : <BookOpen size={30} />}</div>
    <p className="result-copy">{won ? `You uncovered ${session.answer} in ${session.guesses.length} ${session.guesses.length === 1 ? 'guess' : 'guesses'}.` : `The word was ${session.answer}. Every attempt teaches you something.`}</p>
    <div className="result-stats"><Stat value={won ? session.score : '—'} label="Points" /><Stat value={session.guesses.length} label="Guesses" /><Stat value={session.mode === 'daily' ? streak : session.hintsUsed} label={session.mode === 'daily' ? 'Daily streak' : 'Hints used'} /></div>
    {session.hintsUsed > 0 && <p className="hint-cost">Hint used · 35-point score reduction</p>}
    <button className="button primary full result-dna-button" onClick={onDna}><Dna size={18} /> REVEAL YOUR WORD DNA <ArrowRight size={16} /></button>
    <div className="result-actions"><button className="button secondary" onClick={onShare}><Share2 size={17} /> Share result</button>{session.mode !== 'daily' && <button className="button secondary" onClick={onAgain}><RotateCcw size={16} /> Play again</button>}</div>
  </DialogShell>;
}

function playSound(kind: 'key' | 'success' | 'error') {
  try {
    const Audio = window.AudioContext;
    const ctx = new Audio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = kind === 'success' ? 660 : kind === 'error' ? 180 : 410;
    gain.gain.setValueAtTime(0.035, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (kind === 'success' ? 0.25 : 0.06));
    osc.connect(gain).connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + (kind === 'success' ? 0.25 : 0.06));
    osc.onended = () => void ctx.close();
  } catch { /* Audio is optional. */ }
}

export default function App() {
  const [profile, setProfile] = useState(loadProfile);
  const [sessions, setSessions] = useState(loadSessions);
  const sessionsRef = useRef(sessions);
  const updateSessions = useCallback((change: (current: Partial<Record<Mode, Session>>) => Partial<Record<Mode, Session>>) => {
    const next = change(sessionsRef.current);
    sessionsRef.current = next;
    setSessions(next);
  }, []);
  const [screen, setScreen] = useState<Screen>(() => new URLSearchParams(location.search).has('room') ? 'arena' : 'home');
  const [mode, setMode] = useState<Mode>('daily');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState('');
  const [today, setToday] = useState(localDate);
  const [timeRun, setTimeRun] = useState<TimeRun | null>(null);
  const [now, setNow] = useState(Date.now());
  const toastTimer = useRef<number | undefined>(undefined);
  const session = sessions[mode];
  const streak = streakInfo(profile.records, today);
  const level = Math.floor(profile.xp / 500) + 1;
  const levelProgress = profile.xp % 500;
  const todayCompleted = profile.records.some(r => r.id === `daily-v1-${today}`);
  const motion = profile.settings.animations;

  useEffect(() => { saveProfile(profile); }, [profile]);
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', profile.settings.theme === 'dark' ? '#080b14' : '#f4f6fb');
  }, [profile.settings.theme]);
  useEffect(() => { saveSessions(sessions); }, [sessions]);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(previous => {
      const current = localDate();
      return previous === current ? previous : current;
    }), 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (screen !== 'game' || mode !== 'time' || !timeRun || timeRun.finished) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [screen, mode, timeRun?.deadline, timeRun?.finished]);
  useEffect(() => {
    if (timeRun && !timeRun.finished && now >= timeRun.deadline) setTimeRun(r => r ? { ...r, finished: true } : r);
  }, [now, timeRun]);
  useEffect(() => {
    const daily = sessions.daily;
    if (daily && (daily.id !== `daily-v1-${today}` || daily.answer !== dailyAnswer(today).toUpperCase())) updateSessions(s => ({ ...s, daily: createSession('daily', today) }));
  }, [today, sessions.daily, updateSessions]);

  const announce = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 3000);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const startMode = useCallback((selected: Mode) => {
    if (selected === 'daily' && profile.records.some(r => r.id === `daily-v1-${today}`)) {
      const saved = sessionsRef.current.daily;
      if (!saved || saved.id !== `daily-v1-${today}` || saved.status === 'playing') {
        announce("Today's challenge is complete, but its saved board is unavailable in this browser.");
        return;
      }
    }
    setMode(selected); setScreen('game'); setDialog(null);
    if (selected === 'daily') {
      const existing = sessionsRef.current.daily;
      if (!existing || existing.id !== `daily-v1-${today}` || existing.answer !== dailyAnswer(today).toUpperCase())
        updateSessions(s => ({ ...s, daily: createSession('daily', today) }));
    } else if (selected === 'time') {
      updateSessions(s => ({ ...s, time: createSession('time') }));
      setTimeRun({ deadline: Date.now() + 90000, solved: 0, rounds: 0, score: 0, finished: false });
      setNow(Date.now());
    } else if (!sessionsRef.current[selected]) updateSessions(s => ({ ...s, [selected]: createSession(selected) }));
  }, [today, updateSessions, profile.records, announce]);

  const goHome = () => {
    setScreen('home'); setDialog(null); setTimeRun(null);
    if (location.search) history.replaceState(null, '', location.pathname);
  };

  const finishRound = useCallback((finished: Session) => {
    setProfile(p => recordFinish(p, finished, localDate()));
    if (finished.mode === 'time') {
      setTimeRun(r => r ? { ...r, rounds: r.rounds + 1, solved: r.solved + (finished.status === 'won' ? 1 : 0), score: r.score + finished.score } : r);
    } else setDialog('result');
  }, []);

  const handleKey = useCallback((key: string) => {
    const s = sessionsRef.current[mode];
    if (screen !== 'game' || dialog || !s || s.status !== 'playing' ||
      (mode === 'time' && (!timeRun || timeRun.finished || Date.now() >= timeRun.deadline))) return;
    if (key === 'ENTER') {
      const outcome = submitGuess(s);
      if (outcome.error) { announce(outcome.error); if (profile.settings.sound) playSound('error'); return; }
      if (outcome.session !== s) {
        updateSessions(prev => ({ ...prev, [mode]: outcome.session }));
        if (profile.settings.sound) playSound(outcome.session.status === 'won' ? 'success' : 'key');
        if (outcome.session.status !== 'playing') finishRound(outcome.session);
      }
    } else if (key === 'BACKSPACE') {
      updateSessions(prev => ({ ...prev, [mode]: { ...s, draft: s.draft.slice(0, -1) } }));
      if (profile.settings.sound) playSound('key');
    } else if (/^[A-Z]$/.test(key) && s.draft.length < 5) {
      updateSessions(prev => ({ ...prev, [mode]: { ...s, draft: s.draft + key } }));
      if (profile.settings.sound) playSound('key');
    }
  }, [mode, screen, dialog, timeRun, profile.settings.sound, announce, finishRound, updateSessions]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setDialog(null); return; }
      if (screen === 'arena') return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
      const key = event.key === 'Backspace' ? 'BACKSPACE' : event.key === 'Enter' ? 'ENTER' : event.key.toUpperCase();
      if (key === 'BACKSPACE' || key === 'ENTER' || /^[A-Z]$/.test(key)) { event.preventDefault(); handleKey(key); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleKey]);

  const nextRound = () => {
    if (mode === 'time') {
      if (!timeRun || timeRun.finished || Date.now() >= timeRun.deadline) return;
      updateSessions(s => ({ ...s, time: createSession('time') }));
    } else updateSessions(s => ({ ...s, [mode]: createSession(mode) }));
    setDialog(null);
  };

  const hint = () => {
    if (!session) return;
    if (mode === 'time' && (!timeRun || timeRun.finished || Date.now() >= timeRun.deadline)) return;
    const outcome = useHint(session);
    if (outcome.error) announce(outcome.error);
    else { updateSessions(s => ({ ...s, [mode]: outcome.session })); announce(`Position ${outcome.session.hintIndex! + 1} revealed · −35 points if solved`); }
  };

  const share = async () => {
    if (!session) return;
    const text = shareText(session);
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); announce('Result copied to clipboard'); }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        try { await navigator.clipboard.writeText(text); announce('Result copied to clipboard'); }
        catch { announce('Sharing is unavailable in this browser'); }
      }
    }
  };

  const timeLeft = timeRun ? Math.max(0, Math.ceil((timeRun.deadline - now) / 1000)) : 90;
  const unlockedCount = ACHIEVEMENTS.filter(a => a.unlocked(profile)).length;
  const dailyLabel = useMemo(() => `#${dailyNumber(today)}`, [today]);

  return <div className={`app theme-${profile.settings.theme} ${profile.settings.highContrast ? 'high-contrast' : ''} ${motion ? '' : 'no-motion'}`}>
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <header className="site-header" inert={dialog !== null}><div className="header-inner"><Logo onClick={goHome} /><nav aria-label="Main navigation"><button onClick={() => setScreen('arena')} aria-label="Wordverse Arena"><Users size={19} /><span>Arena</span></button><button onClick={() => setDialog('help')} aria-label="How to play"><HelpCircle size={19} /><span>How to play</span></button><button onClick={() => setDialog('stats')} aria-label="Statistics"><BarChart3 size={19} /><span>Stats</span></button><button onClick={() => setDialog('settings')} aria-label="Settings"><Settings2 size={19} /><span>Settings</span></button></nav></div></header>

    {screen === 'home' ? <main className="home-main" inert={dialog !== null}>
      <section className="hero"><div className="hero-copy"><div className="hero-overline"><span className="pulse-dot" /> A NEW WORD AWAITS</div><h1>Words are<br /><em>little worlds.</em></h1><p>Discover hidden words. Decode the clues. Every guess takes you somewhere new.</p><div className="hero-actions"><button className="button primary hero-primary" onClick={() => startMode('daily')}>{todayCompleted ? 'View today’s puzzle' : 'Play today’s puzzle'} <ArrowRight size={20} /></button><button className="button text-button" onClick={() => startMode('classic')}>Play classic <ChevronRight size={18} /></button></div><div className="hero-footnote"><span>DAILY PUZZLE {dailyLabel}</span><span className="footnote-separator" /> <span>{new Date(`${today}T00:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</span><span className="footnote-separator" /><span className={todayCompleted ? 'daily-status completed' : 'daily-status'}>{todayCompleted ? 'COMPLETED' : 'READY TO PLAY'}</span></div></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="art-glow" /><div className="art-tile art-tile-1">W</div><div className="art-tile art-tile-2">O</div><div className="art-tile art-tile-3">R</div><div className="art-tile art-tile-4">D</div><div className="art-tile art-tile-5">S</div><div className="art-spark art-spark-1">✦</div><div className="art-spark art-spark-2">✦</div><div className="art-caption">ONE LETTER CAN CHANGE EVERYTHING</div></div></section>
      <section className="home-lower"><div className="modes-section"><div className="section-title"><div><span className="eyebrow">PICK YOUR PATH</span><h2>Four ways to play.</h2></div><span className="section-index">01 / EXPLORE</span></div><div className="mode-grid">{(['daily', 'classic', 'time', 'hard'] as const).map((m, i) => <button className={`mode-card mode-${m}`} key={m} onClick={() => startMode(m)}><span className="mode-card-top"><span className="mode-icon">{m === 'daily' ? <Sun size={23} /> : m === 'classic' ? <Target size={23} /> : m === 'time' ? <Clock3 size={23} /> : <Sparkles size={23} />}</span><span className="mode-number">0{i + 1}</span></span><span className="mode-name">{MODE_INFO[m].title}</span><span className="mode-description">{MODE_INFO[m].description}</span><span className="mode-link">{m === 'daily' && todayCompleted ? 'COMPLETED · VIEW PUZZLE' : 'PLAY MODE'} <ArrowRight size={17} /></span></button>)}</div></div><aside className="progress-panel"><span className="eyebrow">YOUR JOURNEY</span><div className="progress-level"><span>LEVEL</span><strong>{String(level).padStart(2, '0')}</strong></div><div className="xp-track"><div style={{ width: `${levelProgress / 5}%` }} /></div><div className="xp-caption"><span>{levelProgress} / 500 XP</span><span>NEXT LEVEL</span></div><div className="progress-divider" /><div className="progress-metrics"><div><Flame size={20} /><strong>{streak.current}</strong><span>DAY STREAK</span></div><div><Trophy size={20} /><strong>{profile.records.filter(r => r.won).length}</strong><span>WORDS FOUND</span></div>{unlockedCount > 0 && <div className="progress-milestone"><Sparkles size={15} /><span>ACHIEVEMENT UNLOCKED</span><strong>{ACHIEVEMENTS.filter(a => a.unlocked(profile)).at(-1)?.title}</strong></div>}</div><button className="progress-link" onClick={() => setDialog('achievements')}>View achievements <ArrowRight size={17} /></button></aside></section>
      <section className="arena-home-entry"><div><span className="eyebrow">NEW · LIVE MULTIPLAYER</span><h2>Wordverse Arena</h2><p>Same word, separate boards, one live race. Create a private room for two, three or four players.</p></div><button className="button primary" onClick={() => setScreen('arena')}><Users size={18} /> Enter Arena <ArrowRight size={18} /></button></section>
      <footer className="home-footer"><span>ONE WORD AT A TIME, A WHOLE UNIVERSE OPENS.</span><button onClick={() => setDialog('leaderboard')}>Local daily leaderboard <ArrowRight size={15} /></button></footer>
    </main> : screen === 'arena' ? <Arena onHome={goHome} onSolo={() => startMode('classic')} /> : <main className="game-main" inert={dialog !== null}>
      <div className="game-topline"><button className="back-link" onClick={goHome}><ArrowLeft size={18} /> All modes</button><span className="game-topline-right">{mode === 'daily' ? `DAILY ${dailyLabel}` : MODE_INFO[mode].eyebrow}</span></div>
      <section className="game-layout"><div className="game-content"><div className="game-heading"><div><span className="eyebrow"><span className="pulse-dot" /> {MODE_INFO[mode].eyebrow}</span><h1>{MODE_INFO[mode].title}<span className="heading-period">.</span></h1><p>{MODE_INFO[mode].description}</p></div>{mode === 'time' && <div className={`timer ${timeLeft <= 15 ? 'timer-urgent' : ''}`}><Clock3 size={20} /><strong>{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}</strong></div>}</div>
        {session && <><div className="board-wrap"><GameBoard session={session} animations={motion} /></div><div className="game-message" aria-live="polite">{mode === 'time' && timeRun?.finished ? `Time's up · ${timeRun.solved} ${timeRun.solved === 1 ? 'word' : 'words'} solved · ${timeRun.score} points` : session.status === 'playing' ? `GUESS ${session.guesses.length + 1} OF 6` : session.status === 'won' ? 'WORD FOUND · BEAUTIFULLY DONE' : `THE WORD WAS ${session.answer}`}</div>
          {mode === 'time' && timeRun?.finished ? <div className="round-actions"><button className="button primary" onClick={() => startMode('time')}>Try again <RotateCcw size={17} /></button>{session.status !== 'playing' && <button className="button secondary" onClick={() => setDialog('dna')}><Dna size={16} /> Reveal your Word DNA</button>}<button className="button secondary" onClick={goHome}>All modes</button></div> : session.status === 'playing' ? <Keyboard session={session} onKey={handleKey} /> : mode === 'time' ? <div className="round-actions"><span>{session.status === 'won' ? `+${session.score} points` : `Answer: ${session.answer}`}</span><button className="button primary" onClick={() => setDialog('dna')}><Dna size={16} /> Reveal your Word DNA</button><button className="button secondary" onClick={nextRound}>Next word <ArrowRight size={17} /></button></div> : <div className="round-actions"><button className="button primary" onClick={() => setDialog('result')}>View result <ArrowRight size={17} /></button><button className="button secondary" onClick={() => setDialog('dna')}><Dna size={16} /> Reveal your Word DNA</button>{mode !== 'daily' && <button className="button secondary" onClick={nextRound}>New word <RotateCcw size={17} /></button>}</div>}
        </>}
      </div><aside className="game-sidebar"><div className="side-card side-progress"><span className="eyebrow">YOUR PROGRESS</span><div className="side-level"><span>LEVEL {String(level).padStart(2, '0')}</span><span>{levelProgress} / 500 XP</span></div><div className="xp-track"><div style={{ width: `${levelProgress / 5}%` }} /></div><div className="side-metrics"><span><Flame size={16} /> {streak.current} day streak</span><span><Medal size={16} /> {unlockedCount}/{ACHIEVEMENTS.length} badges</span></div></div><div className="side-card side-tip"><span className="eyebrow">A LITTLE HELP</span><div className="side-tip-icon"><Lightbulb size={22} /></div><h3>Need a nudge?</h3><p>Reveal one letter’s position. A hint lowers your winning score by 35 points.</p><button className="button secondary full" onClick={hint} disabled={!session || session.status !== 'playing' || !!session.hintsUsed || (mode === 'time' && !!timeRun?.finished)}>Use a hint <ArrowRight size={16} /></button><small>{session?.hintsUsed ? 'Hint used for this word' : 'One hint available per word'}</small></div><button className="side-leader-link" onClick={() => setDialog('leaderboard')}><Trophy size={18} /> Local daily leaderboard <ArrowRight size={16} /></button></aside></section>
    </main>}

    {toast && <div className="toast" role="status">{toast}</div>}
    {dialog === 'help' && <HowTo onClose={() => setDialog(null)} />}
    {dialog === 'stats' && <Stats profile={profile} today={today} onClose={() => setDialog(null)} />}
    {dialog === 'achievements' && <AchievementPanel profile={profile} onClose={() => setDialog(null)} />}
    {dialog === 'settings' && <SettingsPanel profile={profile} onChange={setProfile} onClose={() => setDialog(null)} />}
    {dialog === 'leaderboard' && <Leaderboard profile={profile} today={today} onClose={() => setDialog(null)} />}
    {dialog === 'result' && session && <Result session={session} streak={streak.current} onClose={() => setDialog(null)} onShare={share} onAgain={nextRound} onDna={() => setDialog('dna')} />}
    {dialog === 'dna' && session && session.status !== 'playing' && <DialogShell title="Your Word DNA" eyebrow="POST-GAME ANALYSIS" wide onClose={() => setDialog(null)}><WordDnaView session={session} announce={announce} /></DialogShell>}
  </div>;
}

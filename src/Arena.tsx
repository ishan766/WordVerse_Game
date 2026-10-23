import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { ArrowLeft, ArrowRight, Copy, Dna, Link2, Medal, Radio, RotateCcw, Send, Trophy, Users, X } from 'lucide-react';
import { keyboardMarks, type Session } from './engine';
import { TOURNAMENT_ROUNDS, arenaShareText, type ArenaAction, type ArenaPlayer, type ArenaReply, type ArenaSettings, type ArenaView } from './arenaProtocol';
import WordDnaView from './WordDnaView';
import './arena.css';

const STORE = 'wordverse-arena-session-v1';
const url = import.meta.env.VITE_ARENA_URL || (import.meta.env.DEV ? `http://${location.hostname}:3001` : '');
const connectionError = 'Arena server is unavailable right now. Retrying automatically…';
const rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
function savedSession(): { code: string; token: string } | null {
  try { const value = JSON.parse(sessionStorage.getItem(STORE) || 'null'); return typeof value?.code === 'string' && typeof value?.token === 'string' ? value : null; } catch { return null; }
}
function saveSession(code: string, token: string) { try { sessionStorage.setItem(STORE, JSON.stringify({ code, token })); } catch { /* Reconnect unavailable if storage is blocked. */ } }
function clearSession() { try { sessionStorage.removeItem(STORE); } catch { /* Storage may be blocked. */ } }
function seconds(ms?: number) { return ms === undefined ? '—' : `${(ms / 1000).toFixed(1)}s`; }
function outcome(player: ArenaPlayer) { return player.status === 'solved' ? 'Solved' : player.status === 'failed' ? 'Failed' : 'Timed out'; }

function Leaderboard({ view, results = false }: { view: ArenaView; results?: boolean }) {
  const ordered = [...view.players].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return <section className="arena-panel arena-leaderboard" aria-label={results ? 'Tournament standings' : 'Live leaderboard'}>
    <div className="arena-leaderboard-heading"><div><span className="eyebrow">SERVER-RANKED</span><h2>{results ? 'Standings' : 'Live leaderboard'}</h2></div><span className="arena-round-chip">ROUND {view.round} / {TOURNAMENT_ROUNDS}</span></div>
    <div className="arena-rank-list">{ordered.map(player => {
      const medal = !player.tie && player.rank <= 3 ? (['Gold', 'Silver', 'Bronze'] as const)[player.rank - 1] : null;
      return <div key={player.id} className={`arena-rank ${medal ? `arena-rank-${medal.toLowerCase()}` : ''} ${player.tie ? 'arena-rank-tie' : ''}`}>
        <div className="arena-rank-place">{medal ? <Medal size={19} aria-hidden="true" /> : <span>#{player.rank}</span>}<small>{player.tie ? `TIED #${player.rank}` : medal ? `${medal.toUpperCase()} · #${player.rank}` : `RANK ${player.rank}`}</small></div>
        <div className="arena-rank-name"><strong>{player.name}{player.id === view.selfId ? ' · YOU' : ''}</strong><span>{player.connected ? (results ? outcome(player) : player.status === 'active' ? 'Solving' : player.status) : 'Reconnecting'} · {player.attempts}/6 guesses · {player.wordsSolved} solved</span></div>
        <div className="arena-rank-score"><strong>{player.totalPoints} <small>PTS</small></strong><span>+{player.roundPoints} this round</span></div>
        {results && <div className="arena-rank-details"><span>Round: {player.status === 'solved' ? `Solved in ${player.attempts}` : outcome(player)}</span><span>Solve time: {seconds(player.solveMs)}</span><span>Total guesses: {player.totalGuesses}</span></div>}
      </div>;
    })}</div>
  </section>;
}

export default function Arena({ onHome, onSolo }: { onHome: () => void; onSolo: () => void }) {
  const [view, setView] = useState<ArenaView | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState(new URLSearchParams(location.search).get('room')?.toUpperCase() || '');
  const [settings, setSettings] = useState<ArenaSettings>({ capacity: 2, duration: 180, difficulty: 'standard' });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [showDna, setShowDna] = useState(false);
  const socket = useRef<Socket | null>(null);
  const busyRef = useRef(false);
  const viewRef = useRef<ArenaView | null>(null);
  const serverOffset = useRef(0);
  const dnaClose = useRef<HTMLButtonElement>(null);
  const acceptView = useCallback((next: ArenaView) => { serverOffset.current = next.serverNow - Date.now(); setView(next); viewRef.current = next; }, []);
  const send = useCallback(async (action: ArenaAction) => {
    const s = socket.current;
    if (!s?.connected || busyRef.current) { setMessage(s?.connected ? 'Please wait for the previous action.' : 'Connecting to Arena…'); return; }
    busyRef.current = true; setBusy(true); setMessage('');
    try {
      const reply = await s.timeout(5000).emitWithAck('arena:action', action) as ArenaReply;
      if (!reply.ok) { setMessage(reply.error); return; }
      if (reply.view) acceptView(reply.view);
      if (reply.token && reply.view) saveSession(reply.view.code, reply.token);
      if (action.type === 'guess') setDraft('');
      if (action.type === 'leave') { clearSession(); setView(null); viewRef.current = null; history.replaceState(null, '', location.pathname); }
    } catch { setMessage('The server did not respond. Please retry.'); }
    finally { busyRef.current = false; setBusy(false); }
  }, [acceptView]);
  useEffect(() => {
    if (!url) { setConnection('offline'); setMessage('Arena server URL is not configured for this deployment.'); return; }
    const s = io(url, { autoConnect: true, reconnection: true }); socket.current = s;
    s.on('connect', () => {
      setConnection('online'); setMessage(previous => previous === connectionError ? '' : previous);
      const saved = savedSession(), inviteCode = new URLSearchParams(location.search).get('room')?.toUpperCase();
      if (saved && (!inviteCode || saved.code === inviteCode)) s.timeout(5000).emitWithAck('arena:action', { type: 'resume', ...saved }).then((reply: ArenaReply) => {
        if (reply.ok && reply.view) { acceptView(reply.view); setMessage('Reconnected to your tournament.'); }
        else { clearSession(); setView(null); viewRef.current = null; setMessage(reply.ok ? '' : reply.error); }
      }).catch(() => setMessage('Could not restore your room.'));
    });
    s.on('disconnect', () => setConnection('offline'));
    s.on('connect_error', () => { setConnection('offline'); setMessage(connectionError); });
    s.on('arena:state', acceptView);
    return () => { s.removeAllListeners(); s.disconnect(); socket.current = null; };
  }, [acceptView]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, []);
  useEffect(() => { setDraft(''); setShowDna(false); }, [view?.roundId]);
  useEffect(() => {
    if (!showDna) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dnaClose.current?.focus(); return () => previous?.focus();
  }, [showDna]);
  useEffect(() => { if (view?.code) history.replaceState(null, '', `${location.pathname}?room=${view.code}`); }, [view?.code]);
  const onKey = useCallback((key: string) => {
    const v = viewRef.current;
    if (showDna || !v || v.status !== 'playing' || v.players.find(p => p.id === v.selfId)?.status !== 'active' || busyRef.current) return;
    if (key === 'BACKSPACE') setDraft(x => x.slice(0, -1));
    else if (key === 'ENTER') { if (draft.length === 5 && v.roundId) void send({ type: 'guess', word: draft, sequence: v.ownGuesses.length + 1, roundId: v.roundId }); else setMessage('Enter a five-letter word.'); }
    else if (/^[A-Z]$/.test(key)) setDraft(x => x.length < 5 ? x + key : x);
  }, [draft, send, showDna]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (showDna && event.key === 'Escape') { setShowDna(false); return; }
      if (showDna || event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
      const key = event.key === 'Backspace' ? 'BACKSPACE' : event.key === 'Enter' ? 'ENTER' : event.key.toUpperCase();
      if (key === 'BACKSPACE' || key === 'ENTER' || /^[A-Z]$/.test(key)) { event.preventDefault(); onKey(key); }
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, [onKey, showDna]);

  const self = view?.players.find(p => p.id === view.selfId);
  const remaining = view?.deadline ? Math.max(0, Math.ceil((view.deadline - (now + serverOffset.current)) / 1000)) : 0;
  const marks = keyboardMarks(view?.ownGuesses ?? []);
  const resolved = view?.status === 'round_results' || view?.status === 'finished';
  const analysisSession = useMemo<Session | null>(() => resolved && view?.answer ? {
    id: `arena-${view.roundId}`, mode: 'classic', answer: view.answer, guesses: view.ownGuesses, draft: '',
    status: self?.status === 'solved' ? 'won' : 'lost', hintIndex: null, hintsUsed: 0, score: self?.roundPoints ?? 0,
    startedAt: view.startedAt ?? 0, endedAt: view.deadline, answerListVersion: 1,
  } : null, [resolved, view, self]);
  const invite = view ? `${location.origin}${location.pathname}?room=${view.code}` : '';
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setMessage('Copied to clipboard.'); } catch { setMessage('Clipboard unavailable. Select and copy the code instead.'); } };
  const share = async () => { if (!view) return; try { if (navigator.share) await navigator.share({ title: 'WORDVERSE Arena', url: invite }); else await copy(invite); } catch (error) { if ((error as Error).name !== 'AbortError') setMessage('Sharing unavailable. Copy the invite link instead.'); } };
  const resultText = view ? arenaShareText(view, invite) : '';
  const shareResults = async () => { try { if (navigator.share) await navigator.share({ text: resultText }); else await copy(resultText); } catch (error) { if ((error as Error).name !== 'AbortError') await copy(resultText); } };

  return <main className="arena-main">
    <div className="arena-top"><button className="back-link" onClick={onHome}><ArrowLeft size={18} /> All modes</button><span className="arena-live"><Radio size={15} /> {connection === 'online' ? 'LIVE' : connection === 'connecting' ? 'CONNECTING' : 'OFFLINE'}</span></div>
    <div className="arena-heading"><span className="eyebrow">WORDVERSE / LIVE PLAY</span><h1>Wordverse <em>Arena.</em></h1><p>Five words. One leaderboard. Solve independently and climb the standings together.</p></div>
    {message && <div className="arena-message" role="status">{message}</div>}
    {view && connection !== 'online' && <div className="arena-message" role="status">Connection lost. Your tournament is saved on the server while this room is active. Reconnecting…</div>}
    {!view && <div className="arena-entry"><section className="arena-panel"><span className="eyebrow">PLAY TOGETHER</span><h2>Create a tournament</h2><p>Invite friends to five live rounds. Everyone solves the same word independently.</p>
      <label>Your display name<input maxLength={18} value={name} onChange={event => setName(event.target.value)} placeholder="Your name" /></label>
      <div className="arena-fields"><label>Players<select value={settings.capacity} onChange={event => setSettings({ ...settings, capacity: Number(event.target.value) as ArenaSettings['capacity'] })}><option value={2}>2 · Head-to-Head</option><option value={3}>3 · Triple Threat</option><option value={4}>4 · Four-Player Arena</option><option value={5}>5 · Five-Player Arena</option><option value={6}>6 · Six-Player Arena</option></select></label><label>Round length<select value={settings.duration} onChange={event => setSettings({ ...settings, duration: Number(event.target.value) as ArenaSettings['duration'] })}><option value={90}>90 seconds</option><option value={180}>3 minutes</option><option value={300}>5 minutes</option></select></label></div>
      <label>Difficulty<select value={settings.difficulty} onChange={event => setSettings({ ...settings, difficulty: event.target.value as ArenaSettings['difficulty'] })}><option value="standard">Standard</option><option value="hard">Hard · use all revealed clues</option></select></label>
      <p className="arena-rules">Five rounds · Six guesses per word · 100 solve points + up to 50 speed points + 10 per unused guess. First-guess maximum: 200. All selected players must join and be ready.</p>
      <button className="button primary" disabled={busy || connection !== 'online'} onClick={() => void send({ type: 'create', name, settings })}>Create room <ArrowRight size={17} /></button>
    </section><section className="arena-panel"><span className="eyebrow">HAVE AN INVITE?</span><h2>Join a room</h2><p>Enter your seven-character code and choose a display name.</p><label>Room code<input maxLength={7} value={code} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="ABCDEFG" autoCapitalize="characters" /></label><label>Your display name<input maxLength={18} value={name} onChange={event => setName(event.target.value)} placeholder="Your name" /></label><button className="button secondary" disabled={busy || connection !== 'online'} onClick={() => void send({ type: 'join', code, name })}>Join room <ArrowRight size={17} /></button></section></div>}
    {view?.status === 'lobby' && <div className="arena-lobby"><div className="arena-panel arena-room-code"><span className="eyebrow">PRIVATE TOURNAMENT</span><strong>{view.code}</strong><div className="arena-actions"><button className="button secondary" onClick={() => void copy(view.code)}><Copy size={16} /> Copy code</button><button className="button secondary" onClick={() => void share()}><Link2 size={16} /> Share invite</button></div><p>{view.players.length}/{view.settings.capacity} players · Five rounds · {view.settings.duration}s each · {view.settings.difficulty === 'hard' ? 'Hard' : 'Standard'} rules</p><p className="arena-rules">Points: 100 for a solve, up to 50 for time remaining, and 10 per unused guess. Ranking: total points, words solved, fewer guesses, then faster combined solve time. Exact ties share a rank.</p></div><div className="arena-panel"><span className="eyebrow">THE CONTENDERS</span><h2>Waiting room</h2><div className="arena-players">{view.players.map(player => <div className="arena-player" key={player.id}><span className="arena-avatar">{player.name.slice(0, 1).toUpperCase()}</span><strong>{player.name}{player.id === view.selfId ? ' (you)' : ''}</strong><small>{!player.connected ? 'DISCONNECTED' : player.host ? 'HOST · READY' : player.status.toUpperCase()}</small></div>)}</div><p>All {view.settings.capacity} players must be connected and ready before the host starts.</p><div className="arena-actions">{!self?.host && <button className="button primary" disabled={busy || connection !== 'online'} onClick={() => void send({ type: 'ready', ready: self?.status !== 'ready' })}>{self?.status === 'ready' ? 'Cancel ready' : 'I’m ready'}</button>}{self?.host && <button className="button primary" disabled={busy || connection !== 'online' || view.players.length !== view.settings.capacity || view.players.some(player => !player.connected || player.status !== 'ready')} onClick={() => void send({ type: 'start' })}>Start tournament <ArrowRight size={17} /></button>}<button className="button secondary" onClick={() => void send({ type: 'leave' })}>Leave room</button></div></div></div>}
    {view?.status === 'playing' && <div className="arena-match"><Leaderboard view={view} /><div className="arena-panel arena-board-panel"><div className="arena-board-header"><span className="arena-round-chip">ROUND {view.round} / {TOURNAMENT_ROUNDS}</span><strong aria-label={`${remaining} seconds remaining`}>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</strong></div><div className="arena-board" aria-label="Your guesses">{Array.from({ length: 6 }, (_, row) => <div className="arena-row" key={row}>{Array.from({ length: 5 }, (_, column) => { const guess = view.ownGuesses[row], letter = guess?.word[column] ?? (row === view.ownGuesses.length ? draft[column] : '') ?? ''; return <span key={column} className={`arena-tile ${guess ? guess.marks[column] : letter ? 'filled' : ''}`} aria-label={`Row ${row + 1} letter ${column + 1}: ${letter || 'empty'}${guess ? `, ${guess.marks[column]}` : ''}`}>{letter}</span>; })}</div>)}</div><p className="arena-board-status" role="status">{self?.status === 'solved' ? `Solved! +${self.roundPoints} points. Waiting for the round to finish.` : self?.status === 'failed' ? 'Six guesses used. Waiting for results.' : 'Type a five-letter word and press Enter.'}</p><div className="arena-keyboard">{rows.map(row => <div className="arena-key-row" key={row}>{row.split('').map(key => <button key={key} className={`arena-key ${marks[key] ?? ''}`} onClick={() => onKey(key)} disabled={self?.status !== 'active' || busy || connection !== 'online'}>{key}</button>)}</div>)}<div className="arena-key-row"><button className="arena-key wide" onClick={() => onKey('ENTER')} disabled={self?.status !== 'active' || busy || connection !== 'online'}>ENTER</button><button className="arena-key wide" aria-label="Delete letter" onClick={() => onKey('BACKSPACE')} disabled={self?.status !== 'active' || busy || connection !== 'online'}>⌫</button></div></div></div></div>}
    {view && resolved && <div className="arena-results-layout"><section className="arena-panel arena-results"><span className="eyebrow"><Trophy size={16} /> {view.status === 'finished' ? 'TOURNAMENT COMPLETE' : `ROUND ${view.round} / ${TOURNAMENT_ROUNDS} COMPLETE`}</span><h2>{view.status === 'finished' ? (view.players.filter(player => player.rank === 1).length > 1 ? 'A shared victory.' : `${view.players.find(player => player.rank === 1)?.name ?? 'Tournament'} wins.`) : 'Round results'}</h2><p>The word was <strong>{view.answer}</strong>. {view.status === 'finished' ? 'Final standings combine all five rounds.' : 'Scores carry forward to the next round.'}</p>{view.status === 'finished' && <p>Five rounds played · Tie breakers: points, words solved, fewer guesses, faster combined solve time.</p>}<div className="arena-actions"><button className="button secondary" onClick={() => void shareResults()}><Send size={16} /> Share results</button><button className="button secondary" onClick={() => void copy(resultText)}><Copy size={16} /> Copy text</button>{analysisSession && <button className="button secondary" onClick={() => setShowDna(true)}><Dna size={16} /> Your Word DNA</button>}{view.status === 'round_results' && self?.host && <button className="button primary" disabled={busy || connection !== 'online'} onClick={() => void send({ type: 'next_round', roundId: view.roundId! })}>Next round <ArrowRight size={17} /></button>}{view.status === 'finished' && self?.host && <button className="button primary" disabled={busy || connection !== 'online'} onClick={() => void send({ type: 'play_again' })}><RotateCcw size={16} /> Play again</button>}<button className="button secondary" onClick={() => void send({ type: 'leave' })}>Return to Arena lobby</button></div>{!self?.host && <p className="arena-waiting">{view.status === 'finished' ? 'Waiting for the host to start a new tournament.' : 'Waiting for the host to start the next round.'}</p>}</section><Leaderboard view={view} results />{view.status === 'finished' && <section className="arena-panel arena-final-stats"><span className="eyebrow">FIVE-ROUND TOTALS</span><h2>Every round counts.</h2><div>{[...view.players].sort((a, b) => a.rank - b.rank).map(player => <p key={player.id}><strong>{player.name}</strong><span>{player.totalPoints} pts · {player.wordsSolved} solved · {player.totalGuesses} guesses · Avg solve {player.wordsSolved ? seconds(player.totalSolveMs / player.wordsSolved) : '—'}</span></p>)}</div><h3>Round by round</h3><div className="arena-round-history">{view.completedRounds.map(round => <div key={round.round}><strong>Round {round.round} · {round.answer}</strong>{round.players.map(result => <span key={result.id}>{view.players.find(player => player.id === result.id)?.name ?? 'Player'}: +{result.points} pts</span>)}</div>)}</div></section>}</div>}
    {showDna && analysisSession && <div className="arena-modal-backdrop" onClick={() => setShowDna(false)}><div className="arena-modal" role="dialog" aria-modal="true" aria-label="Your Word DNA" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key !== 'Tab') return; const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),[href],[tabindex]:not([tabindex="-1"])')]; if (!focusable.length) return; if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); } }}><button ref={dnaClose} className="arena-modal-close" aria-label="Close Word DNA" onClick={() => setShowDna(false)}><X size={20} /></button><WordDnaView session={analysisSession} announce={setMessage} /></div></div>}
    {!view && <div className="arena-explain"><Users size={20} /><span>Playing alone? Solo Practice uses the same six-guess puzzle rules and works offline.</span><button className="button secondary" onClick={onSolo}>Play Solo <ArrowRight size={16} /></button></div>}
  </main>;
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { ArrowLeft, ArrowRight, Copy, Dna, Link2, Radio, RotateCcw, Send, Trophy, Users, X } from 'lucide-react';
import { keyboardMarks, type Session } from './engine';
import { arenaShareText, type ArenaAction, type ArenaReply, type ArenaSettings, type ArenaView } from './arenaProtocol';
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
function clearSession() { try { sessionStorage.removeItem(STORE); } catch { /* Harmless. */ } }

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
  const send = useCallback(async (action: ArenaAction) => {
    const s = socket.current;
    if (!s?.connected || busyRef.current) { setMessage(s?.connected ? 'Please wait for the previous action.' : 'Connecting to Arena…'); return; }
    busyRef.current = true; setBusy(true); setMessage('');
    try {
      const reply = await s.timeout(5000).emitWithAck('arena:action', action) as ArenaReply;
      if (!reply.ok) { setMessage(reply.error); return; }
      if (reply.view) { serverOffset.current = reply.view.serverNow - Date.now(); setView(reply.view); viewRef.current = reply.view; }
      if (reply.token && reply.view) saveSession(reply.view.code, reply.token);
      if (action.type === 'guess') setDraft('');
      if (action.type === 'leave') { clearSession(); setView(null); viewRef.current = null; history.replaceState(null, '', location.pathname); }
    } catch { setMessage('The server did not respond. Please retry.'); }
    finally { busyRef.current = false; setBusy(false); }
  }, []);
  useEffect(() => {
    if (!url) { setConnection('offline'); setMessage('Arena server URL is not configured for this deployment.'); return; }
    const s = io(url, { autoConnect: true, reconnection: true }); socket.current = s;
    s.on('connect', () => { setConnection('online'); setMessage(previous => previous === connectionError ? '' : previous); const saved = savedSession(); const inviteCode = new URLSearchParams(location.search).get('room')?.toUpperCase(); if (saved && (!inviteCode || saved.code === inviteCode)) s.timeout(5000).emitWithAck('arena:action', { type: 'resume', ...saved }).then((reply: ArenaReply) => {
      if (reply.ok && reply.view) { serverOffset.current = reply.view.serverNow - Date.now(); setView(reply.view); viewRef.current = reply.view; setMessage('Reconnected to your room.'); }
      else { clearSession(); setMessage(reply.ok ? '' : reply.error); }
    }).catch(() => setMessage('Could not restore your room.')); });
    s.on('disconnect', () => setConnection('offline'));
    s.on('connect_error', () => { setConnection('offline'); setMessage(connectionError); });
    s.on('arena:state', (next: ArenaView) => { serverOffset.current = next.serverNow - Date.now(); setView(next); viewRef.current = next; });
    return () => { s.removeAllListeners(); s.disconnect(); socket.current = null; };
  }, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, []);
  useEffect(() => { setDraft(''); }, [view?.startedAt]);
  useEffect(() => {
    if (!showDna) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dnaClose.current?.focus();
    return () => previous?.focus();
  }, [showDna]);
  useEffect(() => { const next = view?.code; if (next) history.replaceState(null, '', `${location.pathname}?room=${next}`); }, [view?.code]);
  const onKey = useCallback((key: string) => {
    const v = viewRef.current;
    if (showDna || !v || v.status !== 'playing' || v.players.find(p => p.id === v.selfId)?.status !== 'active' || busyRef.current) return;
    if (key === 'BACKSPACE') setDraft(x => x.slice(0, -1));
    else if (key === 'ENTER') { if (draft.length === 5) void send({ type: 'guess', word: draft, sequence: v.ownGuesses.length + 1 }); else setMessage('Enter a five-letter word.'); }
    else if (/^[A-Z]$/.test(key)) setDraft(x => x.length < 5 ? x + key : x);
  }, [draft, send, showDna]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (showDna && event.key === 'Escape') { setShowDna(false); return; }
      if (event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
      const key = event.key === 'Backspace' ? 'BACKSPACE' : event.key === 'Enter' ? 'ENTER' : event.key.toUpperCase();
      if (key === 'BACKSPACE' || key === 'ENTER' || /^[A-Z]$/.test(key)) { event.preventDefault(); onKey(key); }
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, [onKey, showDna]);
  const self = view?.players.find(p => p.id === view.selfId);
  const offset = serverOffset.current;
  const remaining = view?.deadline ? Math.max(0, Math.ceil((view.deadline - (now + offset)) / 1000)) : 0;
  const marks = keyboardMarks(view?.ownGuesses ?? []);
  const analysisSession = useMemo<Session | null>(() => view?.status === 'finished' && view.answer ? {
    id: `arena-${view.roundId}`, mode: 'classic', answer: view.answer, guesses: view.ownGuesses, draft: '',
    status: self?.status === 'solved' ? 'won' : 'lost', hintIndex: null, hintsUsed: 0, score: self?.points ?? 0,
    startedAt: view.startedAt ?? 0, endedAt: view.deadline, answerListVersion: 1,
  } : null, [view, self]);
  const invite = view ? `${location.origin}${location.pathname}?room=${view.code}` : '';
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setMessage('Copied to clipboard.'); } catch { setMessage('Clipboard unavailable. Select and copy the code instead.'); } };
  const share = async () => { if (!view) return; try { if (navigator.share) await navigator.share({ title: 'WORDVERSE Arena', url: invite }); else await copy(invite); } catch (e) { if ((e as Error).name !== 'AbortError') setMessage('Sharing unavailable. Copy the invite link instead.'); } };
  const resultText = view ? arenaShareText(view, invite) : '';
  const shareResults = async () => { try { if (navigator.share) await navigator.share({ text: resultText }); else await copy(resultText); } catch (e) { if ((e as Error).name !== 'AbortError') await copy(resultText); } };
  return <main className="arena-main">
    <div className="arena-top"><button className="back-link" onClick={onHome}><ArrowLeft size={18} /> All modes</button><span className="arena-live"><Radio size={15} /> {connection === 'online' ? 'LIVE' : connection === 'connecting' ? 'CONNECTING' : 'OFFLINE'}</span></div>
    <div className="arena-heading"><span className="eyebrow">WORDVERSE / LIVE PLAY</span><h1>Wordverse <em>Arena.</em></h1><p>One hidden word. Six guesses each. Faster, sharper solves take the lead.</p></div>
    {message && <div className="arena-message" role="status">{message}</div>}
    {!view && <div className="arena-entry"><section className="arena-panel"><span className="eyebrow">PLAY TOGETHER</span><h2>Create a room</h2><p>Invite friends to a private live match. Everyone solves the same word independently.</p><label>Your display name<input maxLength={18} value={name} onChange={e => setName(e.target.value)} placeholder="Your name" /></label><div className="arena-fields"><label>Players<select value={settings.capacity} onChange={e => setSettings({ ...settings, capacity: Number(e.target.value) as ArenaSettings['capacity'] })}><option value={2}>2 · Head-to-Head</option><option value={3}>3 · Triple Threat</option><option value={4}>4 · Four-Player Arena</option></select></label><label>Round length<select value={settings.duration} onChange={e => setSettings({ ...settings, duration: Number(e.target.value) as ArenaSettings['duration'] })}><option value={90}>90 seconds</option><option value={180}>3 minutes</option><option value={300}>5 minutes</option></select></label></div><label>Difficulty<select value={settings.difficulty} onChange={e => setSettings({ ...settings, difficulty: e.target.value as ArenaSettings['difficulty'] })}><option value="standard">Standard</option><option value="hard">Hard · use all revealed clues</option></select></label><button className="button primary" disabled={busy || connection !== 'online'} onClick={() => void send({ type: 'create', name, settings })}>Create room <ArrowRight size={17} /></button></section><section className="arena-panel"><span className="eyebrow">HAVE AN INVITE?</span><h2>Join a room</h2><p>Enter your seven-character code and choose a display name.</p><label>Room code<input maxLength={7} value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="ABCDEFG" autoCapitalize="characters" /></label><label>Your display name<input maxLength={18} value={name} onChange={e => setName(e.target.value)} placeholder="Your name" /></label><button className="button secondary" disabled={busy || connection !== 'online'} onClick={() => void send({ type: 'join', code, name })}>Join room <ArrowRight size={17} /></button></section></div>}
    {view?.status === 'lobby' && <div className="arena-lobby"><div className="arena-panel arena-room-code"><span className="eyebrow">PRIVATE ROOM</span><strong>{view.code}</strong><div className="arena-actions"><button className="button secondary" onClick={() => void copy(view.code)}><Copy size={16} /> Copy code</button><button className="button secondary" onClick={() => void share()}><Link2 size={16} /> Share invite</button></div><p>{view.players.length}/{view.settings.capacity} players · {view.settings.duration}s · {view.settings.difficulty === 'hard' ? 'Hard' : 'Standard'} rules</p></div><div className="arena-panel"><span className="eyebrow">THE CONTENDERS</span><h2>Waiting room</h2><div className="arena-players">{view.players.map(p => <div className="arena-player" key={p.id}><span className="arena-avatar">{p.name.slice(0, 1).toUpperCase()}</span><strong>{p.name} {p.id === view.selfId ? '(you)' : ''}</strong><small>{p.host ? 'HOST' : p.connected ? p.status.toUpperCase() : 'DISCONNECTED'}</small></div>)}</div><p>All players must be connected and ready. The host starts when at least two have joined.</p><div className="arena-actions">{!self?.host && <button className="button primary" disabled={busy} onClick={() => void send({ type: 'ready', ready: self?.status !== 'ready' })}>{self?.status === 'ready' ? 'Cancel ready' : 'I’m ready'}</button>}{self?.host && <button className="button primary" disabled={busy || view.players.length < 2 || view.players.some(p => !p.connected || p.status !== 'ready')} onClick={() => void send({ type: 'start' })}>Start match <ArrowRight size={17} /></button>}<button className="button secondary" onClick={() => void send({ type: 'leave' })}>Leave room</button></div></div></div>}
    {view?.status === 'playing' && <div className="arena-match"><div className="arena-opponents" aria-label="Players">{view.players.map(p => <div className={`arena-opponent ${p.id === view.selfId ? 'is-self' : ''}`} key={p.id}><span>{p.name}{p.id === view.selfId ? ' · YOU' : ''}</span><strong>{p.attempts}/6</strong><small>{p.connected ? p.status : 'reconnecting'}</small></div>)}</div><div className="arena-panel arena-board-panel"><div className="arena-board-header"><span className="eyebrow">SAME WORD · PRIVATE GUESSES</span><strong>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</strong></div><div className="arena-board" aria-label="Your guesses">{Array.from({ length: 6 }, (_, r) => <div className="arena-row" key={r}>{Array.from({ length: 5 }, (_, c) => { const g = view.ownGuesses[r], letter = g?.word[c] ?? (r === view.ownGuesses.length ? draft[c] : '') ?? ''; return <span key={c} className={`arena-tile ${g ? g.marks[c] : letter ? 'filled' : ''}`} aria-label={`Row ${r + 1} letter ${c + 1}: ${letter || 'empty'}${g ? `, ${g.marks[c]}` : ''}`}>{letter}</span>; })}</div>)}</div><p className="arena-board-status" role="status">{self?.status === 'solved' ? 'Solved! Waiting for the round to finish.' : self?.status === 'failed' ? 'Six guesses used. Waiting for results.' : 'Type a five-letter word and press Enter.'}</p><div className="arena-keyboard">{rows.map(row => <div className="arena-key-row" key={row}>{row.split('').map(key => <button key={key} className={`arena-key ${marks[key] ?? ''}`} onClick={() => onKey(key)} disabled={self?.status !== 'active' || busy}>{key}</button>)}</div>)}<div className="arena-key-row"><button className="arena-key wide" onClick={() => onKey('ENTER')} disabled={self?.status !== 'active' || busy}>ENTER</button><button className="arena-key wide" onClick={() => onKey('BACKSPACE')} disabled={self?.status !== 'active' || busy}>⌫</button></div></div></div></div>}
    {view?.status === 'finished' && <div className="arena-panel arena-results"><span className="eyebrow"><Trophy size={16} /> ROUND COMPLETE</span><h2>{view.players.filter(p => p.rank === 1 && p.status === 'solved').map(p => p.name).join(' & ') || 'No one solved it this round'}</h2><p>The word was <strong>{view.answer}</strong>. Solves rank by fewest guesses, then server submission time. Equal results share a rank. Unsolved players rank by their strongest feedback; points go to solvers.</p><div className="arena-ranking">{[...view.players].sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9)).map(p => <div className="arena-rank" key={p.id}><strong>#{p.rank}</strong><span>{p.name}{p.id === view.selfId ? ' · YOU' : ''}</span><small>{p.status === 'solved' ? `SOLVED IN ${p.attempts}` : p.status.toUpperCase()}{p.tie ? ' · TIE' : ''}</small><b>{p.points} PTS</b></div>)}</div><div className="arena-actions"><button className="button primary" onClick={() => void shareResults()}><Send size={16} /> Share results</button><button className="button secondary" onClick={() => void copy(resultText)}><Copy size={16} /> Copy text</button>{analysisSession && <button className="button secondary" onClick={() => setShowDna(true)}><Dna size={16} /> Your Word DNA</button>}{self?.host && <button className="button secondary" disabled={busy || view.players.some(p => !p.connected)} onClick={() => void send({ type: 'rematch' })}><RotateCcw size={16} /> Rematch</button>}<button className="button secondary" onClick={() => void send({ type: 'leave' })}>Leave room</button></div></div>}
    {showDna && analysisSession && <div className="arena-modal-backdrop" onClick={() => setShowDna(false)}><div className="arena-modal" role="dialog" aria-modal="true" aria-label="Your Word DNA" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key !== 'Tab') return; const focusable = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),[href],[tabindex]:not([tabindex="-1"])')]; if (!focusable.length) return; if (e.shiftKey && document.activeElement === focusable[0]) { e.preventDefault(); focusable.at(-1)?.focus(); } else if (!e.shiftKey && document.activeElement === focusable.at(-1)) { e.preventDefault(); focusable[0].focus(); } }}><button ref={dnaClose} className="arena-modal-close" aria-label="Close Word DNA" onClick={() => setShowDna(false)}><X size={20} /></button><WordDnaView session={analysisSession} announce={setMessage} /></div></div>}
    {!view && <div className="arena-explain"><Users size={20} /><span>Playing alone? Solo Practice uses the same six-guess puzzle rules and works offline.</span><button className="button secondary" onClick={onSolo}>Play Solo <ArrowRight size={16} /></button><Send size={18} /></div>}
  </main>;
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { createArenaServer } from './index';
import { RoomManager } from './roomManager';
import type { ArenaReply, ArenaView } from '../src/arenaProtocol';

const clients: Socket[] = [];
let server: ReturnType<typeof createArenaServer> | undefined;
afterEach(async () => { clients.forEach(c => c.disconnect()); clients.length = 0; await server?.close(); server = undefined; });

describe('live Arena synchronization', () => {
  it('restores a disconnected player and their accepted guesses', async () => {
    server = createArenaServer(new RoomManager(() => Date.now(), () => 'APPLE'));
    await new Promise<void>(resolve => server!.http.listen(0, '127.0.0.1', resolve));
    const address = server.http.address(); if (!address || typeof address === 'string') throw Error('no port');
    const url = `http://127.0.0.1:${address.port}`;
    const open = async () => { const peer = connect(url, { transports: ['websocket'] }); clients.push(peer); await new Promise<void>(resolve => peer.on('connect', resolve)); return peer; };
    const act = (peer: Socket, action: unknown) => peer.timeout(3000).emitWithAck('arena:action', action) as Promise<ArenaReply>;
    const host = await open(), guest = await open();
    const created = await act(host, { type: 'create', name: 'Host', settings: { capacity: 2, duration: 90, difficulty: 'standard' } });
    if (!created.ok || !created.view) throw Error('create failed');
    const joined = await act(guest, { type: 'join', code: created.view.code, name: 'Guest' });
    if (!joined.ok || !joined.token) throw Error('join failed');
    await act(guest, { type: 'ready', ready: true }); await act(host, { type: 'start' });
    expect((await act(guest, { type: 'guess', word: 'CRANE', sequence: 1 })).ok).toBe(true);
    guest.disconnect();
    const resumedPeer = await open();
    const resumed = await act(resumedPeer, { type: 'resume', code: created.view.code, token: joined.token });
    expect(resumed.ok && resumed.view?.ownGuesses[0].word).toBe('CRANE');
    expect(resumed.ok && resumed.view?.players.find(p => p.name === 'Guest')?.connected).toBe(true);
  });

  it.each([3, 4] as const)('starts a %i-player match across separate sockets', async capacity => {
    server = createArenaServer(new RoomManager(() => Date.now(), () => 'APPLE'));
    await new Promise<void>(resolve => server!.http.listen(0, '127.0.0.1', resolve));
    const address = server.http.address(); if (!address || typeof address === 'string') throw Error('no port');
    const peers = await Promise.all(Array.from({ length: capacity }, async () => {
      const socket = connect(`http://127.0.0.1:${address.port}`, { transports: ['websocket'] });
      clients.push(socket); await new Promise<void>(resolve => socket.on('connect', resolve)); return socket;
    }));
    const act = (peer: Socket, action: unknown) => peer.timeout(3000).emitWithAck('arena:action', action) as Promise<ArenaReply>;
    const created = await act(peers[0], { type: 'create', name: 'Host', settings: { capacity, duration: 90, difficulty: 'standard' } });
    if (!created.ok || !created.view) throw Error('create failed');
    for (let i = 1; i < capacity; i++) {
      expect((await act(peers[i], { type: 'join', code: created.view.code, name: `Guest${i}` })).ok).toBe(true);
      await act(peers[i], { type: 'ready', ready: true });
    }
    const started = await act(peers[0], { type: 'start' });
    expect(started.ok && started.view?.players).toHaveLength(capacity);
    for (const peer of peers) {
      const snapshot = await act(peer, { type: 'resume', code: created.view.code, token: 'invalid' });
      expect(snapshot.ok).toBe(false);
    }
    const first = await act(peers[1], { type: 'guess', word: 'APPLE', sequence: 1 });
    expect(first.ok && first.view?.ownGuesses).toHaveLength(1);
    expect(first.ok && first.view?.answer).toBeUndefined();
    const hostState = await act(peers[0], { type: 'guess', word: 'CRANE', sequence: 1 });
    expect(hostState.ok && hostState.view?.ownGuesses).toHaveLength(1);
    expect(hostState.ok && hostState.view?.players.find(p => p.name === 'Guest1')?.status).toBe('solved');
  });

  it('syncs two sockets without broadcasting guesses or the answer', async () => {
    server = createArenaServer(new RoomManager(() => Date.now(), () => 'APPLE'));
    await new Promise<void>(resolve => server!.http.listen(0, '127.0.0.1', resolve));
    const address = server.http.address(); if (!address || typeof address === 'string') throw Error('no port');
    const url = `http://127.0.0.1:${address.port}`;
    const open = async () => { const socket = connect(url, { transports: ['websocket'] }); clients.push(socket); await new Promise<void>(resolve => socket.on('connect', resolve)); return socket; };
    const action = (socket: Socket, payload: unknown) => socket.timeout(3000).emitWithAck('arena:action', payload) as Promise<ArenaReply>;
    const host = await open(), guest = await open();
    let guestView: ArenaView | undefined;
    guest.on('arena:state', (view: ArenaView) => { guestView = view; });
    const created = await action(host, { type: 'create', name: 'Host', settings: { capacity: 2, duration: 90, difficulty: 'standard' } });
    if (!created.ok || !created.view) throw Error('create failed');
    const code = created.view.code;
    expect((await action(guest, { type: 'join', code, name: 'Guest' })).ok).toBe(true);
    await action(guest, { type: 'ready', ready: true });
    expect((await action(host, { type: 'start' })).ok).toBe(true);
    await vi.waitFor(() => expect(guestView?.status).toBe('playing'));
    expect(guestView?.answer).toBeUndefined();
    expect((await action(host, { type: 'guess', word: 'CRANE', sequence: 1 })).ok).toBe(true);
    await vi.waitFor(() => expect(guestView?.players[0].attempts).toBe(1));
    expect(guestView?.ownGuesses).toEqual([]);
    expect(guestView?.answer).toBeUndefined();
    expect((await action(guest, { type: 'guess', word: 'APPLE', sequence: 1 })).ok).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 260));
    expect((await action(host, { type: 'guess', word: 'APPLE', sequence: 2 })).ok).toBe(true);
    await vi.waitFor(() => expect(guestView?.status).toBe('finished'));
    expect(guestView?.answer).toBe('APPLE');
    expect(guestView?.players.find(p => p.name === 'Guest')?.rank).toBe(1);
  });
});

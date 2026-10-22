import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Server } from 'socket.io';
import { RoomManager } from './roomManager';
import type { ArenaAction, ArenaReply } from '../src/arenaProtocol';

export function createArenaServer(manager = new RoomManager(), origins = process.env.ARENA_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173') {
const allowedOrigins = origins.split(',').map(x => x.trim());
const http = createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true })); }
  else { res.writeHead(404); res.end(); }
});
const io = new Server(http, { cors: { origin: allowedOrigins }, allowRequest: (req, callback) => callback(null, !req.headers.origin || allowedOrigins.includes(req.headers.origin)), maxHttpBufferSize: 4096, transports: ['websocket', 'polling'] });
const sockets = new Map<string, string>();
function broadcast(code: string) {
  for (const [id, socketId] of sockets) {
    const view = manager.viewFor(code, id);
    if (view) io.to(socketId).emit('arena:state', view);
  }
}
io.on('connection', socket => {
  let context: { code: string; id: string } | undefined;
  let lastRoomAction = 0;
  socket.on('arena:action', (action: ArenaAction, reply: (value: ArenaReply) => void) => {
    if (typeof reply !== 'function') return;
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') { reply({ ok: false, error: 'Invalid action.' }); return; }
    if (context && ['create', 'join', 'resume'].includes(action.type)) { reply({ ok: false, error: 'Leave your current room first.' }); return; }
    if (['create', 'join'].includes(action.type)) {
      if (Date.now() - lastRoomAction < 750) { reply({ ok: false, error: 'Please wait before trying another room.' }); return; }
      lastRoomAction = Date.now();
    }
    const result = manager.act(action, context);
    if (result.ok && result.view) {
      if (context && (context.code !== result.view.code || context.id !== result.view.selfId)) sockets.delete(context.id);
      context = { code: result.view.code, id: result.view.selfId };
      // A resumed player replaces the previous connection; its old socket can no longer act.
      const oldSocketId = sockets.get(context.id);
      if (oldSocketId && oldSocketId !== socket.id) io.sockets.sockets.get(oldSocketId)?.disconnect(true);
      sockets.set(context.id, socket.id);
    }
    reply(result);
    if (result.ok && context) {
      const code = context.code;
      if (action.type === 'leave') { sockets.delete(context.id); context = undefined; }
      broadcast(code);
    }
  });
  socket.on('disconnect', () => {
    if (context && sockets.get(context.id) === socket.id) { sockets.delete(context.id); manager.disconnect(context.code, context.id); broadcast(context.code); }
  });
});
const timer = setInterval(() => { for (const code of manager.tick()) broadcast(code); }, 500);
timer.unref();
return { http, io, close: async () => { clearInterval(timer); await new Promise<void>(done => io.close(() => done())); } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? process.env.ARENA_PORT ?? 3001);
  const server = createArenaServer();
  server.http.listen(port, '0.0.0.0', () => console.log(`WORDVERSE Arena listening on ${port}`));
}

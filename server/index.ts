// =====================================================================
// server/index.ts
// The ONE Node.js app that does everything:
//   1. serves the built game files (dist/client)
//   2. runs the multiplayer server (Socket.IO) - the server "owns" positions
//   3. relays voice-chat signaling messages between players (WebRTC setup)
//
// Network messages are tiny arrays to save mobile data:
//   client -> server  'in'  [seq, ix, iy]       my input (-100..100 each)
//   server -> clients 'st'  [slot,x,y,ack, ...] positions of everyone (20x/sec)
//   server -> clients 'pj'  {s,n,a,x,y}         a player joined
//   server -> clients 'pl'  slot                a player left
//   both ways         'sig' {to|from, d}        voice-chat (WebRTC) setup messages
// =====================================================================
import express from 'express';
import http from 'http';
import path from 'path';
import { Server, Socket } from 'socket.io';
import { MAX_PLAYERS, NUM_AVATARS, SPAWNS, TICK_DT, TICK_RATE, moveStep } from '../shared/game';

const PORT = Number(process.env.PORT) || 3000;
const GRACE_MS = 20000; // how long a dropped player's spot is kept so they can reconnect

interface Player {
  slot: number; // 0..5, also used as the player's id inside the room
  name: string;
  av: number; // avatar number
  x: number;
  y: number;
  ix: number; // latest input
  iy: number;
  seq: number; // sequence number of the latest input we applied
  lastIn: number; // when the latest input arrived (ms)
  token: string; // secret used to reconnect to this same player
  sock: Socket | null; // null while disconnected (grace period)
  dropAt: number; // when to give up waiting for a reconnect
}

interface Room {
  code: string;
  players: Map<number, Player>;
  dirty: boolean; // something changed -> send a snapshot this tick
}

const rooms = new Map<string, Room>();

// ---------- web server ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

app.get('/healthz', (_req, res) => res.send('ok')); // Render pings this
const clientDir = path.join(__dirname, '../../client'); // dist/server/server -> dist/client
app.use(express.static(clientDir));

// ---------- helpers ----------
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O (look like 1 and 0)

function makeCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
    if (!rooms.has(code)) return code;
  }
}

function makeToken(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14) || 'Player';
}

function cleanAvatar(raw: unknown): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 0 && n < NUM_AVATARS ? n : 0;
}

function clampInput(raw: unknown): number {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) ? Math.max(-100, Math.min(100, n)) : 0;
}

/** What we tell clients about a player (short keys = fewer bytes). */
function publicInfo(p: Player) {
  return { s: p.slot, n: p.name, a: p.av, x: Math.round(p.x), y: Math.round(p.y) };
}

function roomInfo(room: Room) {
  return [...room.players.values()].map(publicInfo);
}

function addPlayer(room: Room, sock: Socket, name: string, av: number): Player | null {
  for (let slot = 0; slot < MAX_PLAYERS; slot++) {
    if (room.players.has(slot)) continue;
    const [x, y] = SPAWNS[slot];
    const p: Player = {
      slot, name, av, x, y, ix: 0, iy: 0, seq: 0,
      lastIn: Date.now(), token: makeToken(), sock, dropAt: 0,
    };
    room.players.set(slot, p);
    return p;
  }
  return null;
}

function removePlayer(room: Room, p: Player) {
  room.players.delete(p.slot);
  io.to(room.code).emit('pl', p.slot);
  room.dirty = true;
}

/** Connect a socket to a player: remember who it is and put it in the socket.io room. */
function bind(sock: Socket, room: Room, p: Player) {
  p.sock = sock;
  p.dropAt = 0;
  sock.data.code = room.code;
  sock.data.slot = p.slot;
  sock.join(room.code);
}

/** Take a socket out of whatever room it is in right now (if any). */
function leaveCurrent(sock: Socket) {
  const room = rooms.get(sock.data.code);
  if (!room) return;
  const p = room.players.get(sock.data.slot);
  sock.leave(room.code);
  sock.data.code = undefined;
  sock.data.slot = undefined;
  if (p && p.sock === sock) removePlayer(room, p);
}

// ---------- socket events ----------
io.on('connection', (sock) => {
  // Create a brand-new room
  sock.on('create', (data: any, ack?: (r: unknown) => void) => {
    if (typeof ack !== 'function') return;
    leaveCurrent(sock);
    const room: Room = { code: makeCode(), players: new Map(), dirty: false };
    rooms.set(room.code, room);
    const p = addPlayer(room, sock, cleanName(data?.name), cleanAvatar(data?.av))!;
    bind(sock, room, p);
    ack({ ok: true, code: room.code, slot: p.slot, token: p.token, players: roomInfo(room) });
  });

  // Join an existing room by its 4-letter code
  sock.on('join', (data: any, ack?: (r: unknown) => void) => {
    if (typeof ack !== 'function') return;
    const code = String(data?.code ?? '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, err: `Room "${code}" doesn't exist. Check the code!` });
    if (room.players.size >= MAX_PLAYERS) return ack({ ok: false, err: `Room ${code} is full (${MAX_PLAYERS}/${MAX_PLAYERS} players).` });
    leaveCurrent(sock);
    const p = addPlayer(room, sock, cleanName(data?.name), cleanAvatar(data?.av))!;
    bind(sock, room, p);
    ack({ ok: true, code: room.code, slot: p.slot, token: p.token, players: roomInfo(room) });
    sock.to(room.code).emit('pj', publicInfo(p)); // tell everyone else
  });

  // Came back after a dropped connection: take the old spot again
  sock.on('rejoin', (data: any, ack?: (r: unknown) => void) => {
    if (typeof ack !== 'function') return;
    const room = rooms.get(String(data?.code ?? ''));
    const p = room && [...room.players.values()].find((q) => q.token === data?.token);
    if (!room || !p) return ack({ ok: false, err: 'That room has ended.' });
    if (p.sock && p.sock !== sock) p.sock.data.code = undefined; // old zombie connection
    bind(sock, room, p);
    ack({ ok: true, code: room.code, slot: p.slot, token: p.token, players: roomInfo(room) });
    sock.to(room.code).emit('pj', publicInfo(p)); // others reset their voice link with us
    room.dirty = true;
  });

  // My movement input
  sock.on('in', (msg: unknown) => {
    const room = rooms.get(sock.data.code);
    const p = room?.players.get(sock.data.slot);
    if (!room || !p || p.sock !== sock || !Array.isArray(msg)) return;
    const seq = Number(msg[0]);
    if (!Number.isFinite(seq) || seq <= p.seq) return; // ignore old/duplicate
    p.seq = seq;
    p.ix = clampInput(msg[1]);
    p.iy = clampInput(msg[2]);
    p.lastIn = Date.now();
    room.dirty = true; // so the client gets its new "ack" number back
  });

  // Voice-chat setup messages: just forward to the right player in the same room
  sock.on('sig', (msg: any) => {
    const room = rooms.get(sock.data.code);
    const target = room?.players.get(Number(msg?.to));
    if (!room || !target?.sock || sock.data.slot === undefined) return;
    target.sock.emit('sig', { from: sock.data.slot, d: msg.d });
  });

  // Ping measurement: reply immediately
  sock.on('pg', (ack?: () => void) => {
    if (typeof ack === 'function') ack();
  });

  // Player pressed "Leave" (or closed the page): remove right away
  sock.on('leave', () => leaveCurrent(sock));

  sock.on('disconnect', (reason) => {
    const room = rooms.get(sock.data.code);
    const p = room?.players.get(sock.data.slot);
    if (!room || !p || p.sock !== sock) return;
    if (reason === 'client namespace disconnect') {
      removePlayer(room, p); // they left on purpose
    } else {
      // Connection dropped: keep their spot for a bit so they can reconnect
      p.sock = null;
      p.ix = p.iy = 0;
      p.dropAt = Date.now() + GRACE_MS;
    }
  });
});

// ---------- the game loop: runs 20 times per second ----------
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    let changed = room.dirty;
    room.dirty = false;

    for (const p of [...room.players.values()]) {
      // Give up on players who never came back
      if (!p.sock && now > p.dropAt) {
        removePlayer(room, p);
        continue;
      }
      // No input for half a second? Stop moving (safety if messages get lost).
      if (now - p.lastIn > 500) p.ix = p.iy = 0;
      if (p.ix !== 0 || p.iy !== 0) {
        const [nx, ny] = moveStep(p.x, p.y, p.ix, p.iy, TICK_DT);
        if (nx !== p.x || ny !== p.y) {
          p.x = nx;
          p.y = ny;
          changed = true;
        }
      }
    }

    if (room.players.size === 0) {
      rooms.delete(room.code);
      continue;
    }
    if (changed) {
      // Flat compact array: [slot, x, y, ack, slot, x, y, ack, ...]
      const snap: number[] = [];
      for (const p of room.players.values()) snap.push(p.slot, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, p.seq);
      io.to(room.code).volatile.emit('st', snap); // volatile = ok to drop if the network is busy
    }
  }
}, 1000 / TICK_RATE);

server.listen(PORT, () => console.log(`Game server running on port ${PORT}`));

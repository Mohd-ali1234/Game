// =====================================================================
// server/index.ts
// The ONE Node.js app that does everything:
//   1. serves the built game files (dist/client)
//   2. runs the multiplayer server (Socket.IO) - the server "owns" positions,
//      uses Rapier physics for collisions (walls, stairs, furniture, doors),
//      keeps doors in sync, and runs the ghosts
//   3. relays voice-chat signaling messages between players (WebRTC setup)
//
// Network messages are tiny arrays to save mobile data:
//   client -> server  'in'  [seq, ix, iy, yaw*1000, pitch*1000]   my input
//   server -> clients 'st'  [slot,x,y,z,ack,yaw,pitch, ...]       everyone (20x/sec)
//   server -> clients 'pj'  {s,n,a,x,y,z,w} a player joined (w = yaw)
//   server -> clients 'pl'  slot            a player left
//   client -> server  'door' doorId          "I'm opening/closing this door"
//   server -> clients 'door' [doorId, 0|1]   a door closed/opened
//   server -> clients 'gh'  [ghost, spot]    a ghost moved (spot -1 = vanished)
//   both ways         'sig' {to|from, d}    voice-chat (WebRTC) setup messages
// =====================================================================
import express from 'express';
import http from 'http';
import path from 'path';
import { Server, Socket } from 'socket.io';
import { DOOR_REACH, EYE_HEIGHT, initPhysics, LAYOUT, MAX_PLAYERS, Mover, NUM_AVATARS, TICK_DT, TICK_RATE } from '../shared/game';

const PORT = Number(process.env.PORT) || 3000;
const GRACE_MS = 20000; // how long a dropped player's spot is kept so they can reconnect

interface Player {
  slot: number; // 0..5, also used as the player's id inside the room
  name: string;
  av: number; // avatar number
  x: number;
  y: number; // feet height
  z: number;
  yaw: number; // where they look (left/right), radians
  pitch: number; // where they look (up/down), radians
  ix: number; // latest movement input
  iy: number;
  seq: number; // sequence number of the latest input we applied
  lastIn: number; // when the latest input arrived (ms)
  token: string; // secret used to reconnect to this same player
  sock: Socket | null; // null while disconnected (grace period)
  dropAt: number; // when to give up waiting for a reconnect
}

interface Ghost {
  spot: number; // index into LAYOUT.ghostSpots, or -1 while vanished
  last: number; // the spot it was at before vanishing
  backAt: number; // when it reappears (ms)
}

interface Room {
  code: string;
  players: Map<number, Player>;
  dirty: boolean; // something changed -> send a snapshot this tick
  mover: Mover; // this room's physics world (each room has its own doors)
  openDoors: Set<string>;
  ghosts: Ghost[];
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

const r2 = (n: number) => Math.round(n * 100) / 100;

/** What we tell clients about a player (short keys = fewer bytes). */
function publicInfo(p: Player) {
  return { s: p.slot, n: p.name, a: p.av, x: r2(p.x), y: r2(p.y), z: r2(p.z), w: r2(p.yaw) };
}

/** Everything a player needs when they (re)join: players, open doors, ghost spots. */
function joinReply(room: Room, p: Player) {
  return {
    ok: true, code: room.code, slot: p.slot, token: p.token,
    players: [...room.players.values()].map(publicInfo),
    doors: [...room.openDoors],
    ghosts: room.ghosts.map((g) => g.spot),
  };
}

function makeRoom(): Room {
  const room: Room = { code: makeCode(), players: new Map(), dirty: false, mover: new Mover(LAYOUT), openDoors: new Set(), ghosts: [] };
  // ghosts start somewhere away from the entrance
  const spawn = LAYOUT.spawns[0];
  const far = LAYOUT.ghostSpots.map((_, i) => i).filter((i) => dist3(LAYOUT.ghostSpots[i], spawn) > 12);
  for (let i = 0; i < LAYOUT.ghostCount && far.length; i++) {
    const spot = far.splice(Math.floor(Math.random() * far.length), 1)[0];
    room.ghosts.push({ spot, last: spot, backAt: 0 });
  }
  return room;
}

const dist3 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function addPlayer(room: Room, sock: Socket, name: string, av: number): Player | null {
  for (let slot = 0; slot < MAX_PLAYERS; slot++) {
    if (room.players.has(slot)) continue;
    const { x, y, z, yaw } = LAYOUT.spawns[slot];
    const p: Player = {
      slot, name, av, x, y, z, yaw, pitch: 0, ix: 0, iy: 0, seq: 0,
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
    const room = makeRoom();
    rooms.set(room.code, room);
    const p = addPlayer(room, sock, cleanName(data?.name), cleanAvatar(data?.av))!;
    bind(sock, room, p);
    ack(joinReply(room, p));
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
    ack(joinReply(room, p));
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
    ack(joinReply(room, p));
    sock.to(room.code).emit('pj', publicInfo(p)); // others reset their voice link with us
    room.dirty = true;
  });

  // My input: [seq, ix, iy, yaw*1000, pitch*1000]
  sock.on('in', (msg: unknown) => {
    const room = rooms.get(sock.data.code);
    const p = room?.players.get(sock.data.slot);
    if (!room || !p || p.sock !== sock || !Array.isArray(msg)) return;
    const seq = Number(msg[0]);
    if (!Number.isFinite(seq) || seq <= p.seq) return; // ignore old/duplicate
    p.seq = seq;
    p.ix = clampInput(msg[1]);
    p.iy = clampInput(msg[2]);
    const yaw = Number(msg[3]) / 1000;
    const pitch = Number(msg[4]) / 1000;
    if (Number.isFinite(yaw)) p.yaw = yaw;
    if (Number.isFinite(pitch)) p.pitch = Math.max(-1.6, Math.min(1.6, pitch));
    p.lastIn = Date.now();
    room.dirty = true; // so the client gets its new "ack" number back
  });

  // Open / close a door (only if you're standing next to it, and it isn't locked)
  sock.on('door', (id: unknown) => {
    const room = rooms.get(sock.data.code);
    const p = room?.players.get(sock.data.slot);
    const door = LAYOUT.doors.find((d) => d.id === id);
    if (!room || !p || p.sock !== sock || !door || door.type !== 'door' || door.locked) return;
    if (Math.hypot(p.x - door.cx, p.z - door.cz) > DOOR_REACH + 0.5 || Math.abs(p.y - door.y) > 1.5) return;
    const open = !room.openDoors.has(door.id);
    if (open) room.openDoors.add(door.id);
    else room.openDoors.delete(door.id);
    room.mover.setDoor(door.id, open);
    io.to(room.code).emit('door', [door.id, open ? 1 : 0]);
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
function tick() {
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
      const [nx, ny, nz] = room.mover.step(p.x, p.y, p.z, p.ix, p.iy, p.yaw, TICK_DT);
      if (Math.abs(nx - p.x) + Math.abs(ny - p.y) + Math.abs(nz - p.z) > 0.0005) {
        p.x = nx;
        p.y = ny;
        p.z = nz;
        changed = true;
      }
      // fell out of the world somehow? back to the entrance
      if (p.y < -10) {
        ({ x: p.x, y: p.y, z: p.z } = LAYOUT.spawns[p.slot]);
        changed = true;
      }
    }
    updateGhosts(room, now);

    if (room.players.size === 0) {
      rooms.delete(room.code);
      continue;
    }
    if (changed) {
      // Flat compact array: [slot, x, y, z, ack, yaw, pitch,  slot, x, y, ...]
      const snap: number[] = [];
      for (const p of room.players.values()) snap.push(p.slot, r2(p.x), r2(p.y), r2(p.z), p.seq, r2(p.yaw), r2(p.pitch));
      io.to(room.code).volatile.emit('st', snap); // volatile = ok to drop if the network is busy
    }
  }
}

// ---------- ghosts ----------
// A ghost stands still. If someone's flashlight points straight at it (and no
// wall is in the way) it vanishes, then reappears at another spot nearby.
const GHOST_TOP = 2.3; // the figure is about this tall

/** Is someone's flashlight beam hitting the ghost standing at (x, y, z)? */
function litByFlashlight(room: Room, x: number, y: number, z: number): boolean {
  for (const p of room.players.values()) {
    if (!p.sock) continue;
    const ex = p.x;
    const ey = p.y + EYE_HEIGHT;
    const ez = p.z;
    // flat (left/right) part of where the player looks
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const vx = x - ex;
    const vz = z - ez;
    const along = vx * fx + vz * fz; // how far in front of the player the ghost is
    if (along < 0.5 || along > 25) continue; // about as far as the flashlight reaches
    const side = Math.abs(vx * fz - vz * fx); // how far the beam passes beside it
    if (side > 0.45 + along * 0.02) continue; // "straight at it" = the middle of the beam hits its body
    const beamY = ey + Math.tan(p.pitch) * along; // the beam's height when it reaches the ghost
    if (beamY < y + 0.1 || beamY > y + GHOST_TOP) continue; // over its head / at the floor in front
    if (room.mover.lineOfSight(ex, ey, ez, x, Math.min(beamY, y + 2), z)) return true;
  }
  return false;
}

function updateGhosts(room: Room, now: number) {
  room.ghosts.forEach((g, i) => {
    if (g.spot >= 0) {
      const s = LAYOUT.ghostSpots[g.spot];
      if (litByFlashlight(room, s.x, s.y, s.z)) {
        g.last = g.spot;
        g.spot = -1;
        g.backAt = now + 2500 + Math.random() * 3500;
        io.to(room.code).emit('gh', [i, -1]);
      }
    } else if (now > g.backAt) {
      // pick a nearby spot that is free, not right next to a player, and not lit right now
      const from = LAYOUT.ghostSpots[g.last];
      const taken = new Set(room.ghosts.map((o) => o.spot));
      const ok = LAYOUT.ghostSpots
        .map((s, idx) => ({ s, idx, d: dist3(s, from) }))
        .filter(({ s, idx }) => idx !== g.last && !taken.has(idx)
          && [...room.players.values()].every((p) => dist3(p, s) > 5)
          && !litByFlashlight(room, s.x, s.y, s.z))
        .sort((a, b) => a.d - b.d);
      if (!ok.length) {
        g.backAt = now + 1000; // try again in a second
        return;
      }
      const pick = ok[Math.floor(Math.random() * Math.min(3, ok.length))]; // one of the 3 closest
      g.spot = pick.idx;
      io.to(room.code).emit('gh', [i, g.spot]);
    }
  });
}

// Start: load the physics engine first, then open the doors
for (const w of LAYOUT.warnings) console.warn('MAP WARNING:', w);
initPhysics().then(() => {
  setInterval(tick, 1000 / TICK_RATE);
  server.listen(PORT, () => console.log(`Game server running on port ${PORT}`));
});

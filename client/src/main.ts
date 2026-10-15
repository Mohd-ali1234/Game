// =====================================================================
// client/src/main.ts
// The "glue": loading screen -> lobby -> mic question -> game room,
// plus reconnecting, the HUD buttons and the debug panel.
// =====================================================================
import './style.css';
import { io } from 'socket.io-client';
import { MAX_PLAYERS } from '../../shared/game';
import { AVATARS, avatarCanvas } from './avatars';
import { createGame, GameHandle, PlayerInfo, World } from './game';
import { DebugPanel, isTouchDevice, Joystick, toast } from './ui';
import { Voice } from './voice';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (el: HTMLElement, on: boolean) => el.classList.toggle('hidden', !on);

interface JoinReply {
  ok: boolean;
  err?: string;
  code: string;
  slot: number;
  token: string;
  players: PlayerInfo[];
}

// ---------- debug panel first, so it catches every error ----------
const debug = new DebugPanel($('debug'));
debug.set('status', 'connecting');
debug.set('ping', '-');
debug.set('fps', '-');
debug.set('players', 0);

// ---------- network ----------
const socket = io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 3000 });
const voice = new Voice();
voice.log = (m) => debug.log(m);
voice.attach(socket);
const joystick = new Joystick($('joyArea'));
joystick.show(false);

let world: World | null = null;
let gameHandle: GameHandle | null = null;
let session: { code: string; token: string; slot: number } | null = null;
let everConnected = false;
let ping = 0;

// ---------- 1. loading screen ("waking up the server...") ----------
const loadStart = Date.now();
const loadTimer = setInterval(() => {
  const s = Math.round((Date.now() - loadStart) / 1000);
  $('loadingText').textContent = s < 5 ? 'Waking up the server...' : `Waking up the server... ${s}s`;
}, 1000);

socket.on('connect', () => {
  debug.set('status', 'connected');
  debug.log('connected');
  show($('banner'), false);
  if (!everConnected) {
    everConnected = true;
    clearInterval(loadTimer);
    show($('loading'), false);
    show($('lobby'), true);
  } else if (session) {
    rejoin(); // we dropped and came back -> get our old spot back
  }
});
socket.on('connect_error', (e) => {
  debug.set('status', 'cannot connect');
  debug.log('connect_error: ' + e.message);
});
socket.on('disconnect', (reason) => {
  debug.set('status', 'disconnected');
  debug.log('disconnected: ' + reason);
  if (session) show($('banner'), true);
  if (reason === 'io server disconnect') socket.connect();
});

// ---------- 2. lobby ----------
let selectedAvatar = 0;
let micDecided = false;
const nameInput = $<HTMLInputElement>('nameInput');
const codeInput = $<HTMLInputElement>('codeInput');
const lobbyMsg = $('lobbyMsg');

try {
  nameInput.value = localStorage.getItem('dh_name') ?? '';
  selectedAvatar = Number(localStorage.getItem('dh_av') ?? 0) % AVATARS.length;
} catch { /* storage may be blocked; that's fine */ }

const grid = $('avatarGrid');
AVATARS.forEach((a, i) => {
  const b = document.createElement('button');
  b.title = a.name;
  b.appendChild(avatarCanvas(i));
  b.addEventListener('click', () => {
    selectedAvatar = i;
    refreshAvatars();
  });
  grid.appendChild(b);
});
function refreshAvatars() {
  [...grid.children].forEach((el, i) => el.classList.toggle('selected', i === selectedAvatar));
}
refreshAvatars();

// A link like  https://yourgame.onrender.com/?room=ABCD  pre-fills the code
const urlRoom = (new URLSearchParams(location.search).get('room') ?? '').toUpperCase().slice(0, 4);
if (urlRoom) {
  codeInput.value = urlRoom;
  const note = $('inviteNote');
  note.textContent = `You're invited to room ${urlRoom}! Enter your name, pick an avatar, then tap Join Room.`;
  show(note, true);
}
codeInput.addEventListener('input', () => (codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '')));

$('createBtn').addEventListener('click', () => start('create'));
$('joinBtn').addEventListener('click', () => start('join'));

async function start(kind: 'create' | 'join') {
  const name = nameInput.value.trim();
  if (!name) return (lobbyMsg.textContent = 'Please type your name first.');
  if (kind === 'join' && codeInput.value.length !== 4) return (lobbyMsg.textContent = 'Room codes have 4 letters.');
  lobbyMsg.textContent = '';
  try {
    localStorage.setItem('dh_name', name);
    localStorage.setItem('dh_av', String(selectedAvatar));
  } catch { /* ignore */ }

  voice.unlockAudio(); // must happen inside a tap on phones
  if (!micDecided) await askForMic();

  lobbyMsg.textContent = 'Connecting…';
  const event = kind === 'create' ? 'create' : 'join';
  socket.timeout(10000).emit(event, { name, av: selectedAvatar, code: codeInput.value }, (err: Error | null, res: JoinReply) => {
    if (err) return (lobbyMsg.textContent = 'The server did not answer. Try again in a few seconds.');
    if (!res.ok) return (lobbyMsg.textContent = res.err ?? 'Could not join.');
    lobbyMsg.textContent = '';
    enterRoom(res);
  });
}

/** Show our friendly explanation first, then the browser's permission pop-up. */
function askForMic(): Promise<void> {
  return new Promise((resolve) => {
    show($('micModal'), true);
    const done = async (wantMic: boolean) => {
      show($('micModal'), false);
      if (wantMic) {
        const ok = await voice.requestMic();
        if (!ok) toast('No microphone - you can still play and listen!');
      }
      micDecided = true;
      resolve();
    };
    $('micYes').onclick = () => void done(true);
    $('micNo').onclick = () => void done(false);
  });
}

// ---------- 3. inside the room ----------
function enterRoom(res: JoinReply) {
  session = { code: res.code, token: res.token, slot: res.slot };
  history.replaceState(null, '', `?room=${res.code}`);
  $('roomCode').textContent = res.code;

  world = new World(res.slot, res.players, (seq, ix, iy) => socket.emit('in', [seq, ix, iy]));
  show($('lobby'), false);
  show($('hud'), true);
  joystick.show(isTouchDevice());
  gameHandle = createGame($('game'), { world, voice, getStick: () => joystick });
  connectVoiceToEveryone(res.players);
  refreshMuteButton();
  toast(voice.micState === 'on' ? 'Voice chat on - use headphones 🎧' : 'Playing without a microphone');
}

/** Voice: the player with the lower slot number starts each connection. */
function connectVoiceToEveryone(players: PlayerInfo[]) {
  if (!session) return;
  voice.closeAll();
  for (const p of players) if (p.s !== session.slot) void voice.connectTo(p.s, session.slot < p.s);
}

function rejoin() {
  if (!session) return;
  debug.log('rejoining room ' + session.code);
  socket.timeout(8000).emit('rejoin', { code: session.code, token: session.token }, (err: Error | null, res: JoinReply) => {
    if (err || !res?.ok) return leaveRoom(res?.err ?? 'Could not reconnect to the room.');
    world?.resync(res.players);
    connectVoiceToEveryone(res.players);
    toast('Reconnected!');
  });
}

function leaveRoom(message = '') {
  if (session) socket.emit('leave');
  session = null;
  world = null;
  gameHandle?.destroy();
  gameHandle = null;
  voice.closeAll();
  joystick.show(false);
  show($('hud'), false);
  show($('banner'), false);
  show($('lobby'), true);
  history.replaceState(null, '', location.pathname);
  lobbyMsg.textContent = message;
  debug.set('players', 0);
}

// Messages from the server while playing
socket.on('st', (snap: number[]) => world?.onSnapshot(snap));
socket.on('pj', (p: PlayerInfo) => {
  if (!world || !session) return;
  const isNew = !world.infos.has(p.s);
  world.addPlayer(p);
  void voice.connectTo(p.s, session.slot < p.s);
  if (isNew) toast(`${p.n} joined`);
});
socket.on('pl', (slot: number) => {
  const name = world?.infos.get(slot)?.n;
  world?.removePlayer(slot);
  voice.closePeer(slot); // close their voice link
  if (name) toast(`${name} left`);
});
socket.on('sig', (m: { from: number; d: unknown }) => void voice.handleSignal(m.from, m.d));

// ---------- HUD buttons ----------
function refreshMuteButton() {
  const b = $('muteBtn');
  if (voice.micState !== 'on') {
    b.textContent = '🚫';
    b.title = 'No microphone';
    b.classList.add('off');
    return;
  }
  b.textContent = voice.muted ? '🔇' : '🎤';
  b.classList.toggle('off', voice.muted);
}
$('muteBtn').addEventListener('click', () => {
  if (voice.micState !== 'on') return toast('Microphone is off (permission was not given).');
  voice.setMuted(!voice.muted);
  refreshMuteButton();
});
$('debugBtn').addEventListener('click', () => debug.toggle());
$('leaveBtn').addEventListener('click', () => leaveRoom());
$('shareBtn').addEventListener('click', async () => {
  if (!session) return;
  const link = `${location.origin}/?room=${session.code}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Dark Hunt', text: 'Join my room!', url: link });
    else {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied!');
    }
  } catch {
    toast(link); // last resort: show it so it can be copied by hand
  }
});
// Closing the tab = leave right away so friends don't see a ghost
window.addEventListener('pagehide', () => {
  if (session) socket.emit('leave');
});

// ---------- ping + stats, twice a second ----------
setInterval(() => {
  if (!socket.connected) return;
  const t = performance.now();
  socket.emit('pg', () => (ping = Math.round(performance.now() - t)));
}, 2000);
setInterval(() => {
  debug.set('ping', socket.connected ? ping + ' ms' : '-');
  debug.set('fps', world ? Math.round(world.fps) : '-');
  debug.set('players', world ? `${world.infos.size}/${MAX_PLAYERS}` : 0);
  debug.set('mic', voice.micState + (voice.muted ? ' (muted)' : ''));
  if (world) $('playerCount').textContent = String(world.infos.size);
  debug.render();
}, 500);

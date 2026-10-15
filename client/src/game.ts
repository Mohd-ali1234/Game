// =====================================================================
// client/src/game.ts
// The first-person 3D game (Three.js) inside the haunted mansion.
//
//  World      = plain data about the room (who is where, which way they look).
//               The network code writes into it; the 3D view reads from it.
//  createView = loads textures/models (with a loading bar), builds the
//               mansion, and runs every frame: your movement (prediction),
//               other players (interpolation), the flashlight, doors,
//               ghosts, sounds and camera effects.
// =====================================================================
import * as THREE from 'three';
import { DOOR_REACH, EYE_HEIGHT, MAX_PLAYERS, Mover, TICK_DT } from '../../shared/game';
import { Layout, roomAt } from '../../shared/layout';
import { Assets, Progress } from './assets';
import { Avatar3D, buildAvatar, FLASH_ANGLE, FLASH_RANGE } from './avatar3d';
import { Ghosts } from './ghost';
import { buildMansion, Mansion } from './mansion';
import { buildMaterials, Quality } from './materials';
import { createPost, Post } from './post';
import { flashlightCookie } from './procedural';
import { Soundscape } from './sound';
import type { Settings } from './ui';
import { HEAR_FULL, HEAR_MAX, Voice } from './voice';

export interface PlayerInfo {
  s: number; // slot
  n: string; // name
  a: number; // avatar
  x: number;
  y: number;
  z: number;
  w: number; // yaw (facing)
}

interface Sample {
  t: number; // when we received it (ms)
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

const INTERP_DELAY = 120; // draw other players 120 ms in the past so we always have 2 points to glide between
const TICK_MS = TICK_DT * 1000;
const PITCH_LIMIT = 1.45; // can't look past straight up/down

/** Turn an angle into the range -PI..PI. */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------------------------------------------------------------------
// World: the data
// ---------------------------------------------------------------------
export class World {
  infos = new Map<number, PlayerInfo>();
  private buffers = new Map<number, Sample[]>(); // recent positions of OTHER players
  // my own player (predicted locally)
  lx = 0;
  ly = 0;
  lz = 0;
  yaw = 0; // where I look (left/right)
  pitch = 0; // where I look (up/down)
  private seq = 0;
  private pending: { seq: number; ix: number; iy: number; yaw: number }[] = []; // inputs the server hasn't confirmed yet
  private corrX = 0; // position fix still to apply (spread over a few frames so the camera never jumps)
  private corrY = 0;
  private corrZ = 0;
  private clockOffset: number | null = null; // local time minus server time (for steady interpolation)

  constructor(
    public me: number,
    players: PlayerInfo[],
    public mover: Mover,
    private sendInput: (seq: number, ix: number, iy: number, yaw: number, pitch: number) => void,
  ) {
    this.resync(players);
  }

  /** Replace everything with a fresh list from the server (join / reconnect). */
  resync(players: PlayerInfo[]) {
    this.infos.clear();
    this.buffers.clear();
    this.pending = [];
    const now = performance.now();
    for (const p of players) {
      this.infos.set(p.s, p);
      if (p.s === this.me) {
        this.lx = p.x;
        this.ly = p.y;
        this.lz = p.z;
        if (this.seq === 0) this.yaw = p.w; // first join: face the spawn direction
      } else {
        this.buffers.set(p.s, [{ t: now, x: p.x, y: p.y, z: p.z, yaw: p.w, pitch: 0 }]);
      }
    }
  }

  addPlayer(p: PlayerInfo) {
    this.infos.set(p.s, p);
    this.buffers.set(p.s, [{ t: performance.now(), x: p.x, y: p.y, z: p.z, yaw: p.w, pitch: 0 }]);
  }

  removePlayer(slot: number) {
    this.infos.delete(slot);
    this.buffers.delete(slot);
  }

  /** Server update: [tick,  slot, x, y, z, ack, yaw, pitch,  slot, x, ...] */
  onSnapshot(a: number[]) {
    const now = performance.now();
    // Time each update by the SERVER's clock, not by when it arrived: packets often arrive
    // in bursts on mobile data, and using arrival time would make other players stutter.
    const serverMs = a[0] * TICK_MS;
    const seen = now - serverMs;
    this.clockOffset = this.clockOffset === null ? seen : Math.min(seen, this.clockOffset + 2); // follows the fastest arrivals
    const t = serverMs + this.clockOffset;
    for (let i = 1; i + 6 < a.length; i += 7) {
      const slot = a[i];
      if (slot === this.me) {
        this.reconcile(a[i + 1], a[i + 2], a[i + 3], a[i + 4]);
      } else {
        const buf = this.buffers.get(slot);
        if (!buf) continue;
        const last = buf[buf.length - 1];
        buf.push({ t: Math.max(t, last ? last.t + 1 : t), x: a[i + 1], y: a[i + 2], z: a[i + 3], yaw: a[i + 5], pitch: a[i + 6] });
        if (buf.length > 12) buf.shift();
      }
    }
  }

  /**
   * Prediction fix-up. The server says "you are here after input #ack".
   * We replay the inputs it hasn't seen yet to guess where we SHOULD be now,
   * then glide toward that over the next few frames (tiny differences are ignored,
   * a big error just snaps).
   */
  private reconcile(sx: number, sy: number, sz: number, ack: number) {
    this.pending = this.pending.filter((p) => p.seq > ack);
    let [ex, ey, ez] = [sx, sy, sz];
    for (const p of this.pending) [ex, ey, ez] = this.mover.step(ex, ey, ez, p.ix, p.iy, p.yaw, TICK_DT);
    const dx = ex - this.lx;
    const dy = ey - this.ly;
    const dz = ez - this.lz;
    const err = Math.hypot(dx, dy, dz);
    if (err > 1.2) {
      this.lx = ex; // way off -> snap
      this.ly = ey;
      this.lz = ez;
      this.corrX = this.corrY = this.corrZ = 0;
    } else if (err > 0.04) {
      this.corrX = dx; // a little off -> fix smoothly in moveMine()
      this.corrY = dy;
      this.corrZ = dz;
    } else {
      this.corrX = this.corrY = this.corrZ = 0; // close enough: leave the camera alone
    }
  }

  /** Move my player right now (the same Rapier physics as the server). */
  moveMine(ix: number, iy: number, dtSeconds: number) {
    [this.lx, this.ly, this.lz] = this.mover.step(this.lx, this.ly, this.lz, ix, iy, this.yaw, dtSeconds);
    // apply part of any pending correction each frame
    const k = 1 - Math.exp(-dtSeconds * 8);
    this.lx += this.corrX * k;
    this.ly += this.corrY * k;
    this.lz += this.corrZ * k;
    this.corrX -= this.corrX * k;
    this.corrY -= this.corrY * k;
    this.corrZ -= this.corrZ * k;
  }

  /** Send my input + look direction to the server (called every 50 ms). */
  sendMine(ix: number, iy: number) {
    this.seq++;
    this.pending.push({ seq: this.seq, ix, iy, yaw: this.yaw });
    if (this.pending.length > 60) this.pending.shift();
    this.sendInput(this.seq, ix, iy, this.yaw, this.pitch);
  }

  /** Where to DRAW another player right now (smoothly between two updates). */
  stateOf(slot: number, now: number): Sample | null {
    const buf = this.buffers.get(slot);
    if (!buf || buf.length === 0) return null;
    const t = now - INTERP_DELAY;
    if (t <= buf[0].t) return buf[0];
    for (let i = 0; i < buf.length - 1; i++) {
      const a = buf[i];
      const b = buf[i + 1];
      if (t >= a.t && t <= b.t) {
        const f = (t - a.t) / Math.max(1, b.t - a.t);
        return {
          t,
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f,
          z: a.z + (b.z - a.z) * f,
          yaw: a.yaw + wrap(b.yaw - a.yaw) * f,
          pitch: a.pitch + (b.pitch - a.pitch) * f,
        };
      }
    }
    return buf[buf.length - 1];
  }
}

// ---------------------------------------------------------------------
// The 3D view
// ---------------------------------------------------------------------
export interface ViewData {
  world: World;
  layout: Layout;
  voice: Voice;
  settings: Settings;
  openDoors: string[]; // doors already open when we joined
  ghostSpots: number[]; // where the ghosts are when we joined
  getStick: () => { x: number; y: number };
  consumeLook: () => { dx: number; dy: number }; // touch look (pixels moved)
  onLockChange?: (locked: boolean) => void;
  onProgress: (fraction: number, label: string) => void; // loading bar
  onPrompt: (text: string | null) => void; // "E / ✋: open door" hint
  requestDoor: (id: string) => void; // ask the server to open/close a door
  onLocked: (message: string) => void;
  onNotice?: (message: string) => void; // e.g. "switched to Low graphics"
}

export interface ViewStats {
  fps: number;
  calls: number;
  triangles: number;
  pixelRatio: number;
  quality: Quality;
  where: string; // position + room name (handy when editing the map file)
}

export interface ViewHandle {
  ready: Promise<void>;
  setDoor(id: string, open: boolean, withSound: boolean): void;
  setGhost(index: number, spot: number): void;
  interact(): void;
  stats(): ViewStats;
  destroy(): void;
}

const QUALITY: Record<Quality, { ratio: number; shadow: number; remoteLights: number }> = {
  low: { ratio: 1, shadow: 0, remoteLights: 0 },
  medium: { ratio: 1, shadow: 512, remoteLights: 1 },
  high: { ratio: 2, shadow: 1024, remoteLights: 3 },
};

export function createView(parent: HTMLElement, data: ViewData): ViewHandle {
  const { world, voice, settings, layout } = data;
  const builtQuality = settings.quality; // texture sizes are chosen once, when you join

  // ---------- renderer, scene, camera ----------
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.info.autoReset = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  parent.appendChild(renderer.domElement);
  renderer.domElement.className = 'game-canvas';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020202);
  scene.fog = new THREE.FogExp2(0x050403, 0.055); // long corridors fade into darkness
  scene.add(new THREE.AmbientLight(0x2a2230, 0.09)); // just enough to make out shapes

  // near/far kept tight (fog hides everything past ~40 m anyway): sharper depth = no flickering surfaces on phones
  const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.08, 45);
  camera.rotation.order = 'YXZ'; // yaw first, then pitch (normal FPS camera)
  scene.add(camera);

  // ---------- my flashlight: warm, uneven ("cookie"), swaying, flickering ----------
  const FLASH_POWER = 120;
  const cookie = flashlightCookie();
  const flash = new THREE.SpotLight(0xffc678, FLASH_POWER, FLASH_RANGE, FLASH_ANGLE, 0.55, 2);
  const flashTarget = new THREE.Object3D();
  scene.add(flash, flashTarget);
  flash.target = flashTarget;
  let aimYaw = world.yaw;
  let aimPitch = world.pitch;
  let walkPhase = 0;

  // ---------- other players' flashlights: a few shared lights moved to the nearest players ----------
  let pool: THREE.SpotLight[] = [];
  const avatars = new Map<number, Avatar3D & { stepDist: number; lastX: number; lastZ: number }>();

  // ---------- quality: shadows, resolution, effects ----------
  let post: Post | null = null;
  let dynScale = 1; // drops automatically if the phone can't keep up
  function applyQuality() {
    const q = QUALITY[settings.quality];
    renderer.shadowMap.enabled = q.shadow > 0;
    renderer.shadowMap.type = settings.quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    flash.castShadow = q.shadow > 0;
    flash.map = q.shadow > 0 ? cookie : null; // (three.js needs shadows on for a spotlight cookie)
    flash.shadow.mapSize.set(q.shadow || 512, q.shadow || 512);
    flash.shadow.bias = -0.0005;
    flash.shadow.normalBias = q.shadow <= 512 ? 0.045 : 0.03; // stops speckled "shadow acne" on walls
    flash.shadow.camera.near = 0.15;
    flash.shadow.camera.far = FLASH_RANGE;
    flash.shadow.map?.dispose();
    flash.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    // remote flashlight pool (changing the number of lights rebuilds shaders, so only on settings change)
    for (const l of pool) scene.remove(l, l.target);
    pool = Array.from({ length: Math.min(q.remoteLights, MAX_PLAYERS - 1) }, () => {
      const l = new THREE.SpotLight(0xffcf88, 0, FLASH_RANGE * 0.8, FLASH_ANGLE, 0.6, 2);
      scene.add(l, l.target);
      return l;
    });
    camera.fov = settings.fov;
    post?.dispose();
    post = createPost(renderer, scene, camera, settings.quality);
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true; // shaders must be rebuilt when shadows switch on/off
    });
    resize();
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY[settings.quality].ratio) * dynScale);
    renderer.setSize(w, h);
    post?.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // ---------- controls ----------
  const keys = new Set<string>();
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    keys.add(e.code);
    if (e.code === 'KeyE' && !e.repeat) interact();
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  const onBlur = () => keys.clear();

  const canvas = renderer.domElement;
  const hasPointerLock = 'requestPointerLock' in canvas && !window.matchMedia('(pointer: coarse)').matches;
  const onMouseMove = (e: MouseEvent) => {
    const locked = document.pointerLockElement === canvas;
    if (!locked && !(e.buttons & 1)) return; // not locked: only look while dragging
    const k = 0.0022 * settings.sens;
    world.yaw = wrap(world.yaw - e.movementX * k);
    world.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, world.pitch - e.movementY * k));
  };
  const onCanvasClick = () => {
    if (hasPointerLock && document.pointerLockElement !== canvas) void canvas.requestPointerLock?.();
  };
  const onLockChange = () => data.onLockChange?.(document.pointerLockElement === canvas);
  // Phones sometimes reset the graphics chip (e.g. after switching apps). Recover instead of staying black.
  const onContextLost = (e: Event) => {
    e.preventDefault(); // allows the browser to give the context back
    console.warn('Graphics were reset by the device - restoring...');
  };
  const onContextRestored = () => {
    console.warn('Graphics restored.');
    applyQuality();
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('resize', resize);
  canvas.addEventListener('click', onCanvasClick);
  document.addEventListener('pointerlockchange', onLockChange);
  const stopListening = settings.onChange(applyQuality);

  // ---------- loading: textures, models, building the house ----------
  let mansion: Mansion | null = null;
  let ghosts: Ghosts | null = null;
  let sound: Soundscape | null = null;
  let raf = 0;
  let last = performance.now();
  let destroyed = false;
  const assets = new Assets(renderer);
  const ready = (async () => {
    const progress = new Progress(data.onProgress);
    progress.add(1);
    await assets.loadManifest();
    progress.finish(1, 'file list');
    const mats = await buildMaterials(assets, builtQuality, progress, renderer.capabilities.getMaxAnisotropy());
    const BUILD = 400_000;
    progress.add(BUILD);
    const m = await buildMansion(layout, mats, assets, progress);
    if (destroyed) return;
    mansion = m;
    scene.add(m.group);
    for (const id of data.openDoors) {
      m.setDoor(id, true);
      world.mover.setDoor(id, true);
    }
    m.update(10); // doors that are already open: snap them open
    ghosts = new Ghosts(scene, layout, assets, data.ghostSpots);
    const ac = voice.audioContext();
    if (ac) sound = new Soundscape(ac, assets, layout);
    applyQuality();
    renderer.compile(scene, camera); // build shaders now, not on the first frames
    progress.finish(BUILD, 'house built');
    if (hasPointerLock) data.onLockChange?.(false);
    last = performance.now();
    raf = requestAnimationFrame(frame);
  })();

  // ---------- doors ----------
  let promptDoor: string | null = null;
  function nearestDoor() {
    const fx = -Math.sin(world.yaw);
    const fz = -Math.cos(world.yaw);
    let best: { id: string; d: number; locked: boolean; label: string; open: boolean } | null = null;
    for (const d of layout.doors) {
      if (d.type !== 'door' || Math.abs(d.y - world.ly) > 1.5) continue;
      const dx = d.cx - world.lx;
      const dz = d.cz - world.lz;
      const dist = Math.hypot(dx, dz);
      if (dist > DOOR_REACH) continue;
      if (dist > 0.6 && (dx * fx + dz * fz) / dist < 0.35) continue; // must be roughly in front of you
      if (!best || dist < best.d) best = { id: d.id, d: dist, locked: d.locked, label: d.label, open: !!mansion?.doors.get(d.id)?.open };
    }
    return best;
  }
  function interact() {
    const d = nearestDoor();
    if (!d) return;
    if (d.locked) {
      const door = layout.doors.find((x) => x.id === d.id)!;
      sound?.doorLocked(door.cx, door.y + 1, door.cz);
      data.onLocked(d.label);
    } else data.requestDoor(d.id);
  }

  // ---------- the game loop ----------
  let sendTimer = 0;
  let lastSent = '';
  let fps = 60;
  let perfTimer = 0;
  let perfFrames = 0;
  let stepDist = 0;
  let prevX = world.lx;
  let prevZ = world.lz;
  const dir = new THREE.Vector3();

  function frame(nowMs: number) {
    raf = requestAnimationFrame(frame);
    if (!mansion || !post) return;
    const dtMs = Math.min(nowMs - last, 250); // (a big clamp: slow phones must still walk at full speed)
    last = nowMs;
    const dt = Math.max(0, dtMs) / 1000;
    renderer.info.reset();

    // ---- 1. look: touch drag on the right half of the screen ----
    const look = data.consumeLook();
    if (look.dx || look.dy) {
      const k = 0.0045 * settings.sens;
      world.yaw = wrap(world.yaw - look.dx * k);
      world.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, world.pitch - look.dy * k));
    }

    // ---- 2. move: WASD / arrows or the left-thumb joystick ----
    let ix = 0;
    let iy = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 100;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 100;
    if (keys.has('KeyW') || keys.has('ArrowUp')) iy -= 100;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iy += 100;
    const stick = data.getStick();
    if (stick.x !== 0 || stick.y !== 0) {
      ix = Math.round(stick.x * 100);
      iy = Math.round(stick.y * 100);
    }

    // ---- 3. predict: my player moves right away (gravity too, so always step) ----
    world.moveMine(ix, iy, dt);

    // ---- 4. tell the server 20 times per second (when moving, looking, or just stopped) ----
    sendTimer += dtMs;
    if (sendTimer >= 50) {
      sendTimer = 0;
      const sig = `${ix},${iy},${world.yaw.toFixed(3)},${world.pitch.toFixed(3)}`;
      if (ix !== 0 || iy !== 0 || sig !== lastSent) world.sendMine(ix, iy);
      lastSent = sig;
    }

    // ---- 5. camera = my eyes (with a gentle head bob while walking) ----
    const moved = Math.hypot(world.lx - prevX, world.lz - prevZ);
    prevX = world.lx;
    prevZ = world.lz;
    walkPhase += moved * 3.2;
    const bob = moved > 0.001 ? 1 : 0;
    camera.position.set(world.lx, world.ly + EYE_HEIGHT + Math.abs(Math.sin(walkPhase)) * 0.025 * bob, world.lz);
    camera.rotation.set(world.pitch, world.yaw, 0);
    stepDist += moved;
    if (stepDist > 0.75) {
      stepDist = 0;
      sound?.footstep(world.lx, world.ly, world.lz, true);
    }

    // ---- 6. my flashlight: lags a little behind your view and sways as you walk ----
    const lag = 1 - Math.exp(-dt * 14);
    aimYaw += wrap(world.yaw - aimYaw) * lag;
    aimPitch += (world.pitch - aimPitch) * lag;
    const swayY = aimYaw + Math.sin(walkPhase) * 0.018 * bob;
    const swayP = aimPitch + Math.cos(walkPhase * 2) * 0.012 * bob;
    dir.set(-Math.sin(swayY) * Math.cos(swayP), Math.sin(swayP), -Math.cos(swayY) * Math.cos(swayP));
    const rx = Math.cos(world.yaw);
    const rz = -Math.sin(world.yaw);
    flash.position.set(camera.position.x + rx * 0.2, camera.position.y - 0.22, camera.position.z + rz * 0.2);
    flashTarget.position.copy(flash.position).addScaledVector(dir, 6);
    // it flickers when a ghost is near
    const gd = ghosts?.nearestDistance(world.lx, world.ly, world.lz) ?? Infinity;
    flash.intensity = FLASH_POWER * flicker(gd, nowMs);

    // ---- 7. other players: add / remove / glide / footsteps / their flashlights ----
    for (const [slot, a] of avatars) {
      if (!world.infos.has(slot)) {
        scene.remove(a.group);
        avatars.delete(slot);
      }
    }
    const now = performance.now();
    const close: { a: Avatar3D; d: number; gd: number }[] = [];
    for (const info of world.infos.values()) {
      if (info.s === world.me) continue;
      let a = avatars.get(info.s);
      if (!a) {
        a = Object.assign(buildAvatar(info.a, info.n, assets), { stepDist: 0, lastX: info.x, lastZ: info.z });
        avatars.set(info.s, a);
        scene.add(a.group);
      }
      const st = world.stateOf(info.s, now);
      if (!st) continue;
      a.group.position.set(st.x, st.y, st.z);
      a.group.rotation.y = st.yaw;
      a.pivot.rotation.x = st.pitch;
      a.update(now / 1000);
      a.stepDist += Math.hypot(st.x - a.lastX, st.z - a.lastZ);
      a.lastX = st.x;
      a.lastZ = st.z;
      if (a.stepDist > 0.75) {
        a.stepDist = 0;
        sound?.footstep(st.x, st.y, st.z, false);
      }
      const d = Math.hypot(st.x - world.lx, (st.y - world.ly) * 1.5, st.z - world.lz);
      close.push({ a, d, gd: ghosts?.nearestDistance(st.x, st.y, st.z) ?? Infinity });
      // proximity voice: closer = louder, far = silent
      const vol = d <= HEAR_FULL ? 1 : d >= HEAR_MAX ? 0 : Math.pow(1 - (d - HEAR_FULL) / (HEAR_MAX - HEAR_FULL), 2);
      voice.setVolume(info.s, vol);
      a.talk.visible = voice.isSpeaking(info.s);
    }
    close.sort((p, q) => p.d - q.d);
    pool.forEach((l, i) => {
      const c = close[i];
      if (!c || c.d > 25) {
        l.intensity = 0;
        return;
      }
      c.a.group.updateMatrixWorld();
      c.a.lamp.getWorldPosition(l.position);
      c.a.aim.getWorldPosition(l.target.position);
      l.intensity = 70 * flicker(c.gd, nowMs + i * 777);
    });

    // ---- 8. the house, ghosts, sounds ----
    mansion.update(dt);
    ghosts?.update(dt, camera);
    sound?.setListener(world.lx, world.ly, world.lz, world.yaw);
    sound?.update(gd);
    const near = nearestDoor();
    const promptKey = near ? `${near.id}:${near.open}:${near.locked}` : null;
    if (promptKey !== promptDoor) {
      promptDoor = promptKey;
      data.onPrompt(near ? (near.locked ? 'Try the door' : near.open ? 'Close door' : 'Open door') : null);
    }

    post.render(dt);

    // ---- 9. keep it smooth ----
    // Every 2 s: if the phone struggles, lower the resolution a step. Raise it again only after
    // a long smooth stretch (changing it often causes hitches). If even the lowest resolution
    // is too slow, drop the quality preset once (unless you picked it yourself in settings).
    perfTimer += dtMs;
    perfFrames++;
    if (perfTimer > 2000) {
      fps = (perfFrames * 1000) / perfTimer;
      perfTimer = 0;
      perfFrames = 0;
      if (fps < 40) {
        smoothWindows = 0;
        if (dynScale > 0.65) {
          dynScale = Math.round((dynScale - 0.1) * 100) / 100;
          resize();
        } else if (++slowWindows >= 2 && !settings.qualityChosen && settings.quality !== 'low') {
          const lower = settings.quality === 'high' ? 'medium' : 'low';
          slowWindows = 0;
          dynScale = 1;
          settings.update({ quality: lower });
          data.onNotice?.(`Switched to ${lower === 'low' ? 'Low' : 'Medium'} graphics for smoother play (change it in ⚙️).`);
        }
      } else {
        slowWindows = 0;
        if (fps > 55 && dynScale < 1 && ++smoothWindows >= 5) {
          smoothWindows = 0;
          dynScale = Math.min(1, Math.round((dynScale + 0.1) * 100) / 100);
          resize();
        }
      }
    }
  }
  let slowWindows = 0;
  let smoothWindows = 0;

  /** 1 = steady. Near a ghost the light stutters and sometimes nearly dies. */
  function flicker(ghostDist: number, t: number): number {
    if (ghostDist > 7) return 1;
    const k = 1 - ghostDist / 7;
    const wobble = 0.5 + 0.5 * Math.sin(t * 0.037 + Math.sin(t * 0.013) * 3);
    let v = 1 - k * 0.55 * wobble;
    if (Math.random() < k * 0.08) v *= 0.08; // sudden drop-out
    return v;
  }

  return {
    ready,
    setDoor(id: string, open: boolean, withSound: boolean) {
      world.mover.setDoor(id, open);
      if (!mansion) return;
      mansion.setDoor(id, open);
      const d = layout.doors.find((x) => x.id === id);
      if (d && withSound) sound?.doorCreak(d.cx, d.y + 1.2, d.cz);
    },
    setGhost(i: number, spot: number) {
      ghosts?.set(i, spot);
    },
    interact,
    stats: () => ({
      fps,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      pixelRatio: renderer.getPixelRatio(),
      quality: settings.quality,
      where: `${world.lx.toFixed(1)}, ${world.ly.toFixed(1)}, ${world.lz.toFixed(1)} (${roomAt(layout, world.lx, world.ly + 0.1, world.lz)?.name ?? 'outside?'})`,
    }),
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      stopListening();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('click', onCanvasClick);
      document.removeEventListener('pointerlockchange', onLockChange);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      sound?.dispose();
      ghosts?.dispose();
      mansion?.dispose();
      post?.dispose();
      assets.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

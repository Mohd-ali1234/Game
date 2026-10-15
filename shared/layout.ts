// =====================================================================
// shared/layout.ts
// Turns the map DATA file (shared/maps/mansion.json) into everything the
// game needs: walls (with holes cut for doors), floors, stairs ramps,
// doors, furniture positions, light sources, ghost spots and spawn points.
//
// The server uses this for collisions; the browser uses it to build the 3D
// world. Edit the JSON file to change rooms - no code changes needed.
// =====================================================================
import MANSION from './maps/mansion.json';
import { PROPS, PropInfo } from './props';

export const WALL_T = 0.12; // wall thickness (each room has its own wall, so two rooms = 0.24 m)
export const DOOR_W = 1.1;
export const DOOR_H = 2.3;

export type Side = 'n' | 's' | 'e' | 'w';

// ---------- what the JSON file contains ----------
export interface MapRoom {
  id: string;
  name: string;
  floor: number; // 0 = ground floor, 1 = first floor, 2 = attic
  x: number; // north-west corner (meters). North = -Z, East = +X
  z: number;
  w: number; // size along X
  d: number; // size along Z
  h?: number; // height (default = floorHeight)
  wall: string; // material names (see client/src/materials.ts)
  floorMat: string;
  ceiling: string;
  wainscot: string | false; // wooden panels on the lower 1 m of the walls
  beams?: boolean; // wooden ceiling beams (attic)
}
export interface MapDoor {
  id: string;
  between?: [string, string]; // two rooms that touch: the door goes in the middle of the shared wall
  room?: string; // OR: a door in one room's wall
  wall?: Side;
  at?: number; // 0..1 along the wall / shared edge (default 0.5)
  type?: 'door' | 'arch';
  width?: number;
  height?: number;
  locked?: boolean;
  label?: string; // message when someone tries a locked door
}
export interface MapStairs {
  id: string;
  room: string;
  x: number; // start corner inside the room
  z: number;
  width: number;
  length: number;
  dir: Side; // the direction you walk UP (n = -Z, s = +Z, e = +X, w = -X)
  rise: number; // how high it climbs
  grand?: boolean; // fancy banisters + carpet runner
}
export interface MapProp {
  type: string; // a name from shared/props.ts
  room: string;
  x?: number; // position inside the room (floor props)
  z?: number;
  y?: number; // floor props: height above floor. Wall props: height of the CENTER.
  rot?: number; // degrees
  wall?: Side; // wall props
  at?: number;
  size?: number[]; // override [width, height]
  w?: number; // rugs
  l?: number;
  with?: string; // put another prop on top (e.g. a vase on a table)
  variant?: number;
}
export interface MapData {
  name: string;
  floorHeight: number;
  ambient: string;
  ghostCount: number;
  spawn: { room: string; x: number; z: number; yaw: number };
  rooms: MapRoom[];
  doors: MapDoor[];
  stairs: MapStairs[];
  props: MapProp[];
  ghostSpots: { room: string; x: number; z: number }[];
}

// ---------- what the game uses ----------
export interface Room extends MapRoom {
  y: number; // floor height in meters
  h: number;
}
/** An axis-aligned box (walls, floors...). */
export interface Box {
  x0: number; x1: number; y0: number; y1: number; z0: number; z1: number;
}
export interface WallPiece extends Box {
  room: string;
  side: Side;
}
/** A box collider; rot = rotation around Y (radians). */
export interface ColBox {
  cx: number; cy: number; cz: number; hx: number; hy: number; hz: number; rot?: number;
}
export interface Door {
  id: string;
  type: 'door' | 'arch';
  locked: boolean;
  label: string;
  axis: 'x' | 'z'; // 'x' = the wall is the line x = const (door spans along Z)
  line: number;
  a0: number; // start/end along the wall
  a1: number;
  y: number; // floor level of the doorway
  height: number;
  swing: 1 | -1; // which side it opens towards
  cx: number; // centre of the doorway (world)
  cz: number;
  collider: ColBox; // when closed
}
export interface Stair {
  id: string;
  room: string;
  x0: number; x1: number; z0: number; z1: number;
  y0: number;
  rise: number;
  dir: Side;
  width: number;
  length: number;
  grand: boolean;
  points: number[]; // 6 corners of the ramp (for physics)
}
export interface PlacedProp {
  type: string;
  info: PropInfo;
  room: string;
  x: number; y: number; z: number; // base centre
  rot: number; // radians
  size: [number, number, number];
  wall?: Side;
  variant: number;
}
export interface BakeLight {
  room: string;
  x: number; y: number; z: number;
  color: [number, number, number];
  intensity: number;
  range: number;
  moon: boolean;
  dirX: number; // for moonlight: which way it shines into the room
  dirZ: number;
}
export interface SoundSpot {
  type: 'clock' | 'wind';
  room: string;
  x: number; y: number; z: number;
}
export interface Layout {
  name: string;
  floorHeight: number;
  ambient: string;
  ghostCount: number;
  rooms: Room[];
  roomById: Map<string, Room>;
  walls: WallPiece[];
  floors: (Box & { room: string })[];
  stairs: Stair[];
  doors: Door[];
  props: PlacedProp[];
  lights: BakeLight[];
  sounds: SoundSpot[];
  ghostSpots: { x: number; y: number; z: number; room: string }[];
  spawns: { x: number; y: number; z: number; yaw: number }[];
  colliders: ColBox[]; // everything solid that never moves
  warnings: string[];
}

interface Cut {
  axis: 'x' | 'z';
  line: number;
  a0: number;
  a1: number;
  y0: number;
  y1: number;
}

const EPS = 0.02;
const deg = (d: number) => (d * Math.PI) / 180;
const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** The wall of a room on one side: which line it sits on and which way the room is. */
function sideInfo(r: Room, side: Side) {
  switch (side) {
    case 'n': return { axis: 'z' as const, line: r.z, a0: r.x, a1: r.x + r.w, inward: 1 as const };
    case 's': return { axis: 'z' as const, line: r.z + r.d, a0: r.x, a1: r.x + r.w, inward: -1 as const };
    case 'w': return { axis: 'x' as const, line: r.x, a0: r.z, a1: r.z + r.d, inward: 1 as const };
    case 'e': return { axis: 'x' as const, line: r.x + r.w, a0: r.z, a1: r.z + r.d, inward: -1 as const };
  }
}

/** Remove door-holes (cuts) from a wall rectangle (along x height). Returns the solid parts. */
function subtract(a0: number, a1: number, y0: number, y1: number, cuts: Cut[]) {
  const marks = new Set([a0, a1]);
  for (const c of cuts) {
    if (c.a1 <= a0 || c.a0 >= a1) continue;
    marks.add(Math.max(a0, c.a0));
    marks.add(Math.min(a1, c.a1));
  }
  const xs = [...marks].sort((p, q) => p - q);
  const out: { a0: number; a1: number; y0: number; y1: number }[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const p = xs[i];
    const q = xs[i + 1];
    if (q - p < 0.005) continue;
    const mid = (p + q) / 2;
    // vertical ranges removed in this slice
    const holes = cuts.filter((c) => c.a0 <= mid && c.a1 >= mid).map((c) => [Math.max(y0, c.y0), Math.min(y1, c.y1)]).filter(([u, v]) => v > u);
    holes.sort((u, v) => u[0] - v[0]);
    let y = y0;
    for (const [u, v] of holes) {
      if (u > y + 0.005) out.push({ a0: p, a1: q, y0: y, y1: u });
      y = Math.max(y, v);
    }
    if (y1 > y + 0.005) out.push({ a0: p, a1: q, y0: y, y1 });
  }
  // join neighbours with the same height range
  const merged: typeof out = [];
  for (const piece of out) {
    const prev = merged.find((m) => Math.abs(m.a1 - piece.a0) < 0.001 && Math.abs(m.y0 - piece.y0) < 0.001 && Math.abs(m.y1 - piece.y1) < 0.001);
    if (prev) prev.a1 = piece.a1;
    else merged.push({ ...piece });
  }
  return merged;
}

export function buildLayout(map: MapData = MANSION as MapData): Layout {
  const warnings: string[] = [];
  const FH = map.floorHeight;
  const rooms: Room[] = map.rooms.map((r) => ({ ...r, y: r.floor * FH, h: r.h ?? FH }));
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const getRoom = (id: string, what: string) => {
    const r = roomById.get(id);
    if (!r) warnings.push(`${what}: unknown room "${id}"`);
    return r;
  };

  const cuts: Cut[] = [];
  const colliders: ColBox[] = [];
  const boxCol = (b: Box): ColBox => ({
    cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, cz: (b.z0 + b.z1) / 2,
    hx: (b.x1 - b.x0) / 2, hy: (b.y1 - b.y0) / 2, hz: (b.z1 - b.z0) / 2,
  });
  /** A thin floor strip across a doorway so you never trip on the gap between two walls. */
  const threshold = (axis: 'x' | 'z', line: number, a0: number, a1: number, y: number) => {
    const b: Box = axis === 'x'
      ? { x0: line - 0.3, x1: line + 0.3, y0: y - 0.1, y1: y, z0: a0, z1: a1 }
      : { x0: a0, x1: a1, y0: y - 0.1, y1: y, z0: line - 0.3, z1: line + 0.3 };
    colliders.push(boxCol(b));
  };

  // ---------- doors ----------
  const doors: Door[] = [];
  for (const d of map.doors) {
    const type = d.type ?? 'door';
    const width = d.width ?? (type === 'arch' ? 1.8 : DOOR_W);
    const height = d.height ?? (type === 'arch' ? 2.6 : DOOR_H);
    let axis: 'x' | 'z';
    let line: number;
    let r0: number;
    let r1: number;
    let y: number;
    let swing: 1 | -1;
    if (d.between) {
      const A = getRoom(d.between[0], `door ${d.id}`);
      const B = getRoom(d.between[1], `door ${d.id}`);
      if (!A || !B) continue;
      if (Math.abs(A.x + A.w - B.x) < EPS) { axis = 'x'; line = B.x; swing = 1; }
      else if (Math.abs(B.x + B.w - A.x) < EPS) { axis = 'x'; line = A.x; swing = -1; }
      else if (Math.abs(A.z + A.d - B.z) < EPS) { axis = 'z'; line = B.z; swing = 1; }
      else if (Math.abs(B.z + B.d - A.z) < EPS) { axis = 'z'; line = A.z; swing = -1; }
      else { warnings.push(`door ${d.id}: rooms ${A.id} and ${B.id} don't share a wall`); continue; }
      r0 = axis === 'x' ? Math.max(A.z, B.z) : Math.max(A.x, B.x);
      r1 = axis === 'x' ? Math.min(A.z + A.d, B.z + B.d) : Math.min(A.x + A.w, B.x + B.w);
      y = Math.max(A.y, B.y);
      if (y + height > Math.min(A.y + A.h, B.y + B.h) + EPS) warnings.push(`door ${d.id}: the rooms don't overlap in height`);
    } else {
      const R = getRoom(d.room ?? '', `door ${d.id}`);
      if (!R) continue;
      const s = sideInfo(R, d.wall ?? 'n');
      axis = s.axis; line = s.line; r0 = s.a0; r1 = s.a1; y = R.y; swing = s.inward;
    }
    if (r1 - r0 < width) { warnings.push(`door ${d.id}: shared wall is too short for the door`); continue; }
    const c = r0 + width / 2 + (r1 - r0 - width) * (d.at ?? 0.5);
    const a0 = c - width / 2;
    const a1 = c + width / 2;
    cuts.push({ axis, line, a0, a1, y0: y, y1: y + height });
    threshold(axis, line, a0, a1, y);
    const cx = axis === 'x' ? line : c;
    const cz = axis === 'x' ? c : line;
    doors.push({
      id: d.id, type, locked: !!d.locked, label: d.label ?? 'Locked.', axis, line, a0, a1, y, height, swing, cx, cz,
      collider: axis === 'x'
        ? { cx, cy: y + height / 2, cz, hx: 0.05, hy: height / 2, hz: width / 2 }
        : { cx, cy: y + height / 2, cz, hx: width / 2, hy: height / 2, hz: 0.05 },
    });
  }

  // ---------- stairs (a smooth ramp for walking + steps drawn on top) ----------
  const stairs: Stair[] = [];
  for (const s of map.stairs) {
    const R = getRoom(s.room, `stairs ${s.id}`);
    if (!R) continue;
    const alongX = s.dir === 'e' || s.dir === 'w';
    const x0 = R.x + s.x;
    const z0 = R.z + s.z;
    const x1 = x0 + (alongX ? s.length : s.width);
    const z1 = z0 + (alongX ? s.width : s.length);
    const y0 = R.y;
    const top = y0 + s.rise;
    // ramp corners: low edge at y0, high edge at the top
    let pts: number[][];
    if (s.dir === 'e') pts = [[x0, y0, z0], [x0, y0, z1], [x1, y0, z0], [x1, y0, z1], [x1, top, z0], [x1, top, z1]];
    else if (s.dir === 'w') pts = [[x1, y0, z0], [x1, y0, z1], [x0, y0, z0], [x0, y0, z1], [x0, top, z0], [x0, top, z1]];
    else if (s.dir === 's') pts = [[x0, y0, z0], [x1, y0, z0], [x0, y0, z1], [x1, y0, z1], [x0, top, z1], [x1, top, z1]];
    else pts = [[x0, y0, z1], [x1, y0, z1], [x0, y0, z0], [x1, y0, z0], [x0, top, z0], [x1, top, z0]];
    stairs.push({ id: s.id, room: s.room, x0, x1, z0, z1, y0, rise: s.rise, dir: s.dir, width: s.width, length: s.length, grand: !!s.grand, points: pts.flat() });
    // the opening at the top of the stairs into the room above
    const axis = alongX ? ('x' as const) : ('z' as const);
    const line = s.dir === 'e' ? x1 : s.dir === 'w' ? x0 : s.dir === 's' ? z1 : z0;
    const a0 = alongX ? z0 : x0;
    const a1 = alongX ? z1 : x1;
    cuts.push({ axis, line, a0, a1, y0: top, y1: top + 2.4 });
    threshold(axis, line, a0, a1, top);
  }

  // ---------- walls (minus the door holes) ----------
  const walls: WallPiece[] = [];
  for (const r of rooms) {
    for (const side of ['n', 's', 'w', 'e'] as Side[]) {
      const s = sideInfo(r, side);
      const mine = cuts.filter((c) => c.axis === s.axis && Math.abs(c.line - s.line) < 0.3);
      for (const p of subtract(s.a0, s.a1, r.y, r.y + r.h, mine)) {
        // the wall sits just inside the room's edge
        const t0 = s.inward === 1 ? s.line : s.line - WALL_T;
        const t1 = t0 + WALL_T;
        const piece: WallPiece = s.axis === 'z'
          ? { room: r.id, side, x0: p.a0, x1: p.a1, y0: p.y0, y1: p.y1, z0: t0, z1: t1 }
          : { room: r.id, side, x0: t0, x1: t1, y0: p.y0, y1: p.y1, z0: p.a0, z1: p.a1 };
        walls.push(piece);
        colliders.push(boxCol(piece));
      }
    }
  }

  // ---------- floors ----------
  const floors = rooms.map((r) => ({ room: r.id, x0: r.x, x1: r.x + r.w, y0: r.y - 0.2, y1: r.y, z0: r.z, z1: r.z + r.d }));
  for (const f of floors) colliders.push(boxCol(f));

  // ---------- props, lights, sounds ----------
  const props: PlacedProp[] = [];
  const lights: BakeLight[] = [];
  const sounds: SoundSpot[] = [];
  let auto = 0;
  const place = (p: MapProp, baseY?: number) => {
    const info = PROPS[p.type];
    const R = getRoom(p.room, `prop ${p.type}`);
    if (!info) { warnings.push(`unknown prop type "${p.type}"`); return; }
    if (!R) return;
    const size: [number, number, number] = [...info.size];
    if (p.size) { size[0] = p.size[0] ?? size[0]; size[1] = p.size[1] ?? size[1]; }
    if (p.type === 'rug') { size[0] = p.w ?? 2; size[2] = p.l ?? 3; }
    let x: number;
    let y: number;
    let z: number;
    let rot: number;
    if (info.wall) {
      const side = p.wall ?? 'n';
      const s = sideInfo(R, side);
      const a = s.a0 + (s.a1 - s.a0) * (p.at ?? 0.5);
      const off = WALL_T + size[2] / 2;
      if (side === 'n') { x = a; z = s.line + off; rot = 0; }
      else if (side === 's') { x = a; z = s.line - off; rot = Math.PI; }
      else if (side === 'w') { x = s.line + off; z = a; rot = Math.PI / 2; }
      else { x = s.line - off; z = a; rot = -Math.PI / 2; }
      y = R.y + (p.y ?? 1.6) - size[1] / 2; // "y" is the centre height
    } else {
      x = R.x + (p.x ?? R.w / 2);
      z = R.z + (p.z ?? R.d / 2);
      rot = deg(p.rot ?? 0);
      y = baseY ?? R.y + (p.y ?? 0);
      if (info.hanging) y = R.y + R.h - 0.35 - size[1];
    }
    const placed: PlacedProp = { type: p.type, info, room: R.id, x, y, z, rot, size, wall: p.wall, variant: p.variant ?? auto++ };
    props.push(placed);
    const fx = Math.sin(rot);
    const fz = Math.cos(rot);
    if (info.solid) colliders.push({ cx: x, cy: y + size[1] / 2, cz: z, hx: size[0] / 2, hy: size[1] / 2, hz: size[2] / 2, rot });
    if (info.light) {
      const L = info.light;
      const ly = info.wall ? y + size[1] / 2 + L.y : y + L.y;
      lights.push({
        room: R.id, x: x + fx * (L.out ?? 0), y: ly, z: z + fz * (L.out ?? 0),
        color: hexToRgb(L.color), intensity: L.intensity, range: L.range, moon: !!L.moon, dirX: fx, dirZ: fz,
      });
    }
    if (info.sound) sounds.push({ type: info.sound, room: R.id, x, y: y + size[1] / 2, z });
    if (p.with) place({ type: p.with, room: p.room, x: p.x, z: p.z, rot: p.rot }, y + (info.top ?? size[1]));
  };
  for (const p of map.props) place(p);

  // ---------- ghosts + spawn ----------
  const ghostSpots = map.ghostSpots.flatMap((g) => {
    const R = getRoom(g.room, 'ghost spot');
    return R ? [{ x: R.x + g.x, y: R.y, z: R.z + g.z, room: R.id }] : [];
  });
  const SR = getRoom(map.spawn.room, 'spawn') ?? rooms[0];
  const offsets = [[0, 0], [-1.2, 0], [1.2, 0], [0, 1], [-1.2, 1], [1.2, 1]];
  const spawns = offsets.map(([ox, oz]) => ({ x: SR.x + map.spawn.x + ox, y: SR.y, z: SR.z + map.spawn.z + oz * 0.8, yaw: deg(map.spawn.yaw) }));

  return {
    name: map.name, floorHeight: FH, ambient: map.ambient, ghostCount: map.ghostCount,
    rooms, roomById, walls, floors, stairs, doors, props, lights, sounds, ghostSpots, spawns, colliders, warnings,
  };
}

/** Which room is this point in? (used for sounds / debug) */
export function roomAt(layout: Layout, x: number, y: number, z: number): Room | undefined {
  return layout.rooms.find((r) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d && y >= r.y - 0.5 && y < r.y + r.h - 0.3);
}

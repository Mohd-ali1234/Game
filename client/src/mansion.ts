// =====================================================================
// client/src/mansion.ts
// Builds the 3D mansion from the layout (shared/layout.ts):
//   walls with wood panelling + wallpaper, floors, ceilings, stairs,
//   door frames, furniture, animated doors, moonbeams and lamp glows.
//
// Speed tricks (important for phones):
//   - Everything that never moves is MERGED into one mesh per material,
//     so the GPU draws the whole house in ~30 calls.
//   - Lamp/moon light is "baked": computed once per corner of the geometry
//     and stored with it. Only the flashlights are real-time lights.
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BakeLight, Door, Layout, PlacedProp, Room, roomAt, WALL_T } from '../../shared/layout';
import { Assets, Progress } from './assets';
import { fitModel, modelKeyFor } from './models';
import { glowTexture, shaftTexture, windowPatchTexture } from './procedural';
import { buildProp, Kit, Part } from './props3d';

interface StaticPart extends Part {
  room: string | string[]; // whose lights shine on it
  noShadow?: boolean;
}

export interface DoorView {
  door: Door;
  pivot: THREE.Group;
  open: boolean;
  angle: number;
  target: number;
}

export interface Mansion {
  group: THREE.Group;
  doors: Map<string, DoorView>;
  setDoor(id: string, open: boolean): void;
  update(dt: number): void;
  dispose(): void;
}

const SEG = 0.6; // geometry detail for baked light (one vertex every 60 cm)

// ---------- baked lighting ----------
function bakeInto(geo: THREE.BufferGeometry, lights: BakeLight[], ambient: THREE.Color) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const nx = nor.getX(i);
    const ny = nor.getY(i);
    const nz = nor.getZ(i);
    let r = ambient.r;
    let g = ambient.g;
    let b = ambient.b;
    for (const L of lights) {
      const dx = L.x - px;
      const dy = L.y - py;
      const dz = L.z - pz;
      const d = Math.hypot(dx, dy, dz);
      if (d > L.range || d < 1e-4) continue;
      let k = Math.max(0, ((nx * dx + ny * dy + nz * dz) / d) * 0.8 + 0.2);
      if (L.moon) {
        const front = -(dx * L.dirX + dz * L.dirZ) / d; // only in front of the window
        if (front <= 0) continue;
        k *= Math.sqrt(front);
      }
      const fall = 1 - d / L.range;
      const att = (fall * fall) / (1 + 0.45 * d * d);
      const s = L.intensity * k * att;
      r += L.color[0] * s;
      g += L.color[1] * s;
      b += L.color[2] * s;
    }
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
  geo.setAttribute('baked', new THREE.BufferAttribute(out, 3));
}

/** Texture coordinates in meters, picked by which way each face points (so textures never stretch). */
function worldUV(geo: THREE.BufferGeometry) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) {
      u = pos.getX(i);
      v = pos.getZ(i);
    } else if (ax >= az) {
      u = pos.getZ(i);
      v = pos.getY(i);
    } else {
      u = pos.getX(i);
      v = pos.getY(i);
    }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Make every geometry look the same to the merger: position, normal, uv, color, baked. */
function prepare(part: StaticPart, lights: BakeLight[], ambient: THREE.Color): THREE.BufferGeometry {
  const g = part.geo; // (all our shapes are indexed, which the merger needs)
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!part.keepUV || !g.attributes.uv) worldUV(g);
  const n = g.attributes.position.count;
  const c = part.color ?? new THREE.Color(1, 1, 1);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  bakeInto(g, lights, ambient);
  g.morphAttributes = {};
  return g;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
  const g = new THREE.BoxGeometry(w, h, d, Math.max(1, Math.ceil(w / SEG)), Math.max(1, Math.ceil(h / SEG)), Math.max(1, Math.ceil(d / SEG)));
  g.translate(x, y, z);
  return g;
};

export async function buildMansion(layout: Layout, mats: Record<string, THREE.Material>, assets: Assets, progress: Progress): Promise<Mansion> {
  const group = new THREE.Group();
  const parts: StaticPart[] = [];
  const ambient = new THREE.Color(layout.ambient);
  const lightsIn = new Map<string, BakeLight[]>();
  for (const L of layout.lights) {
    if (!lightsIn.has(L.room)) lightsIn.set(L.room, []);
    lightsIn.get(L.room)!.push(L);
  }
  const roomLights = (r: string | string[]) => (Array.isArray(r) ? r : [r]).flatMap((id) => lightsIn.get(id) ?? []);
  const add = (geo: THREE.BufferGeometry, mat: string, room: string | string[], o: Partial<StaticPart> = {}) => parts.push({ geo, mat, room, ...o });

  // ---------- walls: wood panelling below, wallpaper above ----------
  for (const w of layout.walls) {
    const R = layout.roomById.get(w.room)!;
    const top = Math.min(w.y1, R.y + R.h - 0.2); // stop under the ceiling / floor above
    if (top <= w.y0) continue;
    const wainTop = R.y + 1.0;
    const inwardX = w.side === 'w' ? 1 : w.side === 'e' ? -1 : 0;
    const inwardZ = w.side === 'n' ? 1 : w.side === 's' ? -1 : 0;
    const sx = w.x1 - w.x0;
    const sz = w.z1 - w.z0;
    const cx = (w.x0 + w.x1) / 2;
    const cz = (w.z0 + w.z1) / 2;
    const slab = (y0: number, y1: number, mat: string, extra = 0) => {
      if (y1 - y0 < 0.01) return;
      add(box(sx + Math.abs(inwardX) * extra, y1 - y0, sz + Math.abs(inwardZ) * extra, cx + (inwardX * extra) / 2, (y0 + y1) / 2, cz + (inwardZ * extra) / 2), mat, R.id);
    };
    if (R.wainscot) {
      slab(w.y0, Math.min(top, wainTop), R.wainscot, 0.025);
      slab(Math.max(w.y0, wainTop), top, R.wall);
      if (w.y0 < wainTop && top > wainTop) {
        // chair rail along the top of the panelling
        add(box(sx + Math.abs(inwardX) * 0.05, 0.06, sz + Math.abs(inwardZ) * 0.05, cx + inwardX * 0.025, wainTop, cz + inwardZ * 0.025), 'wood_dark', R.id);
      }
    } else {
      slab(w.y0, top, R.wall);
      if (w.y0 < R.y + 0.05) add(box(sx + Math.abs(inwardX) * 0.03, 0.15, sz + Math.abs(inwardZ) * 0.03, cx + inwardX * 0.015, R.y + 0.075, cz + inwardZ * 0.015), 'wood_dark', R.id);
    }
  }

  // ---------- floors and ceilings ----------
  for (const R of layout.rooms) {
    const f = new THREE.PlaneGeometry(R.w, R.d, Math.ceil(R.w / SEG), Math.ceil(R.d / SEG));
    f.rotateX(-Math.PI / 2);
    f.translate(R.x + R.w / 2, R.y + 0.001, R.z + R.d / 2);
    add(f, R.floorMat, R.id, { noShadow: true });
    const c = new THREE.PlaneGeometry(R.w, R.d, Math.ceil(R.w / SEG), Math.ceil(R.d / SEG));
    c.rotateX(Math.PI / 2);
    c.translate(R.x + R.w / 2, R.y + R.h - 0.21, R.z + R.d / 2);
    add(c, R.ceiling, R.id, { noShadow: true });
    if (R.beams) {
      for (let x = R.x + 1.2; x < R.x + R.w - 0.5; x += 1.8) add(box(0.2, 0.25, R.d, x, R.y + R.h - 0.21 - 0.125, R.z + R.d / 2), 'wood_dark', R.id, { color: new THREE.Color('#6a5a4a') });
    }
  }

  // ---------- stairs: solid steps, carpet runner, banisters ----------
  for (const s of layout.stairs) {
    const steps = Math.round(s.rise / 0.18);
    const run = s.length / steps;
    const rh = s.rise / steps;
    const alongX = s.dir === 'e' || s.dir === 'w';
    const sign = s.dir === 'e' || s.dir === 's' ? 1 : -1;
    const start = alongX ? (sign > 0 ? s.x0 : s.x1) : sign > 0 ? s.z0 : s.z1;
    const across0 = alongX ? s.z0 : s.x0;
    const across1 = alongX ? s.z1 : s.x1;
    const mid = (across0 + across1) / 2;
    const W = s.width;
    const tread = s.grand ? 'wood_dark' : 'attic_planks';
    for (let i = 0; i < steps; i++) {
      const a = start + sign * (i + 0.5) * run;
      const h = (i + 1) * rh;
      const g = alongX ? box(run, h, W, a, s.y0 + h / 2, mid) : box(W, h, run, mid, s.y0 + h / 2, a);
      add(g, tread, s.room);
      if (s.grand) {
        // carpet runner on each step
        const rw = W * 0.65;
        const cg = alongX ? new THREE.BoxGeometry(run + 0.01, 0.015, rw) : new THREE.BoxGeometry(rw, 0.015, run + 0.01);
        cg.translate(alongX ? a : mid, s.y0 + h + 0.007, alongX ? mid : a);
        const uv = cg.attributes.uv as THREE.BufferAttribute;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k), uv.getY(k) * 0.3 + i * 0.3);
        add(cg, 'carpet', s.room, { keepUV: true });
      }
    }
    // banisters on both sides: posts + a sloping hand rail
    const post = s.grand ? 0.045 : 0.035;
    for (const side of [across0 + 0.08, across1 - 0.08]) {
      const every = s.grand ? 2 : 3;
      for (let i = 0; i < steps; i += every) {
        const a = start + sign * (i + 0.5) * run;
        const base = s.y0 + (i + 1) * rh;
        const k = new Kit();
        k.cyl('wood_dark', post * 0.6, post * 0.6, 0.9, 0, 0, 0, 6);
        for (const p of k.parts) {
          p.geo.translate(alongX ? a : side, base, alongX ? side : a);
          add(p.geo, 'wood_dark', s.room);
        }
      }
      // newel post at the bottom
      add(box(0.12, 1.15, 0.12, alongX ? start + sign * 0.1 : side, s.y0 + 0.575, alongX ? side : start + sign * 0.1), 'wood_dark', s.room);
      const len = Math.hypot(s.length, s.rise);
      const rail = new THREE.BoxGeometry(alongX ? len : 0.08, 0.07, alongX ? 0.08 : len);
      const tilt = Math.atan2(s.rise, s.length);
      if (alongX) rail.rotateZ(sign * tilt);
      else rail.rotateX(-sign * tilt);
      const ca = start + (sign * s.length) / 2;
      rail.translate(alongX ? ca : side, s.y0 + s.rise / 2 + 0.95, alongX ? side : ca);
      add(rail, 'wood_dark', s.room);
    }
  }

  // ---------- door frames (architraves) ----------
  const doorRooms = (d: Door) => {
    const off = 0.4;
    const a = roomAt(layout, d.axis === 'x' ? d.cx - off : d.cx, d.y + 1, d.axis === 'x' ? d.cz : d.cz - off);
    const b = roomAt(layout, d.axis === 'x' ? d.cx + off : d.cx, d.y + 1, d.axis === 'x' ? d.cz : d.cz + off);
    return [a?.id, b?.id].filter(Boolean) as string[];
  };
  for (const d of layout.doors) {
    const depth = 2 * WALL_T + 0.1;
    const width = d.a1 - d.a0;
    const rooms = doorRooms(d);
    const frame = (along: number, y: number, w: number, h: number) => {
      const g = d.axis === 'x' ? box(depth, h, w, d.line, y + h / 2, along) : box(w, h, depth, along, y + h / 2, d.line);
      add(g, 'wood_dark', rooms);
    };
    frame(d.a0 - 0.06, d.y, 0.12, d.height + 0.1);
    frame(d.a1 + 0.06, d.y, 0.12, d.height + 0.1);
    frame((d.a0 + d.a1) / 2, d.y + d.height, width + 0.24, 0.12);
  }

  // ---------- furniture (placeholder shapes, or uploaded .glb models) ----------
  const modelProps: { p: PlacedProp; key: string }[] = [];
  for (const p of layout.props) {
    const key = modelKeyFor(assets, p.type);
    if (key) {
      modelProps.push({ p, key });
      progress.add(assets.size('models', key));
      continue;
    }
    const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot), new THREE.Vector3(1, 1, 1));
    for (const part of buildProp(p)) {
      part.geo.applyMatrix4(m);
      add(part.geo, part.mat, p.room, { color: part.color, keepUV: part.keepUV, noShadow: p.type === 'rug' });
    }
  }
  await new Promise((r) => setTimeout(r, 0));

  // ---------- bake + merge into one mesh per material ----------
  const byMat = new Map<string, { cast: THREE.BufferGeometry[]; flat: THREE.BufferGeometry[] }>();
  for (const part of parts) {
    const g = prepare(part, roomLights(part.room), ambient);
    if (!byMat.has(part.mat)) byMat.set(part.mat, { cast: [], flat: [] });
    byMat.get(part.mat)![part.noShadow ? 'flat' : 'cast'].push(g);
  }
  for (const [mat, lists] of byMat) {
    for (const [kind, list] of Object.entries(lists)) {
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!merged) {
        console.warn(`could not merge ${mat}`);
        continue;
      }
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mats[mat] ?? mats.wood_dark);
      mesh.castShadow = kind === 'cast';
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = `static:${mat}`;
      group.add(mesh);
    }
  }

  // ---------- uploaded .glb furniture ----------
  for (const { p, key } of modelProps) {
    const src = await assets.model(key);
    progress.finish(assets.size('models', key), `model ${key}`);
    let obj: THREE.Object3D;
    if (src) obj = fitModel(src, p.size, key);
    else {
      // model failed to load: fall back to the shape version
      const g = new THREE.Group();
      for (const part of buildProp(p)) g.add(new THREE.Mesh(prepare({ ...part, room: p.room }, roomLights(p.room), ambient), mats[part.mat]));
      obj = g;
    }
    obj.position.set(p.x, p.y, p.z);
    obj.rotation.y = p.rot;
    group.add(obj);
  }

  // ---------- doors (these move, so they stay separate) ----------
  const doors = new Map<string, DoorView>();
  for (const d of layout.doors) {
    if (d.type !== 'door') continue;
    const w = d.a1 - d.a0 - 0.03;
    const h = d.height - 0.02;
    const k = new Kit();
    const along = (u: number) => (d.axis === 'x' ? [0, 0, u] : [u, 0, 0]);
    // panel + raised mouldings on both faces, built along +along from the hinge
    const thick = (g: THREE.BufferGeometry, x: number, y: number, ww: number, hh: number, depth: number) => {
      if (d.axis === 'x') g.copy(new THREE.BoxGeometry(depth, hh, ww));
      else g.copy(new THREE.BoxGeometry(ww, hh, depth));
      const [ax, , az] = along(x);
      g.translate(ax, y, az);
      return g;
    };
    k.parts.push({ geo: thick(new THREE.BufferGeometry(), w / 2, h / 2, w, h, 0.05), mat: 'wood_dark' });
    for (const [py, ph] of [[h * 0.28, h * 0.4], [h * 0.73, h * 0.38]]) {
      k.parts.push({ geo: thick(new THREE.BufferGeometry(), w / 2, py, w * 0.7, ph, 0.075), mat: 'wood_dark', color: new THREE.Color('#9a8070') });
    }
    for (const side of [-1, 1]) {
      const g = new THREE.SphereGeometry(0.035, 8, 6);
      const [ax, , az] = along(w - 0.1);
      g.translate(ax + (d.axis === 'x' ? side * 0.06 : 0), 1.0, az + (d.axis === 'z' ? side * 0.06 : 0));
      k.parts.push({ geo: g, mat: 'brass' });
    }
    const pivot = new THREE.Group();
    pivot.position.set(d.axis === 'x' ? d.line : d.a0 + 0.015, d.y + 0.01, d.axis === 'x' ? d.a0 + 0.015 : d.line);
    const lights = roomLights(doorRooms(d));
    const byM = new Map<string, THREE.BufferGeometry[]>();
    for (const part of k.parts) {
      const g = part.geo;
      g.translate(pivot.position.x, pivot.position.y, pivot.position.z); // bake + UV in world space...
      const ready = prepare({ ...part, room: [] }, lights, ambient);
      ready.translate(-pivot.position.x, -pivot.position.y, -pivot.position.z); // ...then back to hinge space
      if (!byM.has(part.mat)) byM.set(part.mat, []);
      byM.get(part.mat)!.push(ready);
    }
    for (const [m, list] of byM) {
      const mesh = new THREE.Mesh(mergeGeometries(list, false)!, mats[m]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      pivot.add(mesh);
    }
    group.add(pivot);
    doors.set(d.id, { door: d, pivot, open: false, angle: 0, target: 0 });
  }

  // ---------- glows: moonbeams through windows, lamp halos, candle flames ----------
  const fx: THREE.Object3D[] = [];
  const quads: { shafts: number[]; patches: number[]; halos: number[] } = { shafts: [], patches: [], halos: [] };
  const quad = (list: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, dd: THREE.Vector3) => list.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, dd.x, dd.y, dd.z);
  for (const p of layout.props) {
    const fwd = new THREE.Vector3(Math.sin(p.rot), 0, Math.cos(p.rot));
    const right = new THREE.Vector3(Math.cos(p.rot), 0, -Math.sin(p.rot));
    if (p.type === 'window') {
      const R = layout.roomById.get(p.room) as Room;
      const [w, h] = p.size;
      const base = new THREE.Vector3(p.x, p.y, p.z);
      const floorY = R.y + 0.02;
      const reach = Math.min(4.5, (p.y + h - floorY) * 0.9);
      const wl = base.clone().addScaledVector(right, -w / 2);
      const wr = base.clone().addScaledVector(right, w / 2);
      const tl = wl.clone().setY(p.y + h);
      const tr = wr.clone().setY(p.y + h);
      const bl = wl.clone().setY(p.y);
      const br = wr.clone().setY(p.y);
      const fn = (v: THREE.Vector3, dist: number) => v.clone().setY(floorY).addScaledVector(fwd, dist);
      const near = (p.y - floorY) * 0.9;
      // a box-like beam: top, bottom and two sides
      quad(quads.shafts, tl, tr, fn(tr, reach), fn(tl, reach));
      quad(quads.shafts, bl, br, fn(br, near), fn(bl, near));
      quad(quads.shafts, tl, bl, fn(bl, near), fn(tl, reach));
      quad(quads.shafts, tr, br, fn(br, near), fn(tr, reach));
      quad(quads.patches, fn(bl, near).setY(floorY), fn(br, near).setY(floorY), fn(br, reach).setY(floorY), fn(bl, reach).setY(floorY));
    }
    if (p.type === 'wall_lamp') {
      const c = new THREE.Vector3(p.x, p.y + 0.25, p.z).addScaledVector(fwd, -p.size[2] / 2 + 0.01);
      const s = 0.7;
      quad(quads.halos, c.clone().addScaledVector(right, -s).setY(c.y - s), c.clone().addScaledVector(right, s).setY(c.y - s), c.clone().addScaledVector(right, s).setY(c.y + s), c.clone().addScaledVector(right, -s).setY(c.y + s));
    }
  }
  const quadMesh = (list: number[], mat: THREE.Material, flipV: boolean) => {
    if (!list.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
    const n = list.length / 12;
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      if (flipV) uv.push(0, 1, 1, 1, 1, 0, 0, 0); // beams: bright at the window end
      else uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    }
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = 2;
    m.matrixAutoUpdate = false;
    fx.push(m);
    group.add(m);
  };
  const additive = (map: THREE.Texture, color: string, opacity: number) =>
    new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const shaft = shaftTexture();
  quadMesh(quads.shafts, additive(shaft, '#8fa6d8', 0.07), true);
  quadMesh(quads.patches, additive(windowPatchTexture(), '#8fa6d8', 0.32), false);
  const glow = glowTexture();
  quadMesh(quads.halos, additive(glow, '#ffaa55', 0.55), false);
  // candle flames + lamp bulbs: glowing points
  const pts: number[] = [];
  for (const p of layout.props) if (p.type === 'candelabra' || p.type === 'desk_lamp') for (const L of layout.lights) if (!L.moon && Math.hypot(L.x - p.x, L.z - p.z) < 0.05 && Math.abs(L.y - p.y) < 1) pts.push(L.x, L.y, L.z);
  if (pts.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const points = new THREE.Points(g, new THREE.PointsMaterial({ map: glow, color: '#ffb060', size: 0.5, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    fx.push(points);
    group.add(points);
  }

  const setDoor = (id: string, open: boolean) => {
    const v = doors.get(id);
    if (!v) return;
    v.open = open;
    const deg95 = (95 * Math.PI) / 180;
    v.target = open ? (v.door.axis === 'x' ? v.door.swing * deg95 : -v.door.swing * deg95) : 0;
  };

  return {
    group,
    doors,
    setDoor,
    update(dt: number) {
      for (const v of doors.values()) {
        if (v.angle === v.target) continue;
        const step = dt * 1.4; // slow, creaky swing
        v.angle = Math.abs(v.target - v.angle) < step ? v.target : v.angle + Math.sign(v.target - v.angle) * step;
        v.pivot.rotation.y = v.angle;
      }
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
      });
    },
  };
}

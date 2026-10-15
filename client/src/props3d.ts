// =====================================================================
// client/src/props3d.ts
// Placeholder furniture built from simple shapes. Each one is used until a
// .glb model for it is uploaded (see models.ts). Everything is built at the
// prop's real size (shared/props.ts), with the front facing +Z and the
// origin at the centre of its base.
// =====================================================================
import * as THREE from 'three';
import type { PlacedProp } from '../../shared/layout';

export interface Part {
  geo: THREE.BufferGeometry;
  mat: string; // key in MATERIALS
  color?: THREE.Color; // tint (books, toys...)
  keepUV?: boolean; // use the shape's own UVs (rugs, paintings) instead of world-space texture mapping
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

/** A little toolkit for building furniture out of boxes and cylinders. */
export class Kit {
  parts: Part[] = [];

  add(geo: THREE.BufferGeometry, mat: string, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, color?: THREE.Color | string, keepUV = false) {
    tmpQ.setFromEuler(tmpE.set(rx, ry, rz));
    tmpM.compose(new THREE.Vector3(x, y, z), tmpQ, new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(tmpM);
    this.parts.push({ geo, mat, color: color === undefined ? undefined : new THREE.Color(color), keepUV });
  }
  /** Box whose BOTTOM is at y. */
  box(mat: string, w: number, h: number, d: number, x: number, y: number, z: number, o: { rx?: number; ry?: number; rz?: number; color?: THREE.Color | string } = {}) {
    this.add(new THREE.BoxGeometry(w, h, d), mat, x, y + h / 2, z, o.rx, o.ry, o.rz, o.color);
  }
  /** Upright cylinder whose bottom is at y. */
  cyl(mat: string, rTop: number, rBot: number, h: number, x: number, y: number, z: number, seg = 10, o: { rx?: number; rz?: number; color?: THREE.Color | string } = {}) {
    this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat, x, y + h / 2, z, o.rx, 0, o.rz, o.color);
  }
  sphere(mat: string, r: number, x: number, y: number, z: number, sy = 1, color?: THREE.Color | string) {
    const g = new THREE.SphereGeometry(r, 10, 8);
    g.scale(1, sy, 1);
    this.add(g, mat, x, y, z, 0, 0, 0, color);
  }
  /** A turned shape (vases, lamp shades): points are [radius, height]. */
  lathe(mat: string, pts: [number, number][], x: number, y: number, z: number, seg = 12, color?: THREE.Color | string) {
    this.add(new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), seg), mat, x, y, z, 0, 0, 0, color);
  }
  /** Four legs at the corners of a w x d rectangle. */
  legs(mat: string, w: number, d: number, h: number, t: number, inset = 0.03) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box(mat, t, h, t, sx * (w / 2 - t / 2 - inset), 0, sz * (d / 2 - t / 2 - inset));
  }
}

/** Seeded random, so the same prop always looks the same for everyone. */
function rand(seed: number) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/** Bumpy draped cloth (for dust sheets and curtains). */
function draped(w: number, h: number, d: number, seed: number, flare = 0.12): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d, 8, 5, 8);
  const R = rand(seed);
  const bumps = Array.from({ length: 6 }, () => [R() * 2 - 1, R() * 2 - 1, R() * 0.08]);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    let y = p.getY(i);
    const z = p.getZ(i);
    const low = 1 - (y + h / 2) / h; // 1 at the floor
    let k = 1 + low * low * flare * 3;
    for (const [bx, bz, a] of bumps) k += a * Math.cos(x * 6 + bx * 3) * Math.cos(z * 6 + bz * 3);
    if (y > h / 2 - 0.01) y += Math.sin(x * 4) * 0.04 + Math.cos(z * 5) * 0.03; // lumpy top
    p.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Wooden rocker (a curved runner) as an arc. */
function rocker(len: number): THREE.BufferGeometry {
  const r = len * 1.1;
  const arc = (len / r) * 1.05;
  const g = new THREE.TorusGeometry(r, 0.02, 4, 12, arc);
  g.rotateZ(-Math.PI / 2 - arc / 2);
  g.translate(0, r, 0);
  g.rotateY(Math.PI / 2);
  return g;
}

const BOOK_COLORS = ['#4a1010', '#13321e', '#1a2240', '#3a2410', '#111111', '#5a4220', '#2c1630', '#6a5a40'];
const TOY_COLORS = ['#8a2a20', '#1f4a7a', '#c09030', '#2f6a3a'];

type Builder = (k: Kit, p: PlacedProp) => void;

export const BUILDERS: Record<string, Builder> = {
  side_table(k) {
    k.cyl('wood_dark', 0.3, 0.3, 0.04, 0, 0.71, 0, 16);
    k.cyl('wood_dark', 0.035, 0.05, 0.62, 0, 0.09, 0, 8);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      k.box('wood_dark', 0.05, 0.06, 0.26, Math.sin(a) * 0.11, 0.03, Math.cos(a) * 0.11, { ry: a });
    }
  },
  vase_flowers(k, p) {
    const R = rand(p.variant + 3);
    const tint = ['#3a4a3a', '#2a3248', '#5a3a2a', '#6a6458'][p.variant % 4];
    k.lathe('ceramic', [[0, 0], [0.06, 0], [0.09, 0.06], [0.1, 0.14], [0.07, 0.22], [0.045, 0.27], [0.055, 0.3]], 0, 0, 0, 12, tint);
    // dead flowers: stems leaning out, heads drooping down
    for (let i = 0; i < 7; i++) {
      const a = R() * Math.PI * 2;
      const lean = 0.15 + R() * 0.35;
      const len = 0.22 + R() * 0.15;
      const sx = Math.sin(a) * Math.sin(lean) * len;
      const sz = Math.cos(a) * Math.sin(lean) * len;
      const top = 0.28 + Math.cos(lean) * len;
      k.add(new THREE.CylinderGeometry(0.004, 0.006, len, 4), 'flowers_dead', sx / 2, 0.28 + (top - 0.28) / 2, sz / 2, Math.cos(a) * lean, 0, -Math.sin(a) * lean);
      k.sphere('flowers_dead', 0.025 + R() * 0.015, sx * 1.1, top - 0.03 - R() * 0.05, sz * 1.1, 0.6, R() > 0.5 ? '#4a3020' : '#2a2018');
    }
  },
  reading_table(k, p) {
    const [w, , d] = p.size;
    k.box('wood_dark', w, 0.05, d, 0, 0.73, 0);
    k.box('wood_dark', w - 0.1, 0.1, d - 0.1, 0, 0.63, 0);
    k.legs('wood_dark', w, d, 0.63, 0.07);
  },
  dining_table(k, p) {
    const [w, , d] = p.size;
    k.box('wood_dark', w, 0.06, d, 0, 0.72, 0);
    k.box('wood_dark', w - 0.2, 0.12, d - 0.2, 0, 0.6, 0);
    for (const x of [-w / 2 + 0.2, 0, w / 2 - 0.2]) for (const z of [-d / 2 + 0.15, d / 2 - 0.15]) k.lathe('wood_dark', [[0.06, 0], [0.05, 0.1], [0.035, 0.3], [0.05, 0.45], [0.04, 0.6]], x, 0, z, 8);
    // a dusty table runner
    k.box('linen', w * 0.8, 0.005, 0.4, 0, 0.78, 0, { color: '#c8bca0' });
  },
  kitchen_table(k, p) {
    const [w, , d] = p.size;
    k.box('wood_dark', w, 0.06, d, 0, 0.74, 0, { color: '#c8a888' });
    k.legs('wood_dark', w, d, 0.74, 0.07);
  },
  sideboard(k, p) {
    const [w, h, d] = p.size;
    k.box('wood_dark', w, h - 0.2, d, 0, 0.15, 0);
    k.box('wood_dark', w + 0.06, 0.05, d + 0.04, 0, h - 0.05, 0);
    k.legs('wood_dark', w, d, 0.15, 0.06);
    for (const x of [-w / 3, 0, w / 3]) {
      k.box('wood_dark', w / 3 - 0.06, h - 0.32, 0.02, x, 0.21, d / 2, { color: '#b09080' });
      k.sphere('brass', 0.018, x, h * 0.6, d / 2 + 0.02);
    }
  },
  candelabra(k) {
    k.lathe('brass', [[0, 0], [0.09, 0], [0.07, 0.03], [0.02, 0.06], [0.015, 0.3], [0.03, 0.32], [0, 0.33]], 0, 0, 0, 10);
    k.box('brass', 0.3, 0.015, 0.015, 0, 0.3, 0);
    for (const x of [-0.14, 0, 0.14]) {
      k.cyl('brass', 0.025, 0.015, 0.03, x, 0.31 + (x === 0 ? 0.06 : 0), 0, 8);
      const cy = 0.34 + (x === 0 ? 0.06 : 0);
      k.cyl('wax', 0.012, 0.012, 0.1, x, cy, 0, 6);
      k.lathe('flame', [[0, 0], [0.008, 0.01], [0.006, 0.025], [0, 0.04]], x, cy + 0.1, 0, 6);
    }
  },
  desk_lamp(k) {
    k.lathe('brass', [[0, 0], [0.08, 0], [0.06, 0.03], [0.015, 0.05], [0.012, 0.3], [0, 0.31]], 0, 0, 0, 10);
    k.lathe('lamp_glass', [[0.07, 0.27], [0.13, 0.27], [0.1, 0.44], [0.05, 0.47]], 0, 0, 0, 14);
  },
  chair(k, p) {
    const fab = p.variant % 2 ? 'fabric_red' : 'fabric_green';
    k.legs('wood_dark', 0.45, 0.45, 0.45, 0.04);
    k.box('wood_dark', 0.46, 0.04, 0.46, 0, 0.45, 0);
    k.box(fab, 0.4, 0.05, 0.4, 0, 0.49, 0.01);
    for (const sx of [-1, 1]) k.box('wood_dark', 0.04, 0.6, 0.04, sx * 0.2, 0.45, -0.21);
    k.box('wood_dark', 0.44, 0.07, 0.04, 0, 0.98, -0.21);
    k.box(fab, 0.3, 0.35, 0.03, 0, 0.58, -0.21);
  },
  armchair(k, p) {
    const fab = p.variant % 2 ? 'fabric_green' : 'fabric_red';
    k.legs('wood_dark', 0.8, 0.8, 0.14, 0.05);
    k.box(fab, 0.78, 0.26, 0.78, 0, 0.14, 0);
    k.box(fab, 0.62, 0.1, 0.6, 0, 0.4, 0.05);
    k.box(fab, 0.8, 0.7, 0.18, 0, 0.35, -0.31);
    k.add(new THREE.CylinderGeometry(0.1, 0.1, 0.8, 10), fab, 0, 1.03, -0.31, 0, 0, Math.PI / 2);
    for (const sx of [-1, 1]) {
      k.box(fab, 0.13, 0.28, 0.66, sx * 0.34, 0.4, 0.04);
      k.add(new THREE.CylinderGeometry(0.07, 0.07, 0.66, 8), fab, sx * 0.34, 0.69, 0.04, Math.PI / 2, 0, 0);
    }
  },
  rocking_chair(k) {
    for (const sx of [-1, 1]) {
      k.add(rocker(0.95), 'wood_dark', sx * 0.26, 0, 0);
      k.box('wood_dark', 0.035, 0.42, 0.035, sx * 0.26, 0.04, 0.22);
      k.box('wood_dark', 0.035, 1.05, 0.035, sx * 0.26, 0.04, -0.22, { rx: -0.15 });
      k.box('wood_dark', 0.04, 0.04, 0.5, sx * 0.29, 0.66, 0.02);
    }
    k.box('wood_dark', 0.56, 0.04, 0.5, 0, 0.44, 0);
    for (let i = 0; i < 5; i++) k.box('wood_dark', 0.025, 0.55, 0.02, -0.2 + i * 0.1, 0.5, -0.27, { rx: -0.15 });
    k.box('wood_dark', 0.58, 0.06, 0.05, 0, 1.03, -0.36, { rx: -0.15 });
  },
  grandfather_clock(k) {
    k.box('wood_dark', 0.6, 0.5, 0.45, 0, 0, 0);
    k.box('wood_dark', 0.48, 1.12, 0.38, 0, 0.5, 0);
    k.box('wood_dark', 0.56, 0.52, 0.42, 0, 1.62, 0);
    k.box('wood_dark', 0.62, 0.06, 0.46, 0, 2.14, 0);
    k.add(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 24), 'ceramic', 0, 1.88, 0.21, Math.PI / 2, 0, 0);
    k.add(new THREE.TorusGeometry(0.17, 0.015, 6, 24), 'brass', 0, 1.88, 0.22);
    k.box('iron', 0.012, 0.12, 0.006, 0, 1.88, 0.225, { rz: 0.6 });
    k.box('iron', 0.012, 0.09, 0.006, 0, 1.88, 0.225, { rz: -1.9 });
    k.box('black', 0.22, 0.8, 0.01, 0, 0.65, 0.19); // glass window
    k.cyl('brass', 0.006, 0.006, 0.55, 0, 0.9, 0.18, 4);
    k.add(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 16), 'brass', 0, 0.86, 0.18, Math.PI / 2, 0, 0);
  },
  bookshelf(k, p) {
    const [w, h, d] = p.size;
    const R = rand(p.variant + 11);
    k.box('wood_dark', 0.04, h, d, -w / 2 + 0.02, 0, 0);
    k.box('wood_dark', 0.04, h, d, w / 2 - 0.02, 0, 0);
    k.box('wood_dark', w, 0.02, d, 0, 0, -d / 2 + 0.01, { rx: Math.PI / 2 }); // back
    k.box('wood_dark', w + 0.06, 0.08, d + 0.04, 0, h - 0.08, 0);
    const shelves = 6;
    for (let s = 0; s < shelves; s++) {
      const y = 0.08 + s * ((h - 0.2) / shelves);
      k.box('wood_dark', w - 0.06, 0.03, d - 0.02, 0, y, 0);
      if (s === 0) continue;
      let x = -w / 2 + 0.06;
      while (x < w / 2 - 0.1) {
        const bw = 0.025 + R() * 0.04;
        if (R() < 0.1) {
          x += 0.1; // a gap
          continue;
        }
        const bh = 0.2 + R() * 0.12;
        const lean = R() < 0.08 ? 0.25 : 0;
        k.box('book', bw, bh, d * 0.7, x + bw / 2, y + 0.03, 0.02, { rz: lean, color: BOOK_COLORS[Math.floor(R() * BOOK_COLORS.length)] });
        x += bw + 0.003 + lean * 0.12;
      }
    }
  },
  wardrobe(k, p) {
    const [w, h, d] = p.size;
    k.box('wood_dark', w, h - 0.1, d, 0, 0.1, 0);
    k.box('wood_dark', w + 0.1, 0.1, d + 0.06, 0, h - 0.1, 0);
    k.legs('wood_dark', w, d, 0.1, 0.08);
    for (const sx of [-1, 1]) {
      k.box('wood_dark', w / 2 - 0.08, h - 0.4, 0.02, sx * (w / 4), 0.25, d / 2, { color: '#a08070' });
      k.sphere('brass', 0.022, sx * 0.06, h * 0.5, d / 2 + 0.025);
    }
  },
  dresser(k, p) {
    const [w, , d] = p.size;
    k.box('wood_dark', w, 0.85, d, 0, 0.05, 0);
    for (let i = 0; i < 3; i++) {
      k.box('wood_dark', w - 0.1, 0.22, 0.02, 0, 0.1 + i * 0.26, d / 2, { color: '#a08070' });
      for (const sx of [-1, 1]) k.sphere('brass', 0.016, sx * w * 0.25, 0.21 + i * 0.26, d / 2 + 0.02);
    }
    k.box('wood_dark', 0.9, 0.95, 0.05, 0, 0.9, -d / 2 + 0.06);
    k.box('mirror', 0.76, 0.8, 0.01, 0, 0.97, -d / 2 + 0.09);
  },
  bed(k, p) {
    const [w, h, d] = p.size;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl('wood_dark', 0.045, 0.06, h, sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06), 8);
    for (const sz of [-1, 1]) k.box('wood_dark', w, 0.08, 0.06, 0, h - 0.1, sz * (d / 2 - 0.06));
    for (const sx of [-1, 1]) k.box('wood_dark', 0.06, 0.08, d, sx * (w / 2 - 0.06), h - 0.1, 0);
    k.box('wood_dark', w - 0.1, 0.9, 0.06, 0, 0.3, -d / 2 + 0.06); // headboard
    k.box('wood_dark', w - 0.1, 0.4, 0.06, 0, 0.3, d / 2 - 0.06);
    k.box('wood_dark', w - 0.1, 0.25, d - 0.15, 0, 0.2, 0);
    k.box('linen', w - 0.2, 0.2, d - 0.25, 0, 0.45, 0);
    for (const sx of [-1, 1]) k.box('linen', 0.55, 0.12, 0.35, sx * 0.33, 0.65, -d / 2 + 0.35, { color: '#d8d0c0' });
    k.add(draped(w - 0.12, 0.08, d * 0.65, p.variant, 0.1), 'fabric_red', 0, 0.68, d * 0.12);
    // tattered canopy drapes
    for (const sx of [-1, 1]) k.add(draped(0.08, h - 0.4, 0.5, p.variant + 3, 0.6), 'fabric_red', sx * (w / 2 - 0.02), (h - 0.4) / 2 + 0.3, -d / 2 + 0.3);
  },
  small_bed(k, p) {
    const [w, , d] = p.size;
    k.box('painted', w, 0.7, 0.05, 0, 0, -d / 2 + 0.03);
    k.box('painted', w, 0.45, 0.05, 0, 0, d / 2 - 0.03);
    k.box('painted', w - 0.1, 0.15, d - 0.1, 0, 0.2, 0);
    k.box('linen', w - 0.14, 0.15, d - 0.15, 0, 0.35, 0);
    k.add(draped(w - 0.08, 0.06, d * 0.6, p.variant, 0.1), 'linen', 0, 0.52, d * 0.15);
    k.box('linen', 0.5, 0.1, 0.3, 0, 0.5, -d / 2 + 0.25, { color: '#d8d0c0' });
  },
  crib(k, p) {
    const [w, h, d] = p.size;
    k.box('painted', w, 0.06, d, 0, 0.4, 0);
    k.box('linen', w - 0.06, 0.1, d - 0.06, 0, 0.46, 0);
    for (const sz of [-1, 1]) {
      k.box('painted', w, 0.05, 0.05, 0, h - 0.05, sz * (d / 2 - 0.025));
      for (let x = -w / 2 + 0.04; x <= w / 2 - 0.03; x += 0.09) k.cyl('painted', 0.012, 0.012, h - 0.45, x, 0.45, sz * (d / 2 - 0.025), 5);
    }
    for (const sx of [-1, 1]) {
      k.box('painted', 0.05, h, d, sx * (w / 2 - 0.025), 0, 0);
      k.add(rocker(d), 'painted', sx * (w / 2 - 0.025), 0, 0);
    }
    k.add(draped(0.25, 0.25, 0.15, p.variant + 9, 0.3), 'linen', 0.2, 0.62, 0, 0, 0, 0, '#8a7a70'); // a forgotten doll
  },
  rocking_horse(k) {
    for (const sz of [-1, 1]) k.add(rocker(0.95), 'wood_dark', 0, 0, sz * 0.12);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('painted', 0.04, 0.32, 0.04, sx * 0.25, 0.06, sz * 0.1, { rz: -sx * 0.25, color: '#d8d0c0' });
    k.box('painted', 0.6, 0.2, 0.22, 0, 0.36, 0, { color: '#d8d0c0' });
    k.box('painted', 0.16, 0.32, 0.14, 0.32, 0.45, 0, { rz: -0.4, color: '#d8d0c0' });
    k.box('painted', 0.24, 0.1, 0.12, 0.44, 0.66, 0, { rz: -0.2, color: '#d8d0c0' });
    k.box('flowers_dead', 0.2, 0.12, 0.05, 0.3, 0.62, 0, { rz: -0.5 });
    k.box('fabric_red', 0.2, 0.03, 0.26, -0.02, 0.56, 0);
    k.sphere('black', 0.02, 0.48, 0.71, 0.06);
    k.sphere('black', 0.02, 0.48, 0.71, -0.06);
  },
  toy_blocks(k, p) {
    const R = rand(p.variant + 5);
    for (let i = 0; i < 7; i++) {
      const s = 0.08;
      const stack = i < 3 ? i : 0;
      k.box('painted', s, s, s, i < 3 ? 0 : (R() - 0.5) * 0.5, stack * s, i < 3 ? 0 : (R() - 0.5) * 0.4, { ry: R() * 2, color: TOY_COLORS[i % 4] });
    }
  },
  stove(k, p) {
    const [w, h, d] = p.size;
    k.box('iron', w, h - 0.25, d, 0, 0.12, 0);
    k.box('iron', w + 0.06, 0.05, d + 0.04, 0, h - 0.13, 0);
    k.legs('iron', w, d, 0.12, 0.08);
    for (const x of [-0.35, 0.35]) {
      k.box('iron', 0.5, 0.4, 0.02, x, 0.3, d / 2, { color: '#444444' });
      k.box('brass', 0.3, 0.02, 0.03, x, 0.62, d / 2 + 0.02);
    }
    k.add(new THREE.TorusGeometry(0.12, 0.02, 6, 16), 'iron', -0.35, h - 0.06, 0.1, Math.PI / 2, 0, 0);
    k.add(new THREE.TorusGeometry(0.12, 0.02, 6, 16), 'iron', 0.35, h - 0.06, 0.1, Math.PI / 2, 0, 0);
    k.cyl('iron', 0.08, 0.08, 2.2, 0.4, h - 0.1, -d / 2 + 0.12, 10); // chimney pipe
    k.lathe('iron', [[0, 0], [0.12, 0], [0.13, 0.18], [0.11, 0.2]], -0.3, h - 0.08, 0.1, 12); // an old pot
  },
  counter(k, p) {
    const [w, h, d] = p.size;
    k.box('wood_dark', w, h - 0.05, d - 0.04, 0, 0, -0.02);
    k.box('ceramic', w + 0.04, 0.05, d, 0, h - 0.05, 0, { color: '#8a8478' });
    for (let i = 0; i < 3; i++) k.box('wood_dark', w / 3 - 0.06, h - 0.25, 0.02, -w / 3 + i * (w / 3), 0.1, d / 2 - 0.03, { color: '#b09080' });
    const R = rand(p.variant);
    for (let i = 0; i < 4; i++) k.lathe('ceramic', [[0, 0], [0.05, 0], [0.06, 0.08], [0.04, 0.16], [0.045, 0.18]], (R() - 0.5) * w * 0.8, h, (R() - 0.5) * 0.3, 8, R() > 0.5 ? '#5a6a50' : '#8a8070');
  },
  shelf_jars(k, p) {
    const [w, h, d] = p.size;
    const R = rand(p.variant + 21);
    for (const sx of [-1, 1]) k.box('wood_dark', 0.03, h, d, sx * (w / 2 - 0.015), 0, 0);
    for (let s = 0; s < 4; s++) {
      const y = 0.1 + s * 0.45;
      k.box('wood_dark', w, 0.025, d, 0, y, 0);
      for (let x = -w / 2 + 0.12; x < w / 2 - 0.1; x += 0.15 + R() * 0.1) {
        const jh = 0.12 + R() * 0.12;
        k.lathe(R() > 0.4 ? 'ceramic' : 'iron', [[0, 0], [0.05, 0], [0.055, jh * 0.8], [0.03, jh], [0.035, jh + 0.02]], x, y + 0.025, 0, 8, R() > 0.5 ? '#4a5a48' : '#7a6a50');
      }
    }
  },
  crate(k, p) {
    const [w, h, d] = p.size;
    k.box('attic_planks', w, h, d, 0, 0, 0);
    for (const sy of [0.02, h - 0.1]) for (const sz of [-1, 1]) k.box('wood_dark', w + 0.02, 0.08, 0.03, 0, sy, sz * (d / 2), { color: '#8a7058' });
    for (const sz of [-1, 1]) k.box('wood_dark', 0.05, h * 1.25, 0.03, 0, 0.08, sz * (d / 2), { rz: 0.83, color: '#8a7058' });
  },
  trunk(k, p) {
    const [w, h, d] = p.size;
    k.box('leather', w, h * 0.7, d, 0, 0, 0);
    const lid = new THREE.CylinderGeometry(d / 2, d / 2, w, 12, 1, false, 0, Math.PI);
    lid.rotateZ(Math.PI / 2);
    lid.scale(1, 0.55, 1);
    k.add(lid, 'leather', 0, h * 0.7, 0);
    for (const x of [-w / 3, w / 3]) k.box('brass', 0.04, h * 0.72, d + 0.01, x, 0, 0);
    k.box('brass', 0.08, 0.1, 0.02, 0, h * 0.55, d / 2 + 0.005);
  },
  mannequin(k) {
    k.lathe('linen', [[0, 0.75], [0.12, 0.78], [0.15, 0.95], [0.12, 1.1], [0.17, 1.3], [0.16, 1.42], [0.06, 1.5], [0.04, 1.56], [0, 1.58]], 0, 0, 0, 12, '#b0a090');
    k.cyl('iron', 0.015, 0.015, 0.75, 0, 0, 0, 6);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      k.box('iron', 0.025, 0.025, 0.3, Math.sin(a) * 0.13, 0.01, Math.cos(a) * 0.13, { ry: a });
    }
    k.add(draped(0.4, 0.5, 0.3, 4, 0.5), 'fabric_red', 0, 1.0, 0, 0, 0, 0, '#5a4048'); // old dress
  },
  sheet_furniture(k, p) {
    const [w, h, d] = p.size;
    k.add(draped(w, h, d, p.variant + 1), 'linen', 0, h / 2, 0, 0, 0, 0, '#c8c0b0');
  },
  painting(k, p) {
    const [w, h] = p.size;
    const f = 0.07;
    for (const sy of [-1, 1]) k.box('brass', w + f, f, 0.05, 0, h / 2 + (sy * h) / 2 - f / 2, 0, { color: '#8a7040' });
    for (const sx of [-1, 1]) k.box('brass', f, h, 0.05, (sx * w) / 2, 0, 0, { color: '#8a7040' });
    // the picture: one cell of the painting atlas (4 x 2)
    const v = p.variant % 8;
    const g = new THREE.PlaneGeometry(w - 0.02, h - 0.02);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const u0 = (v % 4) / 4;
    const v0 = 1 - (Math.floor(v / 4) + 1) / 2;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) / 4, v0 + uv.getY(i) / 2);
    k.add(g, 'canvas', 0, h / 2, 0.012, 0, 0, 0, undefined, true);
  },
  wall_lamp(k) {
    k.box('brass', 0.12, 0.22, 0.02, 0, 0.0, -0.1);
    k.box('brass', 0.025, 0.025, 0.16, 0, 0.12, -0.03);
    k.lathe('lamp_glass', [[0.02, 0], [0.09, 0.02], [0.1, 0.12], [0.06, 0.2], [0.03, 0.2]], 0, 0.12, 0.06, 12);
  },
  window(k, p) {
    const [w, h] = p.size;
    const f = 0.08;
    k.box('moon_glass', w - 0.02, h - 0.02, 0.01, 0, 0.01, -0.03);
    for (const sy of [0, h - f]) k.box('wood_dark', w + f, f, 0.12, 0, sy, 0);
    for (const sx of [-1, 1]) k.box('wood_dark', f, h, 0.12, (sx * w) / 2, 0, 0);
    k.box('wood_dark', 0.04, h, 0.06, 0, 0, -0.01); // glazing bars
    for (const y of [h / 3, (2 * h) / 3]) k.box('wood_dark', w, 0.035, 0.06, 0, y, -0.01);
    k.box('wood_dark', w + 0.2, 0.05, 0.2, 0, -0.04, 0.05); // sill
    // curtains + rod
    k.add(new THREE.CylinderGeometry(0.015, 0.015, w + 0.7, 6), 'brass', 0, h + 0.15, 0.1, 0, 0, Math.PI / 2);
    for (const sx of [-1, 1]) k.add(draped(0.3, h + 0.35, 0.08, p.variant + sx, 0.25), 'fabric_red', sx * (w / 2 + 0.12), (h + 0.35) / 2 - 0.2, 0.12);
  },
  fireplace(k, p) {
    const [w, h, d] = p.size;
    k.box('brick', 0.35, h - 0.1, d, -w / 2 + 0.175, 0, 0);
    k.box('brick', 0.35, h - 0.1, d, w / 2 - 0.175, 0, 0);
    k.box('brick', w - 0.7, 0.4, d, 0, h - 0.5, 0);
    k.box('black', w - 0.7, h - 0.5, 0.05, 0, 0, -d / 2 + 0.05);
    k.box('wood_dark', w + 0.2, 0.08, d + 0.12, 0, h - 0.1, 0.06); // mantel
    k.box('brick', w + 0.1, 0.05, d + 0.25, 0, 0, 0.1, { color: '#555555' }); // hearth
    for (let i = 0; i < 4; i++) k.box('iron', 0.025, 0.025, d * 0.6, -0.24 + i * 0.16, 0.12, 0);
    k.add(draped(0.6, 0.12, 0.3, 5, 0.4), 'black', 0, 0.15, 0, 0, 0, 0, '#2a2622'); // cold ash
    k.lathe('ceramic', [[0, 0], [0.05, 0], [0.07, 0.1], [0.03, 0.2], [0.04, 0.25]], -w / 2 + 0.2, h, 0.05, 8, '#3a3a40');
    k.lathe('brass', [[0, 0], [0.04, 0], [0.01, 0.05], [0.01, 0.2], [0.03, 0.22]], w / 2 - 0.2, h, 0.05, 8);
  },
  chandelier(k, p) {
    const [, h] = p.size;
    k.cyl('iron', 0.008, 0.008, 0.6, 0, h - 0.05, 0, 4); // chain up to the ceiling
    k.lathe('brass', [[0, h - 0.1], [0.05, h - 0.12], [0.03, h - 0.4], [0.08, h - 0.7], [0.03, h - 0.85], [0, h - 0.9]], 0, 0, 0, 10);
    k.add(new THREE.TorusGeometry(0.45, 0.02, 6, 24), 'brass', 0, h - 0.7, 0, Math.PI / 2, 0, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a) * 0.45;
      const z = Math.sin(a) * 0.45;
      k.cyl('brass', 0.04, 0.02, 0.04, x, h - 0.7, z, 8);
      k.cyl('wax', 0.015, 0.015, 0.09, x, h - 0.66, z, 6, { color: '#9a9080' });
      k.sphere('ceramic', 0.02, x, h - 0.78, z, 1.6, '#c8d0d8');
    }
  },
  rug(k, p) {
    const [w, , l] = p.size;
    const g = new THREE.PlaneGeometry(w, l);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i) * (l / w)); // square pattern repeats along the length
    k.add(g, 'carpet', 0, 0.015, 0, 0, 0, 0, undefined, true); // 1.5 cm above the floor so it never flickers
    // fringe at both ends
    for (const sz of [-1, 1]) k.box('linen', w, 0.008, 0.06, 0, 0, (sz * (l + 0.06)) / 2, { color: '#8a7a60' });
  },
};

/** Build the placeholder parts for a prop (or a simple box if the type has no builder). */
export function buildProp(p: PlacedProp): Part[] {
  const k = new Kit();
  const b = BUILDERS[p.type];
  if (b) b(k, p);
  else k.box('wood_dark', p.size[0], p.size[1], p.size[2], 0, 0, 0);
  return k.parts;
}

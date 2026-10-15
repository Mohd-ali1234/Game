// =====================================================================
// client/src/ghost.ts
// The "Pale Watcher": a tall, thin, pale figure that stands perfectly still
// at the far end of corridors. Point your flashlight straight at it and it
// vanishes... then reappears somewhere nearby. (The SERVER decides where it
// is, so every player sees the same ghost.) No attacks yet.
//
// Look: semi-transparent, glowing edges, a slow shimmer running up its body.
// Upload models/ghost.glb to replace the shape - it keeps the ghost material.
// =====================================================================
import * as THREE from 'three';
import type { Layout } from '../../shared/layout';
import type { Assets } from './assets';
import { fitModel, modelKeyFor } from './models';

const HEIGHT = 2.35; // taller than a person

const vert = /* glsl */ `
  uniform float time;
  varying vec3 vN;
  varying vec3 vView;
  varying float vY;
  void main() {
    vec3 p = position;
    // a slow, wrong-feeling sway that grows towards the top
    float k = clamp(position.y / ${HEIGHT.toFixed(2)}, 0.0, 1.0);
    p.x += sin(time * 1.3 + position.y * 2.7) * 0.025 * k;
    p.z += cos(time * 1.1 + position.y * 2.1) * 0.02 * k;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vView = -mv.xyz;
    vN = normalize(normalMatrix * normal);
    vY = position.y;
    gl_Position = projectionMatrix * mv;
  }`;

const frag = /* glsl */ `
  uniform float time;
  uniform float fade;
  uniform vec3 color;
  varying vec3 vN;
  varying vec3 vView;
  varying float vY;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(vView);
    float rim = pow(1.0 - abs(dot(n, v)), 2.2);             // glowing edges
    float band = sin(vY * 18.0 - time * 2.4) * 0.5 + 0.5;    // shimmer moving upwards
    float grain = hash(floor(vY * 60.0) + floor(time * 24.0)); // faint static
    float feet = smoothstep(0.0, 0.7, vY);                   // fades out at the floor
    float a = (0.05 + rim * 0.62) * (0.8 + band * 0.3 + grain * 0.1) * feet * fade; // see-through middle, glowing edges
    vec3 c = color * (0.35 + rim * 1.35 + band * 0.12);
    gl_FragColor = vec4(c, a);
  }`;

export function ghostMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, fade: { value: 0 }, color: { value: new THREE.Color('#d8e4ff') } },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false, // you can see its glow down a dark, foggy corridor
  });
}

/** The figure, built from simple shapes. Origin = between its feet, facing +Z. */
function buildFigure(mat: THREE.Material, dark: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const robe = new THREE.LatheGeometry(
    [[0.02, 0], [0.34, 0.03], [0.3, 0.5], [0.24, 1.1], [0.2, 1.5], [0.24, 1.72], [0.14, 1.85], [0.06, 1.9], [0, 1.92]].map(([r, y]) => new THREE.Vector2(r, y)),
    20,
  );
  g.add(new THREE.Mesh(robe, mat));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), mat);
  head.scale.set(0.85, 1.25, 0.9);
  head.position.y = 2.08;
  head.rotation.z = 0.12; // head tilted, as if listening
  g.add(head);
  for (const sx of [-1, 1]) {
    // eye hollows: two dark, empty sockets
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), dark);
    eye.scale.set(1, 1.4, 0.6);
    eye.position.set(sx * 0.05, 2.1, 0.12);
    g.add(eye);
    // arms far too long, hanging past the knees
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 1.15, 4, 8), mat);
    arm.position.set(sx * 0.27, 1.12, 0.02);
    arm.rotation.z = sx * 0.06;
    g.add(arm);
    const hand = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.16, 4, 6), mat);
    hand.position.set(sx * 0.31, 0.45, 0.03);
    g.add(hand);
  }
  return g;
}

interface GhostView {
  obj: THREE.Group;
  mat: THREE.ShaderMaterial;
  dark: THREE.MeshBasicMaterial;
  spot: number; // -1 = gone
  fade: number;
  vanishing: number; // >0 while the vanish effect plays
  pos: THREE.Vector3;
}

export class Ghosts {
  private views: GhostView[] = [];
  private time = 0;

  constructor(private scene: THREE.Scene, private layout: Layout, assets: Assets, spots: number[]) {
    const key = modelKeyFor(assets, 'ghost');
    for (let n = 0; n < spots.length; n++) {
      const mat = ghostMaterial();
      const dark = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0 });
      const obj = new THREE.Group();
      obj.add(buildFigure(mat, dark));
      if (key) {
        void assets.model(key).then((src) => {
          if (!src) return;
          obj.clear();
          const m = fitModel(src, [0.8, HEIGHT, 0.6], key);
          m.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (mesh.isMesh) {
              mesh.material = mat;
              mesh.castShadow = false;
            }
          });
          obj.add(m);
        });
      }
      obj.visible = false;
      obj.renderOrder = 3;
      scene.add(obj);
      this.views.push({ obj, mat, dark, spot: -1, fade: 0, vanishing: 0, pos: new THREE.Vector3() });
    }
    spots.forEach((s, i) => this.set(i, s, true));
  }

  /** The server moved ghost `i` to `spot` (-1 = it vanished). */
  set(i: number, spot: number, instant = false) {
    const v = this.views[i];
    if (!v) return;
    if (spot < 0) {
      if (v.spot >= 0) v.vanishing = instant ? 0.0001 : 0.45;
      v.spot = -1;
      return;
    }
    const s = this.layout.ghostSpots[spot];
    if (!s) return;
    v.spot = spot;
    v.vanishing = 0;
    v.pos.set(s.x, s.y, s.z);
    v.obj.position.copy(v.pos);
    v.obj.scale.set(1, 1, 1);
    v.fade = instant ? 1 : 0; // fades in slowly when it reappears
    v.obj.visible = true;
  }

  /** Visible ghosts' positions (for the flashlight flicker + sounds). */
  nearestDistance(x: number, y: number, z: number): number {
    let best = Infinity;
    for (const v of this.views) {
      if (v.spot < 0 && v.vanishing <= 0) continue;
      const dy = Math.abs(v.pos.y - y) > 2 ? 6 : 0; // other floor: feels further
      best = Math.min(best, Math.hypot(v.pos.x - x, v.pos.z - z) + dy);
    }
    return best;
  }

  update(dt: number, camera: THREE.Camera) {
    this.time += dt;
    for (const v of this.views) {
      if (v.vanishing > 0) {
        // vanish: stretch upwards, flicker and fade away
        v.vanishing -= dt;
        const t = Math.max(0, v.vanishing / 0.45);
        v.fade = t * (Math.random() > 0.3 ? 1 : 0.2);
        v.obj.scale.set(1 - (1 - t) * 0.5, 1 + (1 - t) * 0.6, 1 - (1 - t) * 0.5);
        if (v.vanishing <= 0) v.obj.visible = false;
      } else if (v.spot >= 0) {
        v.fade = Math.min(1, v.fade + dt * 0.5);
        // always turned towards you
        v.obj.rotation.y = Math.atan2(camera.position.x - v.pos.x, camera.position.z - v.pos.z);
        v.obj.position.y = v.pos.y + Math.sin(this.time * 0.8) * 0.03;
      }
      v.mat.uniforms.time.value = this.time;
      v.mat.uniforms.fade.value = v.fade;
      v.dark.opacity = v.fade * 0.85;
    }
  }

  dispose() {
    for (const v of this.views) {
      this.scene.remove(v.obj);
      v.mat.dispose();
      v.dark.dispose();
    }
  }
}

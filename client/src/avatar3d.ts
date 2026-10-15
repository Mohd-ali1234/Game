// =====================================================================
// client/src/avatar3d.ts
// Builds the 3D avatar other players see: a colored capsule body, eyes,
// a funny hat, a flashlight in hand, a name tag and a "speaking" icon.
// Everything is made from simple shapes (no model files needed).
// If a .glb is configured in models.ts, it replaces the body + hat.
// =====================================================================
import * as THREE from 'three';
import { PLAYER_RADIUS } from '../../shared/game';
import { AVATARS } from './avatars';
import type { Assets } from './assets';
import { avatarModelKey, fitModel } from './models';

const BODY_LEN = 0.9; // capsule cylinder part; total height = 0.9 + 2 x 0.35 = 1.6
const HEAD_TOP = BODY_LEN + 2 * PLAYER_RADIUS + 0.05; // y of the top of the head (~1.65)
export const HEAD_Y = 1.45; // where the flashlight / eyes are

const mat = (color: number | string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...extra });

/** The funny hat for each avatar, built from simple shapes. Origin = top of the head. */
function buildHat(kind: string, bodyColor: string): THREE.Object3D {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, color: number | string, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat(color));
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  switch (kind) {
    case 'party': {
      const cone = add(new THREE.ConeGeometry(0.2, 0.5, 16), 0xffe14d, 0, 0.22);
      cone.rotation.z = 0.15;
      add(new THREE.SphereGeometry(0.06, 8, 8), 0xffffff, -0.03, 0.49);
      add(new THREE.TorusGeometry(0.12, 0.025, 6, 16), 0xff4d8d, 0, 0.12).rotation.x = Math.PI / 2;
      break;
    }
    case 'tophat':
      add(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 20), 0x1a1a1a, 0, 0.02);
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.42, 20), 0x1a1a1a, 0, 0.24);
      add(new THREE.CylinderGeometry(0.205, 0.205, 0.08, 20), 0xc0392b, 0, 0.1);
      break;
    case 'cowboy':
      add(new THREE.CylinderGeometry(0.46, 0.46, 0.03, 24), 0x8b5a2b, 0, 0.02);
      add(new THREE.CylinderGeometry(0.2, 0.24, 0.25, 20), 0xa0692f, 0, 0.15);
      add(new THREE.CylinderGeometry(0.245, 0.245, 0.05, 20), 0x5c3a17, 0, 0.07);
      break;
    case 'crown': {
      add(new THREE.CylinderGeometry(0.22, 0.2, 0.16, 16), 0xffd33d, 0, 0.08);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(new THREE.ConeGeometry(0.05, 0.14, 6), 0xffd33d, Math.cos(a) * 0.19, 0.22, Math.sin(a) * 0.19);
      }
      add(new THREE.SphereGeometry(0.035, 8, 8), 0xe53935, 0, 0.1, 0.21);
      break;
    }
    case 'propeller': {
      const dome = add(new THREE.SphereGeometry(0.22, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0x2f80ed, 0, 0);
      dome.scale.y = 0.8;
      add(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 6), 0xc0392b, 0, 0.2);
      const prop = new THREE.Group();
      prop.name = 'propeller'; // spun in game.ts
      prop.position.y = 0.28;
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 0.07), mat(0xf1c40f));
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.5), mat(0xe74c3c));
      prop.add(b1, b2);
      g.add(prop);
      break;
    }
    case 'bunny':
      for (const sx of [-1, 1]) {
        const ear = add(new THREE.CapsuleGeometry(0.06, 0.38, 4, 8), bodyColor, sx * 0.13, 0.32);
        ear.rotation.z = -sx * 0.12;
        const inner = add(new THREE.CapsuleGeometry(0.03, 0.3, 4, 8), 0xffb6c1, sx * 0.13, 0.32, 0.04);
        inner.rotation.z = -sx * 0.12;
      }
      break;
    case 'bow':
      for (const sx of [-1, 1]) {
        const wing = add(new THREE.ConeGeometry(0.13, 0.3, 4), 0xff2d75, sx * 0.17, 0.12);
        wing.rotation.z = sx * -Math.PI / 2;
      }
      add(new THREE.SphereGeometry(0.07, 10, 10), 0xffd1e0, 0, 0.12);
      break;
    case 'viking': {
      add(new THREE.SphereGeometry(0.25, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0x9aa0a6, 0, -0.02);
      for (const sx of [-1, 1]) {
        const horn = add(new THREE.ConeGeometry(0.06, 0.34, 8), 0xf5f0dc, sx * 0.3, 0.12);
        horn.rotation.z = -sx * 0.9;
      }
      break;
    }
  }
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = true;
  });
  return g;
}

/** A flat label (name or icon) that always faces the camera. */
function makeSprite(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number, scaleX: number, scaleY: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // sizeAttenuation off = always the same size on screen (readable far away, not huge up close)
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false, sizeAttenuation: false }));
  s.scale.set(scaleX, scaleY, 1);
  return s;
}

export interface Avatar3D {
  group: THREE.Group; // put this at the player's feet; rotate Y = where they face
  pivot: THREE.Group; // head/flashlight pivot: rotate X = look up/down
  lamp: THREE.Object3D; // where their flashlight is (a shared spotlight is moved here when they're close)
  aim: THREE.Object3D; // a point the flashlight points at
  beam: THREE.Mesh; // faint visible beam so you can spot flashlights from afar
  talk: THREE.Sprite; // "speaking" icon
  update(timeSeconds: number): void;
}

export const FLASH_ANGLE = 0.46; // flashlight cone half-angle (radians)
export const FLASH_RANGE = 24; // how far the flashlight reaches (meters)

export function buildAvatar(avatarIndex: number, name: string, assets?: Assets): Avatar3D {
  const def = AVATARS[avatarIndex % AVATARS.length];
  const group = new THREE.Group();

  // ----- body (replaced by a .glb if one is configured) -----
  const body = new THREE.Group();
  const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER_RADIUS, BODY_LEN, 6, 16), mat(def.color));
  capsule.position.y = PLAYER_RADIUS + BODY_LEN / 2 + 0.05;
  capsule.castShadow = true;
  capsule.receiveShadow = true;
  body.add(capsule);
  // eyes on the -Z side (the way the avatar faces)
  for (const sx of [-1, 1]) {
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 10), mat(0xffffff));
    white.position.set(sx * 0.13, 1.42, -0.29);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), mat(0x111111));
    pupil.position.set(sx * 0.13, 1.42, -0.355);
    body.add(white, pupil);
  }
  const hat = buildHat(def.hat, def.color);
  hat.position.y = HEAD_TOP - 0.05;
  body.add(hat);
  group.add(body);

  // Swap in a .glb model if one was uploaded (models/avatar_0.glb ... avatar_7.glb)
  const key = assets && avatarModelKey(assets, avatarIndex);
  if (assets && key) {
    void assets.model(key).then((src) => {
      if (!src) return;
      group.remove(body);
      group.add(fitModel(src, [0.7, 1.65, 0.5], key));
    });
  }

  // ----- flashlight in hand: pivots up/down with the player's pitch -----
  const pivot = new THREE.Group();
  pivot.position.set(0.28, HEAD_Y - 0.15, -0.15);
  group.add(pivot);
  const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.22, 10), mat(0x333333));
  torch.rotation.x = Math.PI / 2;
  torch.position.z = -0.1;
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 10), new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));
  lens.rotation.x = Math.PI / 2;
  lens.position.z = -0.215;
  pivot.add(torch, lens);

  const lamp = new THREE.Object3D();
  lamp.position.set(0, 0, -0.2);
  const aim = new THREE.Object3D();
  aim.position.set(0, 0, -5);
  pivot.add(lamp, aim);

  // faint visible beam (a see-through cone) - lets you see other players' flashlight beams
  const len = 9;
  const coneGeo = new THREE.ConeGeometry(len * Math.tan(FLASH_ANGLE), len, 24, 1, true);
  coneGeo.translate(0, -len / 2, 0);
  coneGeo.rotateX(Math.PI / 2); // point along -Z
  const beam = new THREE.Mesh(
    coneGeo,
    new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.035, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  beam.position.copy(lamp.position);
  pivot.add(beam);

  // ----- name tag and speaking icon -----
  const tag = makeSprite(
    (ctx, w, h) => {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, 18);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 34px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, w / 2, h / 2 + 2, w - 20);
    },
    256, 64, 0.5, 0.125,
  );
  tag.position.y = 2.2;
  group.add(tag);

  const talk = makeSprite(
    (ctx, w, h) => {
      ctx.font = '70px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔊', w / 2, h / 2);
    },
    96, 96, 0.16, 0.16,
  );
  talk.position.y = 2.6;
  talk.visible = false;
  group.add(talk);

  return {
    group, pivot, lamp, aim, beam, talk,
    update(t: number) {
      const prop = hat.getObjectByName('propeller');
      if (prop) prop.rotation.y = t * 12; // the propeller hat spins!
    },
  };
}

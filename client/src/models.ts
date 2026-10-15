// =====================================================================
// client/src/models.ts
// The .glb model loader. Right now every avatar is built from simple 3D
// shapes (see avatar3d.ts). To swap in a free low-poly .glb model later:
//
//   1. Put the file in  client/public/models/   (e.g. bunny.glb)
//   2. Add its URL below, at the avatar's number:  '/models/bunny.glb'
//   3. Commit to GitHub. Render redeploys. Done!
//
// If a file is missing or fails to load, the game quietly keeps using the
// simple-shape avatar, so a bad path never breaks the game.
// =====================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface AvatarModelConfig {
  url: string; // e.g. '/models/bunny.glb'
  scale?: number; // 1 = as exported. Players are ~1.7 m tall.
  yOffset?: number; // move the model up/down so its feet touch the floor
  rotationY?: number; // radians; turn it if it faces the wrong way (it must face -Z)
}

/**
 * One entry per avatar number (0 to 7). Use `null` to keep the shape-built avatar.
 * Example:  1: { url: '/models/ghost.glb', scale: 0.9 },
 */
export const AVATAR_MODELS: (AvatarModelConfig | null)[] = [
  null, // 0 Party Red
  null, // 1 Top Hat Blue
  null, // 2 Cowboy Green
  null, // 3 King Yellow
  null, // 4 Propeller Purple
  null, // 5 Bunny Orange
  null, // 6 Bow Pink
  null, // 7 Viking Teal
];

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D | null>>();

/** Load any .glb file (cached). Resolves to null if it can't be loaded. */
export function loadGlb(url: string): Promise<THREE.Object3D | null> {
  let p = cache.get(url);
  if (!p) {
    p = loader
      .loadAsync(url)
      .then((gltf) => gltf.scene)
      .catch((e) => {
        console.warn(`Could not load model ${url}: ${e}`);
        return null;
      });
    cache.set(url, p);
  }
  return p;
}

/** Get a fresh copy of the .glb model for avatar `i`, or null to use the simple shapes. */
export async function loadAvatarModel(i: number): Promise<THREE.Object3D | null> {
  const cfg = AVATAR_MODELS[i];
  if (!cfg) return null;
  const scene = await loadGlb(cfg.url);
  if (!scene) return null;
  const copy = cloneSkinned(scene); // clone() so every player gets their own copy
  const holder = new THREE.Group();
  holder.add(copy);
  copy.scale.setScalar(cfg.scale ?? 1);
  copy.position.y = cfg.yOffset ?? 0;
  copy.rotation.y = cfg.rotationY ?? 0;
  copy.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return holder;
}

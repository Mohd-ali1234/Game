// =====================================================================
// shared/game.ts
// Rules that BOTH the server and the browser use. Because both sides run
// the exact same Rapier physics code, the player's own prediction
// matches the server's answer almost perfectly.
//
// Units are METERS. The map is 32 m x 24 m. Y is "up".
// =====================================================================
import RAPIER from '@dimforge/rapier3d-compat';

export const MAP_W = 32; // map size along X (meters)
export const MAP_D = 24; // map size along Z (meters)
export const WALL_H = 3; // wall height (meters)

export const PLAYER_RADIUS = 0.35;
export const PLAYER_HEIGHT = 1.7; // total capsule height
export const EYE_HEIGHT = 1.6; // camera height above the floor
export const SPEED = 3.6; // meters per second at full stick
export const TICK_RATE = 20; // server updates per second
export const TICK_DT = 1 / TICK_RATE; // seconds per server update
export const MAX_PLAYERS = 6; // players per room
export const NUM_AVATARS = 8; // how many avatars exist (see client/src/avatars.ts)

// A wall/box: [x, z, width, depth, height?]  (x,z = its corner nearest the map origin)
export type Wall = [number, number, number, number, number?];

export const WALLS: Wall[] = [
  // --- outer border ---
  [0, 0, MAP_W, 0.64],
  [0, MAP_D - 0.64, MAP_W, 0.64],
  [0, 0, 0.64, MAP_D],
  [MAP_W - 0.64, 0, 0.64, MAP_D],
  // --- inner walls (with gaps to walk through) ---
  [8, 0.64, 0.64, 7.2],
  [8, 11.2, 0.64, 8],
  [16, 4, 0.64, 10],
  [16, 17.2, 0.64, 6.16],
  [24, 0.64, 0.64, 8],
  [24, 12, 0.64, 11.36],
  [8.64, 12, 5, 0.64],
  [20, 8, 4, 0.64],
  [18, 18, 6, 0.64],
  // --- pillars ---
  [12, 6, 1.3, 1.3],
  [20, 14, 1.3, 1.3],
  [27.6, 6, 1.3, 1.3],
  // --- low crates (1 m tall: good for shadows to hide behind) ---
  [3, 3, 1, 1, 1],
  [5, 19, 1.2, 1.2, 1],
  [13, 16, 1, 1, 1],
  [22, 20, 1, 1, 1],
  [28, 18, 1.2, 1.2, 1],
];

// Where players appear when they join (the left room, facing east). One per slot.
export const SPAWNS: [number, number][] = [
  [2.4, 10],
  [4, 10],
  [5.6, 10],
  [2.4, 12],
  [4, 12],
  [5.6, 12],
];
export const SPAWN_YAW = -Math.PI / 2; // facing +X (east)

/**
 * Collision engine built on Rapier physics.
 * It holds the static world (floor + walls) and ONE capsule that is
 * teleported to each player in turn to ask: "if this player tries to move
 * by this much, how far can they actually go?"  (slides along walls,
 * stays on the floor).
 */
export class Mover {
  private world: RAPIER.World;
  private probe: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });

    // The floor: a big flat box whose top surface is at y = 0
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(MAP_W / 2 + 5, 0.5, MAP_D / 2 + 5).setTranslation(MAP_W / 2, -0.5, MAP_D / 2));

    // The walls and crates: one box collider each
    for (const [x, z, w, d, h = WALL_H] of WALLS) {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x + w / 2, h / 2, z + d / 2));
    }

    // The "probe": a capsule the size of a player
    const half = (PLAYER_HEIGHT - 2 * PLAYER_RADIUS) / 2;
    this.probe = this.world.createCollider(RAPIER.ColliderDesc.capsule(half, PLAYER_RADIUS).setTranslation(0, PLAYER_HEIGHT / 2, 0));

    this.controller = this.world.createCharacterController(0.01);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setSlideEnabled(true);

    this.world.step(); // lets Rapier index the static colliders
  }

  /** Load the physics engine (it's WebAssembly) and build the world. */
  static async create(): Promise<Mover> {
    await RAPIER.init();
    return new Mover();
  }

  /**
   * Move a player for `dt` seconds. Returns their new [x, z].
   * ix, iy = stick as whole numbers -100..100 (ix = right, iy = back).
   * yaw   = which way the player is looking (movement is relative to it).
   */
  step(x: number, z: number, ix: number, iy: number, yaw: number, dt: number): [number, number] {
    let right = ix / 100;
    let fwd = -iy / 100;
    const len = Math.hypot(right, fwd);
    if (len > 1) {
      right /= len;
      fwd /= len;
    }
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    // right vector = (cos, -sin), forward vector = (-sin, -cos) in (x, z)
    const vx = (right * c - fwd * s) * SPEED * dt;
    const vz = (-right * s - fwd * c) * SPEED * dt;

    this.probe.setTranslation({ x, y: PLAYER_HEIGHT / 2, z });
    // a little downward push each step = the player is pressed onto the floor
    this.controller.computeColliderMovement(this.probe, { x: vx, y: -0.05, z: vz });
    const m = this.controller.computedMovement();
    return [x + m.x, z + m.z];
  }
}

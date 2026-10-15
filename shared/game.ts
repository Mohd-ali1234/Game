// =====================================================================
// shared/game.ts
// Rules that BOTH the server and the browser use. Because both sides run
// the exact same Rapier physics code, the player's own prediction
// matches the server's answer almost perfectly.
//
// Units are METERS. Y is "up". North = -Z, East = +X.
// The map itself comes from shared/maps/mansion.json (see layout.ts).
// =====================================================================
import RAPIER from '@dimforge/rapier3d-compat';
import { buildLayout, Layout } from './layout';

export const PLAYER_RADIUS = 0.3;
export const PLAYER_HEIGHT = 1.7; // total capsule height
export const EYE_HEIGHT = 1.6; // camera height above the feet
export const SPEED = 3.0; // meters per second at full stick (a careful walk)
export const TICK_RATE = 20; // server updates per second
export const TICK_DT = 1 / TICK_RATE; // seconds per server update
export const MAX_PLAYERS = 6; // players per room
export const NUM_AVATARS = 8; // how many avatars exist (see client/src/avatars.ts)
export const DOOR_REACH = 2.6; // how close you must be to open a door (meters)

/** The map, built once from the data file. */
export const LAYOUT: Layout = buildLayout();

/** Load the physics engine (it's WebAssembly). Call once before making Movers. */
let ready: Promise<void> | null = null;
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

/**
 * Collision engine built on Rapier physics, one per game room (because each
 * room has its own doors open/closed).
 * It holds the static world (floors, walls, stairs, furniture, doors) and ONE
 * capsule that is moved to each player in turn to ask: "if this player tries
 * to move by this much, where do they actually end up?" (slides along walls,
 * walks up stairs, stays on the floor).
 */
export class Mover {
  private world: RAPIER.World;
  private probe: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  private doorCols = new Map<string, RAPIER.Collider>();

  /** initPhysics() must have finished first. */
  constructor(layout: Layout = LAYOUT) {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });

    for (const c of layout.colliders) {
      const desc = RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setTranslation(c.cx, c.cy, c.cz);
      if (c.rot) desc.setRotation({ x: 0, y: Math.sin(c.rot / 2), z: 0, w: Math.cos(c.rot / 2) });
      this.world.createCollider(desc);
    }
    for (const s of layout.stairs) {
      const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(s.points));
      if (desc) this.world.createCollider(desc);
    }
    for (const d of layout.doors) {
      if (d.type !== 'door') continue;
      const c = d.collider;
      this.doorCols.set(d.id, this.world.createCollider(RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setTranslation(c.cx, c.cy, c.cz)));
    }

    // The "probe": a capsule the size of a player
    const half = (PLAYER_HEIGHT - 2 * PLAYER_RADIUS) / 2;
    this.probe = this.world.createCollider(RAPIER.ColliderDesc.capsule(half, PLAYER_RADIUS).setTranslation(0, -50, 0));

    this.controller = this.world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setSlideEnabled(true);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180); // stairs are ramps up to ~35 degrees
    this.controller.setMinSlopeSlideAngle((55 * Math.PI) / 180);
    this.controller.enableAutostep(0.3, 0.15, false); // step over thresholds and small bumps
    this.controller.enableSnapToGround(0.4); // stick to the stairs when walking down

    this.world.step(); // lets Rapier index all the colliders
  }

  /** Open (no collision) or close a door. */
  setDoor(id: string, open: boolean) {
    const c = this.doorCols.get(id);
    if (!c) return;
    c.setEnabled(!open);
    this.world.step(); // refresh the collision index
  }

  /**
   * Move a player for `dt` seconds. Returns their new [x, y, z] (y = feet).
   * ix, iy = stick as whole numbers -100..100 (ix = right, iy = back).
   * yaw   = which way the player is looking (movement is relative to it).
   */
  step(x: number, y: number, z: number, ix: number, iy: number, yaw: number, dt: number): [number, number, number] {
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

    this.probe.setTranslation({ x, y: y + PLAYER_HEIGHT / 2, z });
    // walk, with a tiny push down so we stay on the floor (a big push would slide us down the stairs)
    this.controller.computeColliderMovement(this.probe, { x: vx, y: -0.02, z: vz });
    const m = this.controller.computedMovement();
    const nx = x + m.x;
    let ny = y + m.y;
    const nz = z + m.z;
    if (!this.controller.computedGrounded()) {
      // nothing under our feet: fall
      this.probe.setTranslation({ x: nx, y: ny + PLAYER_HEIGHT / 2, z: nz });
      this.controller.computeColliderMovement(this.probe, { x: 0, y: -6 * dt, z: 0 });
      ny += this.controller.computedMovement().y;
    }
    return [nx, ny, nz];
  }

  /** Can you see from point A to point B without a wall/closed door in the way? */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.01) return true;
    const ray = new RAPIER.Ray({ x: ax, y: ay, z: az }, { x: dx / dist, y: dy / dist, z: dz / dist });
    const hit = this.world.castRay(ray, dist, true, undefined, undefined, this.probe);
    return !hit || hit.timeOfImpact > dist - 0.25;
  }
}

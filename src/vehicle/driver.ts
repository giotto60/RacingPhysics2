import * as THREE from 'three';
import { clamp } from '../core/math';
import type { Params } from '../core/params';
import type { Car, CarInput } from './car';

/**
 * A computer driver.
 *
 * Pure pursuit: aim at a point on the racing line some distance ahead, and set
 * a speed from how tight the road is between here and there. Both distances
 * scale with speed, which is what stops it swerving at walking pace and
 * understeering off at a hundred.
 *
 * It reads the same `CarInput` the player's keyboard produces and knows nothing
 * else about the car, so an opponent is simulated by exactly the same physics
 * as the player -- there is no AI cheat anywhere in here.
 */
export interface DriverState {
  /** Sample index it is currently tracking, so the search stays local. */
  index: number;
  /** Metres left of the centreline this driver likes to sit. */
  line: number;
  /** How long it has been going nowhere, seconds. */
  stuckFor: number;
  /** Laps completed, counted on the seam. */
  laps: number;
  /**
   * Set when reversing out has stopped being plausible -- on its roof, wedged
   * against another car, off the map. The owner puts it back on the road.
   */
  needsRescue: boolean;
}

export const createDriverState = (line = 0): DriverState => ({
  index: 0,
  line,
  stuckFor: 0,
  laps: 0,
  needsRescue: false,
});

/** How far ahead it looks, metres, as a base plus a share of its speed. */
const LOOK_BASE = 7;
const LOOK_PER_SPEED = 0.55;
/** Distances ahead the road is checked for a corner to slow down for, metres. */
const CORNER_SCAN = [8, 18, 30, 45, 65, 90, 120];
/** Fraction of the tyres' grip a computer driver is willing to use. */
const CONFIDENCE = 0.62;

const forward = new THREE.Vector3();
const toTarget = new THREE.Vector3();
const target = new THREE.Vector3();

/** Nearest sample to the car, searched forward from where it was last time. */
function trackIndex(car: Car, line: THREE.Vector3[], state: DriverState): number {
  const n = line.length;
  const t = car.body.translation();
  let best = state.index;
  let bestDist = Infinity;
  // A window either side: wide enough to recover from a spin, narrow enough
  // that the far side of a crossing is never mistaken for progress.
  for (let k = -20; k <= 60; k += 1) {
    const i = (state.index + k + n) % n;
    const p = line[i];
    const d = (p.x - t.x) ** 2 + (p.z - t.z) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Point on the line `metres` ahead of `index`, pushed `lateral` to one side. */
function pointAhead(
  line: THREE.Vector3[],
  index: number,
  metres: number,
  spacing: number,
  lateral: number,
  out: THREE.Vector3,
): void {
  const n = line.length;
  const i = (index + Math.round(metres / spacing)) % n;
  const here = line[i];
  const next = line[(i + 1) % n];
  const dx = next.x - here.x;
  const dz = next.z - here.z;
  const len = Math.max(1e-4, Math.hypot(dx, dz));
  out.set(here.x - (dz / len) * lateral, here.y, here.z + (dx / len) * lateral);
}

/** Heading of the line at a sample, radians. */
function headingAt(line: THREE.Vector3[], index: number): number {
  const n = line.length;
  const here = line[index % n];
  const next = line[(index + 2) % n];
  return Math.atan2(next.x - here.x, next.z - here.z);
}

export function driveAlong(
  car: Car,
  line: THREE.Vector3[],
  state: DriverState,
  params: Params,
  dt: number,
): CarInput {
  const n = line.length;
  // The centreline is sampled uniformly, so one segment gives the spacing that
  // converts a distance in metres into a number of samples.
  const step = Math.max(0.1, Math.hypot(line[1].x - line[0].x, line[1].z - line[0].z));

  const previous = state.index;
  state.index = trackIndex(car, line, state);
  if (previous > n * 0.75 && state.index < n * 0.25) state.laps += 1;

  const speed = car.speed;
  const rot = car.body.rotation();
  const quat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
  forward.set(0, 0, -1).applyQuaternion(quat);

  // --- where to aim -------------------------------------------------------
  //
  // Aiming a long way ahead is what keeps a pursuit driver steady on a
  // straight, and it is also what makes one cut the apex off a tight corner:
  // the chord to a distant point runs inside the arc. So the closer the road
  // ahead is to being a corner, the closer in it looks.
  let bend = Math.abs(headingAt(line, state.index + Math.round(30 / step)) - headingAt(line, state.index));
  if (bend > Math.PI) bend = Math.PI * 2 - bend;
  const look =
    (LOOK_BASE + LOOK_PER_SPEED * speed) * clamp(1 - (bend / 30) * 55, 0.4, 1);
  pointAhead(line, state.index, look, step, state.line, target);
  const t = car.body.translation();
  toTarget.set(target.x - t.x, 0, target.z - t.z);
  const across = toTarget.x * forward.z - toTarget.z * forward.x;
  const along = toTarget.x * forward.x + toTarget.z * forward.z;
  // Signed angle to the target: positive is a left turn, matching the input.
  const angle = Math.atan2(across, Math.max(0.1, along));
  const maxRack = params.steering.maxAngle * (Math.PI / 180);
  let steer = clamp(angle / maxRack, -1, 1);

  // --- how fast to take it ------------------------------------------------
  //
  // Every corner within braking distance is checked, not just the next one:
  // for each, the speed its curvature allows, and then the speed it is still
  // possible to arrive at that speed from. The tightest answer wins. Reading
  // only the road immediately ahead is what has a driver arrive at a hairpin
  // at a speed it was never going to be able to shed.
  // Grip is only half the question. Past a certain cornering force a car stops
  // sliding and starts tipping, and which of the two comes first is a property
  // of the vehicle: its track against the height of its centre of mass. Taking
  // the lower of the two means a top-heavy van is driven like a van and a race
  // car like a race car, with nothing authored per vehicle to say so.
  const s = params.suspension;
  const track = (s.trackFront + s.trackRear) * 0.5;
  const contactY = s.hardpointY - s.restLength - s.wheelRadius;
  const comHeight = Math.max(0.25, params.chassis.comY - contactY);
  const rolloverG = ((track * 0.5) / comHeight) * 9.81;
  const gripG = params.tyre.peakGrip * (params.tyre.surfaceGrip.tarmac ?? 1) * 9.81;
  const lateralG = Math.min(gripG, rolloverG * 0.8) * CONFIDENCE;
  const brakingG = lateralG * 0.9;
  let targetSpeed = 95;
  for (const distance of CORNER_SCAN) {
    const half = Math.round(11 / step);
    const at = state.index + Math.round(distance / step);
    let turn = Math.abs(headingAt(line, at + half) - headingAt(line, at - half + n));
    if (turn > Math.PI) turn = Math.PI * 2 - turn;
    const curvature = turn / 22;
    const corner = Math.sqrt(lateralG / Math.max(1e-4, curvature));
    // How fast it can be going here and still be down to `corner` by then.
    const allowed = Math.sqrt(corner * corner + 2 * brakingG * Math.max(0, distance - 6));
    targetSpeed = Math.min(targetSpeed, allowed);
  }
  targetSpeed = clamp(targetSpeed, 8, 95);

  let throttle = clamp((targetSpeed - speed) * 0.5, 0, 1);
  let brake = clamp((speed - targetSpeed) * 0.25, 0, 1);
  // Lift rather than fight the car when it is already sideways.
  const slide = Math.abs(car.bodySlip);
  if (slide > 0.35) throttle *= clamp(1 - (slide - 0.35) * 2, 0, 1);

  // --- getting going again -------------------------------------------------
  let reverse = false;
  const wantsToMove = throttle > 0.1;
  state.stuckFor = speed < 1.5 && wantsToMove ? state.stuckFor + dt : 0;
  if (state.stuckFor > 1.2) {
    // Back up and try again, steering the other way out of whatever it is in.
    reverse = true;
    throttle = 1;
    brake = 0;
    steer = -steer;
  }
  // Reversing only helps if the car is the right way up and free to move. Past
  // a few seconds of trying it is on its roof or wedged against something, and
  // the only thing left is to put it back on the road.
  const upright = 1 - 2 * (rot.x * rot.x + rot.z * rot.z);
  if (state.stuckFor > 5 || (upright < 0.2 && speed < 2)) state.needsRescue = true;

  return { throttle, brake, steer, reverse };
}

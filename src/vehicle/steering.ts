import { approach, clamp, DEG } from '../core/math';
import type { Params } from '../core/params';

/**
 * Steering rack.
 *
 * Player input never sets a wheel angle. It sets a target; a virtual rack
 * moves toward that target at a limited rate and returns to centre when the
 * input is released. Without this a keyboard player issues instant full-lock
 * inputs and honest physics becomes unplayable.
 */
export interface SteeringState {
  /** What the driver is asking for, radians. */
  commanded: number;
  /** Where the rack actually is, radians. */
  actual: number;
  /** Contribution from the drift assist this step, radians. */
  assist: number;
  /** Contribution from the wall-scrape nudge this step, radians. */
  nudge: number;
  /** Per-wheel front angles after Ackermann, radians. */
  frontLeft: number;
  frontRight: number;
}

export const createSteeringState = (): SteeringState => ({
  commanded: 0,
  actual: 0,
  assist: 0,
  nudge: 0,
  frontLeft: 0,
  frontRight: 0,
});

/** Steering authority remaining at this speed. Without it the car is undriveable fast. */
export function speedLimitFactor(params: Params, speed: number): number {
  const s = params.steering;
  const t = clamp(speed / Math.max(1, s.speedForMinLimit), 0, 1);
  const shaped = Math.pow(t, s.limitCurve);
  return 1 + (s.minLimitFactor - 1) * shaped;
}

export interface SteeringInput {
  steer: number;
  speed: number;
  /** Chassis slip angle, radians: signed angle from heading to velocity. */
  bodySlip: number;
  grounded: boolean;
  dt: number;
}

export function updateSteering(
  params: Params,
  state: SteeringState,
  input: SteeringInput,
): void {
  const s = params.steering;
  const maxAngle = s.maxAngle * DEG;
  const limit = maxAngle * speedLimitFactor(params, input.speed);

  state.commanded = input.steer * limit;

  // Drift assist: nudge the rack toward the direction the car is actually
  // travelling. Intensity includes zero so its contribution can be A/B tested.
  const assistCap = s.driftAssistMaxAngle * DEG;
  const wantedAssist =
    input.grounded && input.speed > 4
      ? clamp(-input.bodySlip * s.driftAssist, -assistCap, assistCap)
      : 0;
  state.assist = wantedAssist;

  const target = clamp(state.commanded + state.assist + state.nudge, -maxAngle, maxAngle);
  const returning = Math.abs(input.steer) < 1e-3 && Math.abs(state.assist) < 1e-3;
  const rate = (returning ? s.returnRate : s.rateToTarget) * DEG;
  state.actual = approach(state.actual, target, rate, input.dt);
  state.actual = clamp(state.actual, -limit - assistCap, limit + assistCap);

  // The nudge is a one-shot impulse from a wall scrape; bleed it away.
  state.nudge = approach(state.nudge, 0, 1.5, input.dt);

  applyAckermann(params, state);
}

/**
 * Ackermann geometry: the inside wheel needs a sharper angle than the outside
 * one to share a turn centre. Removes the scrubbing wrongness in tight corners.
 */
function applyAckermann(params: Params, state: SteeringState): void {
  const delta = state.actual;
  if (Math.abs(delta) < 1e-5) {
    state.frontLeft = delta;
    state.frontRight = delta;
    return;
  }
  const L = params.suspension.wheelbase;
  const halfTrack = params.suspension.trackFront * 0.5;
  const turnRadius = L / Math.tan(Math.abs(delta));
  const inner = Math.atan(L / Math.max(0.5, turnRadius - halfTrack));
  const outer = Math.atan(L / (turnRadius + halfTrack));
  const k = clamp(params.steering.ackermann, 0, 1);
  const innerAngle = Math.abs(delta) + (inner - Math.abs(delta)) * k;
  const outerAngle = Math.abs(delta) + (outer - Math.abs(delta)) * k;

  // Positive steer is a left turn, so the left wheel is the inside one.
  if (delta > 0) {
    state.frontLeft = innerAngle;
    state.frontRight = outerAngle;
  } else {
    state.frontLeft = -outerAngle;
    state.frontRight = -innerAngle;
  }
}

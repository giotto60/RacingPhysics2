import { clamp } from '../core/math';
import type { Params } from '../core/params';

/**
 * Tyre model.
 *
 * Normalised curve: rises to 1.0 at the peak slip value, then decays toward a
 * tunable tail rather than collapsing. The soft tail is deliberate -- with no
 * force feedback and an overhead view, a sharp Pacejka falloff reads as the
 * car randomly snapping away rather than as a loss of grip.
 */
export function normalisedGrip(slip: number, peakSlip: number, sharpness: number, tail: number): number {
  if (peakSlip <= 1e-6) return 0;
  const u = slip / peakSlip;
  const a = Math.abs(u);
  if (a <= 1) {
    return Math.sign(u) * Math.sin((Math.PI / 2) * a);
  }
  const decayed = tail + (1 - tail) * Math.exp(-sharpness * (a - 1));
  return Math.sign(u) * decayed;
}

/**
 * Slope of the normalised curve, clamped to be non-negative.
 *
 * Used to stabilise the wheel spin integration: near zero slip the tyre is
 * extremely stiff, and an explicit step at 120 Hz would oscillate. Feeding the
 * local slope back into the integrator damps that without softening the
 * physics the driver actually feels.
 */
export function gripSlope(slip: number, peakSlip: number, sharpness: number, tail: number): number {
  if (peakSlip <= 1e-6) return 0;
  const a = Math.abs(slip) / peakSlip;
  if (a <= 1) {
    return ((Math.PI / 2) * Math.cos((Math.PI / 2) * a)) / peakSlip;
  }
  // Past the peak the curve falls, so it contributes no restoring stiffness.
  void sharpness;
  void tail;
  return 0;
}

/**
 * Available friction coefficient for a wheel. Grip rises with vertical load
 * but less than proportionally, which is why weight transfer costs total grip
 * and why an evenly loaded car is faster.
 */
export function loadSensitiveMu(params: Params, load: number, surfaceMultiplier: number): number {
  const t = params.tyre;
  if (load <= 0) return 0;
  const ratio = load / Math.max(1, t.referenceLoad);
  // mu = peak * ratio^(loadSensitivity - 1): the exponent is applied to the
  // coefficient, so the resulting force scales as load^loadSensitivity.
  return t.peakGrip * surfaceMultiplier * Math.pow(ratio, t.loadSensitivity - 1);
}

export interface TyreDemand {
  /** Normalised longitudinal demand, 1.0 = all available grip. */
  fx: number;
  /** Normalised lateral demand. */
  fy: number;
  /** Combined demand before clamping -- this is grip utilisation. */
  utilisation: number;
  /** Scale that was applied to satisfy the friction circle. */
  scale: number;
}

/**
 * Combine longitudinal and lateral demand through the friction circle. A
 * tyre's grip is one shared budget; when demand exceeds it both components
 * are scaled down together, which is what makes trail braking and unwinding
 * the steering on exit emerge without being scripted.
 */
export function combineSlip(params: Params, fxRaw: number, fyRaw: number): TyreDemand {
  const utilisation = Math.hypot(fxRaw, fyRaw);
  if (!params.tyre.combinedSlip || utilisation <= 1) {
    return { fx: fxRaw, fy: fyRaw, utilisation, scale: 1 };
  }
  const scale = 1 / utilisation;
  return { fx: fxRaw * scale, fy: fyRaw * scale, utilisation, scale };
}

/**
 * Grip recovery. A tyre that has been pushed past the limit does not snap
 * back to full grip the instant demand drops; it recovers progressively, so
 * a slide is something the driver can watch develop and catch.
 */
export function updateGripState(
  params: Params,
  gripState: number,
  utilisation: number,
  dt: number,
): number {
  const t = params.tyre;
  if (utilisation > 1) {
    const excess = clamp(utilisation - 1, 0, 2);
    return clamp(gripState - t.gripLossRate * excess * dt, 0, 1);
  }
  return clamp(gripState + t.gripRecoveryRate * dt, 0, 1);
}

/** Multiplier applied to available grip given the current recovery state. */
export function gripStateMultiplier(params: Params, gripState: number): number {
  return params.tyre.slidingGrip + (1 - params.tyre.slidingGrip) * gripState;
}

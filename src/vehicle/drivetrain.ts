import { clamp } from '../core/math';
import type { Params } from '../core/params';

/**
 * Engine, gearbox and limited-slip differential.
 *
 * Torque reaches the road through the wheels' rotational dynamics, so
 * wheelspin, slip ratio and differential lock all fall out of the same
 * integration rather than being special-cased.
 */
export interface DrivetrainState {
  gear: number; // -1 reverse, 0 neutral, 1..n forward
  rpm: number;
  shiftTimer: number;
  engineTorque: number;
  /** Torque delivered to each wheel this step, FL FR RL RR. */
  wheelTorque: [number, number, number, number];
}

export const createDrivetrainState = (): DrivetrainState => ({
  gear: 1,
  rpm: 900,
  shiftTimer: 0,
  engineTorque: 0,
  wheelTorque: [0, 0, 0, 0],
});

/** Torque curve sampled every 1000 rpm from 1000 rpm upward, linearly blended. */
export function engineTorqueAt(params: Params, rpm: number): number {
  const curve = params.drivetrain.torqueCurve;
  if (curve.length === 0) return 0;
  const pos = clamp(rpm / 1000 - 1, 0, curve.length - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  const a = curve[i] ?? 0;
  const b = curve[Math.min(curve.length - 1, i + 1)] ?? a;
  return a + (b - a) * f;
}

export function gearRatio(params: Params, gear: number): number {
  const d = params.drivetrain;
  if (gear === 0) return 0;
  if (gear < 0) return -d.reverseRatio;
  return d.gearRatios[Math.min(d.gearRatios.length, gear) - 1] ?? 0;
}

/** Which of the four wheels are driven, FL FR RL RR. */
export function drivenWheels(params: Params): boolean[] {
  switch (params.drivetrain.layout) {
    case 'FWD':
      return [true, true, false, false];
    case 'AWD':
      return [true, true, true, true];
    default:
      return [false, false, true, true];
  }
}

/**
 * Limited-slip differential: split an axle's torque between its two wheels,
 * transferring torque from the faster wheel to the slower one. With the diff
 * open the split is fixed at 50/50 and a lifted inside wheel simply spins.
 */
function differential(
  params: Params,
  axleTorque: number,
  omegaLeft: number,
  omegaRight: number,
  dt: number,
): [number, number] {
  const d = params.drivetrain;
  const half = axleTorque * 0.5;
  if (d.lsdOpen) return [half, half];

  const onPower = axleTorque >= 0;
  const lockRatio = onPower ? d.lsdPowerLock : d.lsdCoastLock;
  const deltaOmega = omegaLeft - omegaRight;
  const lockCapacity = d.lsdPreload + lockRatio * Math.abs(axleTorque);
  // Ramp the transfer in over a small speed difference so the lock does not
  // chatter when the wheels are nearly matched.
  const engagement = clamp(Math.abs(deltaOmega) / 1.5, 0, 1);
  // Never transfer more than would exactly equalise the two wheels within one
  // step: a locking diff is stiff enough to ring at 120 Hz otherwise, which
  // shows up as the two driven wheels trading grip several times a second.
  const inertia = Math.max(0.05, params.tyre.wheelInertia);
  const equalising = (inertia * Math.abs(deltaOmega)) / (2 * Math.max(1e-4, dt));
  const transfer = Math.min(lockCapacity * engagement, equalising) * Math.sign(deltaOmega);
  return [half - transfer, half + transfer];
}

export interface DrivetrainInput {
  throttle: number;
  reverse: boolean;
  wheelOmega: number[];
  wheelRadius: number;
  forwardSpeed: number;
  dt: number;
}

export function updateDrivetrain(
  params: Params,
  state: DrivetrainState,
  input: DrivetrainInput,
): void {
  const d = params.drivetrain;
  const driven = drivenWheels(params);

  // --- gear selection ---------------------------------------------------
  if (input.reverse && input.forwardSpeed < 1.5) {
    state.gear = -1;
  } else if (state.gear === -1 && !input.reverse && input.forwardSpeed > -0.5) {
    state.gear = 1;
  }

  const ratio = gearRatio(params, state.gear);
  const totalRatio = ratio * d.finalDrive;

  // --- engine speed from the driven wheels ------------------------------
  let drivenOmega = 0;
  let drivenCount = 0;
  for (let i = 0; i < 4; i += 1) {
    if (driven[i]) {
      drivenOmega += input.wheelOmega[i];
      drivenCount += 1;
    }
  }
  drivenOmega = drivenCount > 0 ? drivenOmega / drivenCount : 0;

  const rpmFromWheels = Math.abs(drivenOmega * totalRatio) * (60 / (2 * Math.PI));
  state.rpm = clamp(Math.max(rpmFromWheels, d.idleRPM), d.idleRPM, d.limiterRPM);

  // --- automatic shifting ------------------------------------------------
  state.shiftTimer = Math.max(0, state.shiftTimer - input.dt);
  if (state.gear > 0 && state.shiftTimer === 0) {
    if (state.rpm >= d.shiftUpRPM && state.gear < d.gearRatios.length) {
      state.gear += 1;
      state.shiftTimer = d.shiftCutTime;
    } else if (state.rpm <= d.shiftDownRPM && state.gear > 1) {
      state.gear -= 1;
      state.shiftTimer = d.shiftCutTime;
    }
  }

  // --- torque -----------------------------------------------------------
  const cut = state.shiftTimer > 0 ? 0 : 1;
  const atLimiter = state.rpm >= d.limiterRPM - 20 ? 0.15 : 1;
  state.engineTorque = engineTorqueAt(params, state.rpm) * input.throttle * cut * atLimiter;

  let driveTorque = state.engineTorque * totalRatio * d.drivelineEfficiency;
  if (state.gear < 0) driveTorque *= d.reverseTorqueScale;

  const t = state.wheelTorque;
  t[0] = t[1] = t[2] = t[3] = 0;

  const dt = input.dt;
  if (d.layout === 'AWD') {
    const frontShare = clamp(d.awdFrontSplit, 0, 1);
    const [fl, fr] = differential(
      params,
      driveTorque * frontShare,
      input.wheelOmega[0],
      input.wheelOmega[1],
      dt,
    );
    const [rl, rr] = differential(
      params,
      driveTorque * (1 - frontShare),
      input.wheelOmega[2],
      input.wheelOmega[3],
      dt,
    );
    t[0] = fl;
    t[1] = fr;
    t[2] = rl;
    t[3] = rr;
  } else if (d.layout === 'FWD') {
    const [fl, fr] = differential(params, driveTorque, input.wheelOmega[0], input.wheelOmega[1], dt);
    t[0] = fl;
    t[1] = fr;
  } else {
    const [rl, rr] = differential(params, driveTorque, input.wheelOmega[2], input.wheelOmega[3], dt);
    t[2] = rl;
    t[3] = rr;
  }
}

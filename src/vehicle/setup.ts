import * as THREE from 'three';
import { clamp } from '../core/math';
import { defaultParams, type Params } from '../core/params';
import { CAR_CLASSES, type CarModelDef, type LoadedCarModel } from './models';

/**
 * Turning a picked car into a set of simulation parameters.
 *
 * The class table says what a vehicle *is* -- how big, how heavy, driven where.
 * Everything else is derived here, either from those figures or from the
 * model's own drawing: inertia from the body box, wheelbase and tyre size from
 * the hubs the artist placed, spring rates and brake torque from the mass. A
 * new vehicle is one row in the table, not a tuning session.
 *
 * The authored defaults are the baseline every multiplier works from, so
 * "restore defaults" still means something and the class table stays readable
 * as a set of relative statements rather than a wall of absolute numbers.
 */
const BASE = defaultParams();

/** Reference mass the authored suspension and brakes were written for. */
const BASE_MASS = BASE.chassis.mass;

/**
 * Kenney's kit tucks its wheels a long way under the body -- a sedan's hubs are
 * 0.6 model units apart inside a 1.5 unit wide shell. Taken literally that is a
 * car with a 40% track, and a car with 2 g of grip and a 40% track does not
 * slide when it is pushed, it tips over. Real cars run about 85% and so does
 * this: the model's own track is used where it is sane and floored here where
 * it is not.
 */
const MIN_TRACK_FRACTION = 0.85;

/** Wheelbase as a fraction of length, for a model with no wheels to measure. */
const FALLBACK_WHEELBASE = 0.6;

/**
 * Height of the hull box's underside above the tyre contact patch, metres.
 *
 * The drawn body sits on this line, so it is the car's ground clearance -- but
 * it is also a square-cornered box where the real thing has a rounded nose, so
 * it catches a ramp earlier than the shape suggests. Swept against the big ramp
 * taken at 30 m/s: 0.16 costs 1.4 m/s of entry speed and twelve scrape events,
 * 0.24 costs half a metre a second and five, and past 0.28 nothing improves.
 */
export const GROUND_CLEARANCE = 0.24;

export interface VehicleSetup {
  /** Scale applied to the model's own units to reach the authored size. */
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

/**
 * Write a model's class and geometry into the live parameters. Returns the
 * scale the drawn body has to take to match what was written.
 */
export function applyVehicleSetup(
  params: Params,
  def: CarModelDef,
  loaded: LoadedCarModel | null,
): VehicleSetup {
  const klass = CAR_CLASSES[def.klass];
  const c = params.chassis;
  const s = params.suspension;
  const d = params.drivetrain;

  // --- size ---------------------------------------------------------------
  const size = loaded ? loaded.bodyBox.getSize(new THREE.Vector3()) : null;
  const modelLength = size ? Math.max(1e-3, size.z) : 1;
  const modelWidth = size ? Math.max(1e-3, size.x) : 1;
  const modelHeight = size ? Math.max(1e-3, size.y) : 1;

  const scaleZ = klass.length / modelLength;
  const scaleX = klass.width / modelWidth;
  // Height rides the width scale, so the view a car is mostly seen from keeps
  // the proportions it was modelled with and only its length is stretched.
  const scaleY = scaleX;

  c.hullLength = klass.length;
  c.hullWidth = klass.width;
  c.hullHeight = loaded ? modelHeight * scaleY : BASE.chassis.hullHeight;

  // --- mass and inertia ----------------------------------------------------
  c.mass = klass.mass;
  // Principal moments of a solid box, trimmed a little: a car carries more of
  // its mass low and central than a uniform block does.
  const l = c.hullLength;
  const w = c.hullWidth;
  const h = c.hullHeight;
  const k = klass.mass / 12;
  c.inertiaRoll = Math.round(k * (w * w + h * h) * 0.85);
  c.inertiaPitch = Math.round(k * (l * l + h * h) * 0.85);
  c.inertiaYaw = Math.round(k * (l * l + w * w) * 0.85);

  // --- wheels --------------------------------------------------------------
  if (loaded && loaded.wheelRadius > 0) {
    // The tyre keeps the size it was drawn at, so it stays in proportion with
    // the body it belongs to instead of every vehicle wearing the same wheel.
    s.wheelRadius = clamp(loaded.wheelRadius * scaleY, 0.18, 0.9);
    // The kits draw a fat toy tyre; past about four fifths of the radius it
    // stops reading as a wheel and starts reading as a roller.
    s.wheelWidth = clamp(loaded.wheelWidth * scaleY, 0.12, s.wheelRadius * 0.8);
    s.wheelbase = clamp(loaded.wheelbase * scaleZ, l * 0.42, l * 0.78);
    const track = Math.max(loaded.track * scaleX, w * MIN_TRACK_FRACTION);
    s.trackFront = clamp(track, w * 0.5, w * 0.98);
    s.trackRear = s.trackFront;
  } else {
    s.wheelbase = l * FALLBACK_WHEELBASE;
    s.trackFront = w * 0.85;
    s.trackRear = s.trackFront;
    s.wheelRadius = BASE.suspension.wheelRadius;
    s.wheelWidth = BASE.suspension.wheelWidth;
  }

  // --- suspension ----------------------------------------------------------
  // Rates follow the mass, or a nine-tonne fire engine sits on its bump stops
  // and a two-hundred-kilo kart floats on springs meant for a saloon.
  const massRatio = klass.mass / BASE_MASS;
  s.stiffnessFront = Math.round(BASE.suspension.stiffnessFront * massRatio);
  s.stiffnessRear = Math.round(BASE.suspension.stiffnessRear * massRatio);
  s.dampingFront = Math.round(BASE.suspension.dampingFront * massRatio);
  s.dampingRear = Math.round(BASE.suspension.dampingRear * massRatio);
  s.maxForce = Math.round(BASE.suspension.maxForce * massRatio);
  s.antiRollFront = Math.round(BASE.suspension.antiRollFront * massRatio);
  s.antiRollRear = Math.round(BASE.suspension.antiRollRear * massRatio);
  s.bumpStopStiffness = Math.round(BASE.suspension.bumpStopStiffness * massRatio);
  s.bumpStopDamping = Math.round(BASE.suspension.bumpStopDamping * massRatio);
  // A wheel's inertia goes with its mass and the square of its radius.
  s.hardpointY = BASE.suspension.hardpointY;
  params.tyre.wheelInertia =
    BASE.tyre.wheelInertia * Math.sqrt(massRatio) * (s.wheelRadius / BASE.suspension.wheelRadius) ** 2;

  // --- ride height ---------------------------------------------------------
  // The hull box is the drawn body, so its underside is the car's ground
  // clearance and has to be placed against where the tyres actually sit.
  const settle = clamp(
    (c.mass * 9.81 * 0.25) / Math.max(1, (s.stiffnessFront + s.stiffnessRear) / 2),
    0,
    s.maxTravel,
  );
  const contactY = s.hardpointY - (s.restLength - settle) - s.wheelRadius;
  c.hullOffsetY = contactY + GROUND_CLEARANCE + h / 2;

  // --- centre of mass ------------------------------------------------------
  // Measured from the body's floor rather than from the chassis origin, so a
  // van's mass sits high in its own body and a race car's sits low in its own.
  const floor = c.hullOffsetY - h / 2;
  c.comY = floor + h * klass.comHeight;
  c.comZ = BASE.chassis.comZ;
  c.comX = 0;

  // --- engine, brakes and steering ----------------------------------------
  d.torqueCurve = BASE.drivetrain.torqueCurve.map((v) => Math.round(v * klass.power));
  d.layout = klass.layout;
  d.brakeTorqueFront = Math.round(BASE.drivetrain.brakeTorqueFront * massRatio);
  d.brakeTorqueRear = Math.round(BASE.drivetrain.brakeTorqueRear * massRatio);
  params.tyre.peakGrip = BASE.tyre.peakGrip * klass.grip;
  // Long vehicles turn their wheels less, which is most of why they feel long.
  params.steering.maxAngle = Math.round(
    BASE.steering.maxAngle * clamp(4.4 / klass.length, 0.62, 1.15),
  );
  // Drag scales with frontal area.
  params.chassis.dragCoefficient =
    BASE.chassis.dragCoefficient * ((w * h) / (BASE.chassis.hullWidth * 1.4));

  return { scaleX, scaleY, scaleZ };
}

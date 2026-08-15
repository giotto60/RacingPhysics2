import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { clamp, DEG } from '../core/math';
import type { Params, SurfaceType } from '../core/params';
import type { PhysicsWorld } from '../physics/world';
import { surfaceOf } from '../world/surfaces';
import {
  combineSlip,
  gripSlope,
  gripStateMultiplier,
  loadSensitiveMu,
  normalisedGrip,
  updateGripState,
} from './tyre';
import {
  createDrivetrainState,
  drivenWheels,
  updateDrivetrain,
  type DrivetrainState,
} from './drivetrain';
import { createSteeringState, updateSteering, type SteeringState } from './steering';
import {
  CAR_GROUP,
  DEBRIS_GROUP,
  PROP_GROUP,
  STATIC_GROUP,
  interactionGroups,
} from '../physics/materials';

export const WHEEL_COUNT = 4;
export const WHEEL_NAMES = ['FL', 'FR', 'RL', 'RR'] as const;

export interface WheelState {
  /** Chassis-local hardpoint the ray is cast from. */
  hardpoint: THREE.Vector3;
  isFront: boolean;
  /** -1 for the left of the car, +1 for the right. */
  side: number;

  grounded: boolean;
  /** Spring compression, metres. Clamped to the available travel. */
  compression: number;
  compressionVelocity: number;
  /**
   * Metres the ground intrudes past full bump. Non-zero means the suspension
   * has run out of travel and the bump stop is carrying the wheel.
   */
  overTravel: number;
  overTravelVelocity: number;
  /** Anti-roll bar contribution to this wheel's load, newtons. */
  antiRoll: number;
  /** Vertical load through this tyre, newtons. This explains most handling. */
  load: number;
  surface: SurfaceType;

  slipAngle: number;
  slipRatio: number;
  /** How fast the contact patch is actually sliding over the ground, m/s. */
  slipSpeed: number;
  /** Combined demand as a fraction of available grip. */
  utilisation: number;
  /** Normalised demand before the friction circle clamps it, for the plots. */
  demandLong: number;
  demandLat: number;
  gripState: number;
  omega: number;
  steerAngle: number;

  /** World-space bookkeeping, kept for debug draw and the expression layer. */
  contactPoint: THREE.Vector3;
  contactNormal: THREE.Vector3;
  wheelCentre: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  springForce: THREE.Vector3;
  lateralForce: THREE.Vector3;
  longitudinalForce: THREE.Vector3;
  spin: number;
}

const createWheelState = (hardpoint: THREE.Vector3, isFront: boolean, side: number): WheelState => ({
  hardpoint,
  isFront,
  side,
  grounded: false,
  compression: 0,
  compressionVelocity: 0,
  overTravel: 0,
  overTravelVelocity: 0,
  antiRoll: 0,
  load: 0,
  surface: 'tarmac',
  slipAngle: 0,
  slipRatio: 0,
  slipSpeed: 0,
  utilisation: 0,
  demandLong: 0,
  demandLat: 0,
  gripState: 1,
  omega: 0,
  steerAngle: 0,
  contactPoint: new THREE.Vector3(),
  contactNormal: new THREE.Vector3(0, 1, 0),
  wheelCentre: new THREE.Vector3(),
  forward: new THREE.Vector3(),
  right: new THREE.Vector3(),
  springForce: new THREE.Vector3(),
  lateralForce: new THREE.Vector3(),
  longitudinalForce: new THREE.Vector3(),
  spin: 0,
});

export interface CarInput {
  throttle: number;
  brake: number;
  steer: number;
  reverse: boolean;
}

const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchC = new THREE.Vector3();
const scratchQ = new THREE.Quaternion();

/**
 * A ray hit only counts as ground if the surface faces up. Without this a ray
 * that catches a wall -- the back of the jump, the side of a kerb -- reports a
 * grounded wheel and the suspension pushes the car sideways off it.
 */
const MIN_CONTACT_NORMAL_Y = 0.2;
/**
 * How far the ground may intrude past full suspension travel before the car is
 * lifted clear of it. The bump stop absorbs anything gentler; this is the last
 * line of defence that stops a hard landing leaving the hull inside the road.
 */
const PENETRATION_ALLOWANCE = 0.06;
/** Ceiling on a single step's positional correction, metres. */
const MAX_PENETRATION_RECOVERY = 0.15;

/**
 * The player car.
 *
 * Rapier owns only the chassis rigid body's integration and its contacts.
 * Suspension and tyre forces are computed here and applied as forces at world
 * points every fixed step -- Rapier's own vehicle controller cannot express
 * combined slip, load-sensitive curves or a limited-slip differential.
 */
export class Car {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly wheels: WheelState[] = [];
  readonly steering: SteeringState = createSteeringState();
  readonly drivetrain: DrivetrainState = createDrivetrainState();

  /** Signed forward speed, m/s. */
  forwardSpeed = 0;
  speed = 0;
  /** Signed angle from heading to velocity, radians. Visible oversteer. */
  bodySlip = 0;
  groundedCount = 0;
  airborneTime = 0;
  /** Last pedal positions, kept so the lights and the HUD can read them. */
  throttleInput = 0;
  brakeInput = 0;

  spawnPosition = new THREE.Vector3(0, 1.0, 0);
  spawnHeading = 0;

  private params: Params;
  private physics: PhysicsWorld;
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  constructor(physics: PhysicsWorld, params: Params, spawn: THREE.Vector3, heading = 0) {
    this.physics = physics;
    this.params = params;
    this.spawnPosition.copy(spawn);
    this.spawnHeading = heading;

    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      .setRotation(quatFromYaw(heading))
      .setCcdEnabled(true)
      .setLinearDamping(0)
      .setAngularDamping(0.15)
      .setSoftCcdPrediction(0.5);
    this.body = physics.world.createRigidBody(desc);

    const c = params.chassis;
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      c.hullWidth * 0.5,
      c.hullHeight * 0.5,
      c.hullLength * 0.5,
    )
      .setTranslation(0, c.hullOffsetY, 0)
      .setDensity(0)
      .setFriction(0.4)
      .setRestitution(params.collision.carRestitution)
      .setCollisionGroups(
        interactionGroups(CAR_GROUP, CAR_GROUP | PROP_GROUP | STATIC_GROUP | DEBRIS_GROUP),
      )
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(600);
    this.collider = physics.world.createCollider(colliderDesc, this.body);

    this.applyMassProperties();
    this.buildWheels();
  }

  /**
   * Resize the hull collider from the authored dimensions.
   *
   * This is what makes the car model picker honest: whatever body is drawn, the
   * box the car actually collides with is that body's box. It is also the only
   * thing that ever made the four hull sliders mean anything -- before this they
   * moved the drawn box and left the collider at its construction size.
   */
  applyHullShape(): void {
    const c = this.params.chassis;
    this.collider.setHalfExtents({
      x: Math.max(0.05, c.hullWidth * 0.5),
      y: Math.max(0.05, c.hullHeight * 0.5),
      z: Math.max(0.05, c.hullLength * 0.5),
    });
    this.collider.setTranslationWrtParent({ x: 0, y: c.hullOffsetY, z: 0 });
  }

  /**
   * Authored mass, centre of mass and inertia tensor. Rapier's auto-computed
   * tensor from a uniform-density box is wrong for a car -- yaw inertia in
   * particular governs how fast the car spins after a hit, so all three
   * principal moments are set explicitly.
   */
  applyMassProperties(): void {
    const c = this.params.chassis;
    this.body.setAdditionalMassProperties(
      c.mass,
      { x: c.comX, y: c.comY, z: c.comZ },
      // Rapier's principal moments are per-axis: X is pitch, Y is yaw, Z is roll.
      { x: c.inertiaPitch, y: c.inertiaYaw, z: c.inertiaRoll },
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );
  }

  buildWheels(): void {
    const s = this.params.suspension;
    const halfBase = s.wheelbase * 0.5;
    const layout: Array<[number, boolean, number]> = [
      [-s.trackFront * 0.5, true, -1],
      [s.trackFront * 0.5, true, 1],
      [-s.trackRear * 0.5, false, -1],
      [s.trackRear * 0.5, false, 1],
    ];
    this.wheels.length = 0;
    layout.forEach(([x, isFront, side]) => {
      const z = isFront ? -halfBase : halfBase;
      this.wheels.push(createWheelState(new THREE.Vector3(x, s.hardpointY, z), isFront, side));
    });
  }

  /** Re-seat hardpoints after a geometry parameter changes, keeping wheel state. */
  refreshGeometry(): void {
    const s = this.params.suspension;
    const halfBase = s.wheelbase * 0.5;
    this.wheels.forEach((w, i) => {
      const track = w.isFront ? s.trackFront : s.trackRear;
      w.hardpoint.set(w.side * track * 0.5, s.hardpointY, i < 2 ? -halfBase : halfBase);
    });
  }

  respawn(position?: THREE.Vector3, heading?: number): void {
    const p = position ?? this.spawnPosition;
    const h = heading ?? this.spawnHeading;
    this.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    this.body.setRotation(quatFromYaw(h), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (const w of this.wheels) {
      w.omega = 0;
      w.gripState = 1;
      w.compression = 0;
      w.compressionVelocity = 0;
      w.overTravel = 0;
      w.overTravelVelocity = 0;
      w.slipSpeed = 0;
    }
    this.drivetrain.gear = 1;
    this.drivetrain.rpm = this.params.drivetrain.idleRPM;
    this.drivetrain.shiftTimer = 0;
    this.drivetrain.shiftHold = 0;
    this.drivetrain.roadOmega = 0;
    this.steering.actual = 0;
  }

  worldPointVelocity(worldPoint: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const lv = this.body.linvel();
    const av = this.body.angvel();
    const com = this.body.worldCom();
    const r = scratchC.set(worldPoint.x - com.x, worldPoint.y - com.y, worldPoint.z - com.z);
    out.set(av.x, av.y, av.z).cross(r);
    out.x += lv.x;
    out.y += lv.y;
    out.z += lv.z;
    return out;
  }

  step(dt: number, input: CarInput): void {
    // Rapier keeps user forces applied until they are cleared, so every step
    // starts from a clean slate and re-applies this step's suspension, tyre
    // and drag forces from scratch.
    this.body.resetForces(false);
    this.body.resetTorques(false);

    this.throttleInput = input.throttle;
    this.brakeInput = input.brake;

    const rot = this.body.rotation();
    const quat = scratchQ.set(rot.x, rot.y, rot.z, rot.w);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);

    const lv = this.body.linvel();
    const velocity = new THREE.Vector3(lv.x, lv.y, lv.z);
    this.speed = velocity.length();
    this.forwardSpeed = velocity.dot(forward);
    const lateralSpeed = velocity.dot(right);
    const planar = Math.hypot(this.forwardSpeed, lateralSpeed);
    this.bodySlip = planar > 0.6 ? Math.atan2(lateralSpeed, Math.abs(this.forwardSpeed)) : 0;

    updateSteering(this.params, this.steering, {
      steer: input.steer,
      speed: this.speed,
      bodySlip: this.bodySlip,
      grounded: this.groundedCount > 0,
      dt,
    });

    this.castSuspension(quat, up, dt);
    this.applyAntiRollBars();

    updateDrivetrain(this.params, this.drivetrain, {
      throttle: input.throttle,
      reverse: input.reverse,
      wheelOmega: this.wheels.map((w) => w.omega),
      wheelRadius: this.params.suspension.wheelRadius,
      forwardSpeed: this.forwardSpeed,
      dt,
    });

    this.applySuspensionForces();
    this.applyTyreForces(quat, up, input, dt);
    this.applyDragAndResistance(velocity);
    this.applyAirborne(input, forward, right, up, dt);
  }

  private castSuspension(quat: THREE.Quaternion, up: THREE.Vector3, dt: number): void {
    const s = this.params.suspension;
    // Ray length is the fully extended spring plus the wheel radius; the
    // wheel is airborne beyond that.
    const maxLength = s.restLength + s.wheelRadius;
    const down = scratchA.copy(up).multiplyScalar(-1);
    this.groundedCount = 0;

    for (const wheel of this.wheels) {
      const origin = scratchB.copy(wheel.hardpoint).applyQuaternion(quat);
      const t = this.body.translation();
      origin.x += t.x;
      origin.y += t.y;
      origin.z += t.z;

      this.ray.origin = { x: origin.x, y: origin.y, z: origin.z };
      this.ray.dir = { x: down.x, y: down.y, z: down.z };

      // The chassis body is excluded so the car's own hull can never catch its
      // suspension rays -- the classic cause of a car sticking on a kerb.
      const hit = this.physics.world.castRayAndGetNormal(
        this.ray,
        maxLength,
        true,
        undefined,
        undefined,
        undefined,
        this.body,
      );

      const previousCompression = wheel.compression;
      const previousOverTravel = wheel.overTravel;

      // A trimesh reports the winding's normal, which can face either way
      // along the ray. Flip it so it always points back at the wheel, then
      // only accept it if the surface is something a wheel could rest on.
      let hitNormalY = 0;
      if (hit) {
        scratchC.set(hit.normal.x, hit.normal.y, hit.normal.z);
        if (scratchC.dot(down) > 0) scratchC.multiplyScalar(-1);
        hitNormalY = scratchC.y;
      }

      if (hit && hit.timeOfImpact <= maxLength && hitNormalY > MIN_CONTACT_NORMAL_Y) {
        wheel.grounded = true;
        this.groundedCount += 1;
        // The raw figure can exceed the available travel: that is the ground
        // intruding into the wheel arch, and it has to be kept rather than
        // clamped away, because it is the only measure of how far the car has
        // sunk into the surface.
        const raw = maxLength - hit.timeOfImpact;
        wheel.compression = clamp(raw, 0, s.maxTravel);
        wheel.overTravel = Math.max(0, raw - s.maxTravel);
        wheel.contactPoint.copy(origin).addScaledVector(down, hit.timeOfImpact);
        wheel.contactNormal.copy(scratchC).normalize();
        wheel.wheelCentre.copy(wheel.contactPoint).addScaledVector(up, s.wheelRadius);
        wheel.surface = surfaceOf(hit.collider.handle);
      } else {
        wheel.grounded = false;
        wheel.compression = 0;
        wheel.overTravel = 0;
        wheel.contactPoint.copy(origin).addScaledVector(down, maxLength);
        wheel.contactNormal.set(0, 1, 0);
        wheel.wheelCentre.copy(origin).addScaledVector(down, s.restLength);
        wheel.load = 0;
      }
      wheel.compressionVelocity = dt > 0 ? (wheel.compression - previousCompression) / dt : 0;
      wheel.overTravelVelocity = dt > 0 ? (wheel.overTravel - previousOverTravel) / dt : 0;
    }

    this.resolveGroundPenetration(up);
  }

  /**
   * Last line of defence against the car ending up inside the scenery.
   *
   * The bump stop deals with an ordinary heavy landing. This catches the cases
   * it cannot: a landing that arrives faster than the solver can answer, or a
   * tumble that drops the car onto the back of the jump. Once the ground is
   * further past full bump than the allowance, the body is lifted along its own
   * up axis and the velocity driving it into the surface is removed, so it
   * cannot simply sink again on the next step.
   */
  private resolveGroundPenetration(up: THREE.Vector3): void {
    let worst = 0;
    for (const wheel of this.wheels) {
      if (wheel.grounded && wheel.overTravel > worst) worst = wheel.overTravel;
    }
    if (worst <= PENETRATION_ALLOWANCE) return;

    const lift = Math.min(worst - PENETRATION_ALLOWANCE, MAX_PENETRATION_RECOVERY);
    const t = this.body.translation();
    this.body.setTranslation(
      { x: t.x + up.x * lift, y: t.y + up.y * lift, z: t.z + up.z * lift },
      true,
    );

    const lv = this.body.linvel();
    const into = lv.x * up.x + lv.y * up.y + lv.z * up.z;
    if (into < 0) {
      this.body.setLinvel(
        { x: lv.x - up.x * into, y: lv.y - up.y * into, z: lv.z - up.z * into },
        true,
      );
    }

    // Keep this step's bookkeeping consistent with the body that just moved,
    // so the suspension forces are applied at the corrected contact points.
    for (const wheel of this.wheels) {
      if (!wheel.grounded) continue;
      wheel.overTravel = Math.max(0, wheel.overTravel - lift);
      wheel.contactPoint.addScaledVector(up, lift);
      wheel.wheelCentre.addScaledVector(up, lift);
    }
  }

  /**
   * Anti-roll bars couple left and right compression on an axle. This is the
   * primary understeer/oversteer balance knob, so front and rear are separate.
   */
  private applyAntiRollBars(): void {
    const s = this.params.suspension;
    const apply = (left: WheelState, right: WheelState, stiffness: number): void => {
      const delta = left.compression - right.compression;
      const force = stiffness * delta;
      left.antiRoll = force;
      right.antiRoll = -force;
    };
    apply(this.wheels[0], this.wheels[1], s.antiRollFront);
    apply(this.wheels[2], this.wheels[3], s.antiRollRear);
  }

  private applySuspensionForces(): void {
    const s = this.params.suspension;
    for (const wheel of this.wheels) {
      if (!wheel.grounded) {
        wheel.load = 0;
        wheel.springForce.set(0, 0, 0);
        continue;
      }
      const stiffness = wheel.isFront ? s.stiffnessFront : s.stiffnessRear;
      const damping = wheel.isFront ? s.dampingFront : s.dampingRear;
      const spring = stiffness * wheel.compression;
      const damper = damping * wheel.compressionVelocity;
      const total = clamp(spring + damper + wheel.antiRoll, 0, s.maxForce);

      // Bump stop. Past full travel the spring has nothing left to give, so
      // without a stop here the chassis simply keeps descending until the hull
      // collider is inside the road.
      const bump =
        wheel.overTravel > 0
          ? Math.min(
              s.bumpStopStiffness * wheel.overTravel +
                s.bumpStopDamping * Math.max(0, wheel.overTravelVelocity),
              s.maxForce * 4,
            )
          : 0;

      // Grip is decided by the load the tyre carries, and a bottomed suspension
      // really does put the bump stop's force through it -- but only up to a
      // point, or a landing would hand the car impossible grip for one step.
      wheel.load = Math.min(total + bump, s.maxForce * 1.5);
      // Along the contact normal, not the chassis up axis. Tied to the chassis
      // it develops a horizontal component the moment the car pitches, which at
      // a standstill is a force with nothing to oppose it: the car creeps.
      wheel.springForce.copy(wheel.contactNormal).multiplyScalar(total + bump);
      this.body.addForceAtPoint(
        { x: wheel.springForce.x, y: wheel.springForce.y, z: wheel.springForce.z },
        { x: wheel.contactPoint.x, y: wheel.contactPoint.y, z: wheel.contactPoint.z },
        true,
      );
    }
  }

  private applyTyreForces(
    quat: THREE.Quaternion,
    up: THREE.Vector3,
    input: CarInput,
    dt: number,
  ): void {
    const p = this.params;
    const s = p.suspension;
    const radius = s.wheelRadius;
    const peakAlpha = p.tyre.peakSlipAngle * DEG;
    const driven = drivenWheels(p);
    const pointVelocity = new THREE.Vector3();

    this.wheels.forEach((wheel, i) => {
      wheel.steerAngle = wheel.isFront
        ? i === 0
          ? this.steering.frontLeft
          : this.steering.frontRight
        : 0;

      // Wheel basis: chassis basis rotated by the steer angle about the up axis.
      const steerQuat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        wheel.steerAngle,
      );
      const wheelQuat = new THREE.Quaternion().multiplyQuaternions(quat, steerQuat);
      wheel.forward.set(0, 0, -1).applyQuaternion(wheelQuat);
      wheel.right.set(1, 0, 0).applyQuaternion(wheelQuat);

      // Project the basis onto the contact plane so slip is measured in the
      // plane the tyre is actually working in.
      const normal = wheel.grounded ? wheel.contactNormal : up;
      wheel.forward.addScaledVector(normal, -wheel.forward.dot(normal)).normalize();
      wheel.right.copy(normal).cross(wheel.forward).multiplyScalar(-1).normalize();

      const driveTorque = this.drivetrain.wheelTorque[i];
      const brakeTorque =
        (wheel.isFront ? p.drivetrain.brakeTorqueFront : p.drivetrain.brakeTorqueRear) * input.brake;

      if (!wheel.grounded) {
        wheel.slipAngle = 0;
        wheel.slipRatio = 0;
        wheel.slipSpeed = 0;
        wheel.utilisation = 0;
        wheel.demandLong = 0;
        wheel.demandLat = 0;
        wheel.lateralForce.set(0, 0, 0);
        wheel.longitudinalForce.set(0, 0, 0);
        wheel.gripState = updateGripState(p, wheel.gripState, 0, dt);
        this.integrateWheel(wheel, driveTorque, brakeTorque, 0, 0, dt, driven[i]);
        wheel.spin += wheel.omega * dt;
        return;
      }

      this.worldPointVelocity(wheel.contactPoint, pointVelocity);
      const vLong = pointVelocity.dot(wheel.forward);
      const vLat = pointVelocity.dot(wheel.right);

      const slipReference = Math.max(Math.abs(vLong), 2.0);
      const longSlipSpeed = wheel.omega * radius - vLong;
      wheel.slipRatio = clamp(longSlipSpeed / slipReference, -2, 2);
      wheel.slipAngle = Math.atan2(vLat, Math.max(Math.abs(vLong), 1.2));
      // The honest quantity: how fast the rubber is being dragged across the
      // ground. Slip ratio and angle are both normalised, so they read high at
      // walking pace where nothing is really sliding.
      wheel.slipSpeed = Math.hypot(longSlipSpeed, vLat);

      const surfaceMultiplier = p.tyre.surfaceGrip[wheel.surface] ?? 1;
      const mu =
        loadSensitiveMu(p, wheel.load, surfaceMultiplier) * gripStateMultiplier(p, wheel.gripState);
      const capacity = mu * wheel.load;

      const fxRaw = normalisedGrip(
        wheel.slipRatio,
        p.tyre.peakSlipRatio,
        p.tyre.falloffSharpness,
        p.tyre.tailGrip,
      );
      const fyRaw = -normalisedGrip(
        wheel.slipAngle,
        peakAlpha,
        p.tyre.falloffSharpness,
        p.tyre.tailGrip,
      );

      const demand = combineSlip(p, fxRaw, fyRaw);
      wheel.utilisation = demand.utilisation;
      wheel.demandLong = fxRaw;
      wheel.demandLat = fyRaw;
      wheel.gripState = updateGripState(p, wheel.gripState, demand.utilisation, dt);

      // Rolling resistance is deliberately absent here: it is a torque at the
      // wheel, applied in `integrateWheel`. Subtracted from the contact force
      // it would go straight back into the wheel's own equation of motion, the
      // wheel would spin up until the tyre cancelled it exactly, and the car
      // would feel nothing at all however high the coefficient went.
      const fx = demand.fx * capacity;
      const fy = demand.fy * capacity;

      wheel.longitudinalForce.copy(wheel.forward).multiplyScalar(fx);
      wheel.lateralForce.copy(wheel.right).multiplyScalar(fy);

      const total = scratchA.copy(wheel.longitudinalForce).add(wheel.lateralForce);
      this.body.addForceAtPoint(
        { x: total.x, y: total.y, z: total.z },
        { x: wheel.contactPoint.x, y: wheel.contactPoint.y, z: wheel.contactPoint.z },
        true,
      );

      // Local longitudinal stiffness, in newtons per unit slip ratio: this is
      // what the wheel integrator uses to stay stable at low speed.
      const stiffness =
        gripSlope(wheel.slipRatio, p.tyre.peakSlipRatio, p.tyre.falloffSharpness, p.tyre.tailGrip) *
        capacity *
        (demand.scale < 1 ? demand.scale : 1);

      this.integrateWheel(wheel, driveTorque, brakeTorque, fx, stiffness / slipReference, dt, driven[i]);
      wheel.spin += wheel.omega * dt;
    });
  }

  /**
   * Wheel rotational dynamics. Slip ratio, wheelspin and the differential's
   * effect all depend on the wheels having their own angular velocity.
   */
  private integrateWheel(
    wheel: WheelState,
    driveTorque: number,
    brakeTorque: number,
    longitudinalForce: number,
    /** dFx/d(omega): local tyre stiffness seen by the wheel, N per rad/s. */
    forceGradient: number,
    dt: number,
    isDriven: boolean,
  ): void {
    const p = this.params;
    const inertia = Math.max(0.05, p.tyre.wheelInertia);
    const radius = p.suspension.wheelRadius;

    let net = driveTorque - longitudinalForce * radius;
    if (!isDriven && !wheel.grounded) {
      // An undriven airborne wheel just spins down.
      net -= wheel.omega * 0.4;
    }

    // Semi-implicit step. Near zero slip the tyre is far too stiff for an
    // explicit integrator at 120 Hz -- it would ring at a standstill and eat
    // all the drive torque. Folding the local gradient into the denominator
    // makes it unconditionally stable without changing the forces applied to
    // the chassis.
    const damping = 1 + (dt * radius * radius * Math.max(0, forceGradient)) / inertia;
    let omega = wheel.omega + ((net / inertia) * dt) / damping;

    // Rolling resistance belongs here, as a torque, because that is what it
    // physically is: carcass hysteresis resisting rotation. The wheel slows,
    // the slip ratio goes slightly negative, and the tyre drags the car back
    // through the contact patch -- so the coefficient reaches the chassis
    // instead of being cancelled out. It is also what holds a parked car
    // still, since a wheel it has stopped resists being turned again.
    //
    // It goes through the same denominator as the drive torque above. Outside
    // it, the tyre force it works against is damped and it is not, so the
    // retarding force would come out speed-dependent -- several times the
    // coefficient at walking pace, enough to stop the car pulling away at all.
    const rolling = wheel.grounded
      ? Math.max(0, p.chassis.rollingResistance) * wheel.load * radius
      : 0;
    if (rolling > 0) {
      const delta = ((rolling / inertia) * dt) / damping;
      if (Math.abs(omega) <= delta) omega = 0;
      else omega -= Math.sign(omega) * delta;
    }

    // Braking can bring a wheel to a stop but never drive it backwards.
    if (brakeTorque > 0) {
      const brakeDelta = (brakeTorque / inertia) * dt;
      if (Math.abs(omega) <= brakeDelta) omega = 0;
      else omega -= Math.sign(omega) * brakeDelta;
    }
    wheel.omega = clamp(omega, -400, 400);
  }

  private applyDragAndResistance(velocity: THREE.Vector3): void {
    const k = this.params.chassis.dragCoefficient;
    if (k <= 0) return;
    const speed = velocity.length();
    if (speed < 0.01) return;
    const drag = scratchA.copy(velocity).multiplyScalar(-k * speed);
    this.body.addForce({ x: drag.x, y: drag.y, z: drag.z }, true);
  }

  /**
   * Airborne behaviour: damp the tumble so a landing stays recoverable, and
   * give the player a little yaw and pitch authority in the air.
   */
  private applyAirborne(
    input: CarInput,
    forward: THREE.Vector3,
    right: THREE.Vector3,
    _up: THREE.Vector3,
    dt: number,
  ): void {
    if (this.groundedCount > 0) {
      this.airborneTime = 0;
      return;
    }
    this.airborneTime += dt;
    const a = this.params.airborne;

    const av = this.body.angvel();
    const damping = Math.exp(-a.angularDamping * dt);
    this.body.setAngvel(
      { x: av.x * damping, y: av.y * damping, z: av.z * damping },
      true,
    );

    const yawTorque = this.steering.commanded !== 0 ? Math.sign(this.steering.commanded) : 0;
    const pitchInput = input.throttle - input.brake;
    const torque = scratchA
      .set(0, 1, 0)
      .multiplyScalar(yawTorque * a.yawAuthority)
      .addScaledVector(right, pitchInput * a.pitchAuthority);
    // `right` and `forward` are already unit vectors; forward is unused here
    // but kept in the signature so the air-control basis stays explicit.
    void forward;
    this.body.addTorque({ x: torque.x, y: torque.y, z: torque.z }, true);
  }
}

export function quatFromYaw(yaw: number): { x: number; y: number; z: number; w: number } {
  const half = yaw * 0.5;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}

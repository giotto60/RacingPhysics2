import * as THREE from 'three';
import { clamp } from '../core/math';
import type { Params } from '../core/params';
import type { PhysicsWorld } from './world';
import type { Car } from '../vehicle/car';
import type { PropWorld } from '../world/props';

/**
 * Collision response, including the deliberate departures from physical
 * honesty.
 *
 * A realistic glancing wall impact removes a large chunk of momentum, because
 * the normal impulse lands instantly and contact friction eats the tangential
 * component. That is correct for a real car and wrong for a racing game: it
 * means brushing a wall at five degrees stops the player dead, which they will
 * accurately describe as the wall grabbing them. So the impulse is decomposed,
 * the normal component is absorbed honestly, and the tangential component is
 * heavily preserved.
 */

export type ImpactTier = 'scuff' | 'bump' | 'crash';

export interface ImpactEvent {
  tier: ImpactTier;
  /** The single continuous quantity every feedback channel is derived from. */
  magnitude: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  /** True when the other body is the world or an immovable prop. */
  againstStatic: boolean;
  /** Tangential speed along the contact -- drives sustained scrape feedback. */
  tangentialSpeed: number;
}

export class CollisionResponse {
  onImpact: ((event: ImpactEvent) => void) | null = null;

  /** Set while the car is in sustained contact, for scrape audio and sparks. */
  scrapeIntensity = 0;

  private preLinvel = new THREE.Vector3();
  private preAngvel = new THREE.Vector3();
  private normal = new THREE.Vector3();
  private point = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private contactThisStep = false;

  constructor(
    private physics: PhysicsWorld,
    private car: Car,
    private props: PropWorld,
    private params: Params,
  ) {}

  /** Latch the car's pre-solve velocity so the solver's effect can be measured. */
  beforeStep(): void {
    const lv = this.car.body.linvel();
    const av = this.car.body.angvel();
    this.preLinvel.set(lv.x, lv.y, lv.z);
    this.preAngvel.set(av.x, av.y, av.z);
    this.contactThisStep = false;
  }

  afterStep(dt: number): void {
    let strongest = 0;
    let strongestPair: [number, number] | null = null;
    this.normal.set(0, 1, 0);

    this.physics.eventQueue.drainContactForceEvents((event) => {
      const magnitude = event.totalForceMagnitude() * dt;
      const h1 = event.collider1();
      const h2 = event.collider2();
      const involvesCar = h1 === this.car.collider.handle || h2 === this.car.collider.handle;

      if (involvesCar) {
        this.contactThisStep = true;
        if (magnitude > strongest) {
          strongest = magnitude;
          const dir = event.maxForceDirection();
          this.normal.set(dir.x, dir.y, dir.z);
          strongestPair = [h1, h2];
        }
      } else if (magnitude > this.params.collision.bumpThreshold * 0.4) {
        // Prop-on-prop hits still feed the feedback bus, quietly.
        this.emit(magnitude * 0.35, this.pointBetween(h1, h2), this.normal, true, 0);
      }
    });

    if (!this.contactThisStep) {
      this.scrapeIntensity = Math.max(0, this.scrapeIntensity - dt * 4);
      return;
    }

    const otherHandle =
      strongestPair === null
        ? -1
        : strongestPair[0] === this.car.collider.handle
          ? strongestPair[1]
          : strongestPair[0];
    const otherProp = otherHandle >= 0 ? this.props.isProp(otherHandle) : undefined;
    const againstStatic = !otherProp || otherProp.frozen || otherProp.def.propClass === 'D';

    this.point.copy(this.pointBetween(this.car.collider.handle, otherHandle));
    if (this.normal.lengthSq() < 1e-6) this.normal.set(0, 1, 0);
    this.normal.normalize();

    const tangentialSpeed = this.applyExceptions(againstStatic, dt);
    this.scrapeIntensity = clamp(tangentialSpeed / 22, 0, 1);
    this.emit(strongest, this.point, this.normal, againstStatic, tangentialSpeed);
  }

  private pointBetween(h1: number, h2: number): THREE.Vector3 {
    const c1 = this.physics.world.getCollider(h1);
    const c2 = h2 >= 0 ? this.physics.world.getCollider(h2) : null;
    const t1 = c1?.translation();
    const t2 = c2?.translation();
    if (t1 && t2) {
      return this.tmp.set((t1.x + t2.x) / 2, (t1.y + t2.y) / 2, (t1.z + t2.z) / 2);
    }
    if (t1) return this.tmp.set(t1.x, t1.y, t1.z);
    return this.tmp.set(0, 0, 0);
  }

  /**
   * The exception layer. Everything here is tunable and can be switched off so
   * the physically honest version is directly comparable.
   */
  private applyExceptions(againstStatic: boolean, dt: number): number {
    const c = this.params.collision;
    const lv = this.car.body.linvel();
    const post = new THREE.Vector3(lv.x, lv.y, lv.z);

    // Orient the normal so it points away from the surface: whichever way
    // Rapier reported the strongest contact force, the useful direction is
    // the one that opposed the car's incoming velocity.
    if (this.normal.dot(this.preLinvel) > 0) this.normal.multiplyScalar(-1);

    const preNormalSpeed = this.preLinvel.dot(this.normal);
    const preTangential = this.preLinvel.clone().addScaledVector(this.normal, -preNormalSpeed);
    const tangentialSpeed = preTangential.length();

    if (!c.exceptionsEnabled) return tangentialSpeed;

    // --- impulse decomposition ------------------------------------------
    // The normal component is absorbed exactly as the solver resolved it. The
    // tangential component is restored toward what the car arrived with, so a
    // graze scrapes along instead of sticking.
    const postNormalSpeed = post.dot(this.normal);
    const postTangential = post.clone().addScaledVector(this.normal, -postNormalSpeed);
    const postTangentialSpeed = postTangential.length();

    const speed = Math.max(0.01, this.preLinvel.length());
    const incidence = Math.abs(preNormalSpeed) / speed; // 1 = head-on, 0 = parallel
    // A graze costs almost nothing; a head-on hit is genuinely punishing.
    const preservation = clamp(
      c.wallTangentPreservation * (1 - incidence * clamp(c.wallAngleScale, 0, 1)),
      0,
      0.98,
    );

    const targetTangentialSpeed =
      postTangentialSpeed + (tangentialSpeed - postTangentialSpeed) * preservation;
    const corrected = this.normal.clone().multiplyScalar(postNormalSpeed);
    if (postTangentialSpeed > 1e-4) {
      corrected.addScaledVector(postTangential, targetTangentialSpeed / postTangentialSpeed);
    } else {
      corrected.add(postTangential);
    }

    // --- suppress positive vertical impulse ------------------------------
    // Differing collider geometries meeting at speed will otherwise launch
    // bodies into the air, which is the most immersion-destroying bug in the
    // genre.
    if (c.suppressVerticalImpulse && corrected.y > this.preLinvel.y) {
      corrected.y = this.preLinvel.y + (corrected.y - this.preLinvel.y) * 0.25;
    }

    this.car.body.setLinvel({ x: corrected.x, y: corrected.y, z: corrected.z }, true);

    // --- clamp induced yaw ------------------------------------------------
    // A realistic rear-quarter hit produces an instant unrecoverable spin.
    // Only the yaw the *impact* added is capped, so ordinary cornering rates
    // are left alone.
    const av = this.car.body.angvel();
    const induced = av.y - this.preAngvel.y;
    const maxYaw = c.maxInducedYawRate;
    if (Math.abs(induced) > maxYaw) {
      const limited = this.preAngvel.y + clamp(induced, -maxYaw, maxYaw);
      this.car.body.setAngvel({ x: av.x, y: limited, z: av.z }, true);
    }

    // --- steering nudge away from the surface -----------------------------
    if (againstStatic && c.wallSteerNudge > 0 && tangentialSpeed > 3) {
      // The surface lies in -normal; steer toward the opposite side. Positive
      // steering is a left turn.
      const wallOnRight = this.carRight().dot(this.normal) < 0;
      this.car.steering.nudge = (wallOnRight ? 1 : -1) * c.wallSteerNudge;
    }

    void dt;
    return tangentialSpeed;
  }

  private carRight(): THREE.Vector3 {
    const r = this.car.body.rotation();
    return new THREE.Vector3(1, 0, 0).applyQuaternion(
      new THREE.Quaternion(r.x, r.y, r.z, r.w),
    );
  }

  private emit(
    magnitude: number,
    point: THREE.Vector3,
    normal: THREE.Vector3,
    againstStatic: boolean,
    tangentialSpeed: number,
  ): void {
    const c = this.params.collision;
    if (magnitude < c.scuffThreshold) return;
    const tier: ImpactTier =
      magnitude >= c.crashThreshold ? 'crash' : magnitude >= c.bumpThreshold ? 'bump' : 'scuff';
    this.onImpact?.({
      tier,
      magnitude,
      point: point.clone(),
      normal: normal.clone(),
      againstStatic,
      tangentialSpeed,
    });
  }

  /**
   * Bias prop impulses away from the racing line so scattered debris tends not
   * to end up exactly where the player needs to drive.
   */
  scatterProps(carPosition: THREE.Vector3): void {
    const bias = this.params.expression.debrisScatterBias;
    if (bias <= 0) return;
    for (const prop of this.props.props) {
      if (!prop.body || prop.frozen || prop.body.isSleeping()) continue;
      const t = prop.body.translation();
      const away = new THREE.Vector3(t.x - carPosition.x, 0, t.z - carPosition.z);
      const d = away.length();
      if (d < 0.5 || d > 6) continue;
      away.normalize().multiplyScalar(bias * prop.body.mass() * 0.6);
      prop.body.applyImpulse({ x: away.x, y: 0, z: away.z }, true);
    }
  }
}

import * as THREE from 'three';
import { clamp } from '../core/math';
import type { Params } from '../core/params';
import type { WheelState } from '../vehicle/car';
import { surfaceDust, surfaceIsLoose } from '../world/surfaces';

/**
 * Dust, gravel spray and impact sparks.
 *
 * Emission rate rides the same continuous slip magnitude the skid marks use,
 * so the two channels always agree about how hard a tyre is working.
 */

const MAX_PARTICLES = 900;

export class Particles {
  readonly points: THREE.Points;
  private positions = new Float32Array(MAX_PARTICLES * 3);
  private colours = new Float32Array(MAX_PARTICLES * 3);
  private velocities = new Float32Array(MAX_PARTICLES * 3);
  private life = new Float32Array(MAX_PARTICLES);
  private maxLife = new Float32Array(MAX_PARTICLES);
  private cursor = 0;
  private geometry = new THREE.BufferGeometry();
  private emitAccumulator = [0, 0, 0, 0];

  constructor(scene: THREE.Scene, private params: Params) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colours, 3));
    this.points = new THREE.Points(
      this.geometry,
      new THREE.PointsMaterial({
        size: 0.35,
        vertexColors: true,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < MAX_PARTICLES; i += 1) this.positions[i * 3 + 1] = -1000;
  }

  private emit(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    colour: THREE.Color,
    lifetime: number,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    this.positions[i * 3 + 0] = position.x;
    this.positions[i * 3 + 1] = position.y;
    this.positions[i * 3 + 2] = position.z;
    this.velocities[i * 3 + 0] = velocity.x;
    this.velocities[i * 3 + 1] = velocity.y;
    this.velocities[i * 3 + 2] = velocity.z;
    this.colours[i * 3 + 0] = colour.r;
    this.colours[i * 3 + 1] = colour.g;
    this.colours[i * 3 + 2] = colour.b;
    this.life[i] = lifetime;
    this.maxLife[i] = lifetime;
  }

  /** Debris burst at an impact point, tinted like sparks. */
  burst(position: THREE.Vector3, count: number, speed: number, colour = 0xffd08a): void {
    const c = new THREE.Color(colour);
    for (let i = 0; i < count; i += 1) {
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * speed,
        Math.random() * speed * 0.6,
        (Math.random() - 0.5) * speed,
      );
      this.emit(position, v, c, 0.25 + Math.random() * 0.35);
    }
  }

  updateWheels(wheels: WheelState[], dt: number): void {
    const p = this.params.expression;
    if (p.dustRate <= 0) return;
    const scratch = new THREE.Vector3();

    wheels.forEach((wheel, i) => {
      if (!wheel.grounded) {
        this.emitAccumulator[i] = 0;
        return;
      }
      const loose = surfaceIsLoose[wheel.surface];
      const slip = wheel.utilisation;
      const threshold = loose ? 0.12 : 0.45;
      if (slip < threshold) {
        this.emitAccumulator[i] = 0;
        return;
      }
      const intensity = clamp(slip - threshold, 0, 1.4);
      const rate = intensity * (loose ? 130 : 45) * p.dustRate;
      this.emitAccumulator[i] += rate * dt;

      const colour = new THREE.Color(surfaceDust[wheel.surface]);
      while (this.emitAccumulator[i] >= 1) {
        this.emitAccumulator[i] -= 1;
        scratch
          .copy(wheel.forward)
          .multiplyScalar(-2 - Math.random() * 4 * intensity)
          .addScaledVector(wheel.right, (Math.random() - 0.5) * 3)
          .add(new THREE.Vector3(0, 1.2 + Math.random() * 1.4, 0));
        this.emit(wheel.contactPoint, scratch, colour, 0.4 + Math.random() * 0.7);
      }
    });
  }

  step(dt: number): void {
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.positions[i * 3 + 1] = -1000;
        continue;
      }
      this.velocities[i * 3 + 1] -= 6 * dt;
      this.positions[i * 3 + 0] += this.velocities[i * 3 + 0] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      this.life[i] = 0;
      this.positions[i * 3 + 1] = -1000;
    }
  }
}

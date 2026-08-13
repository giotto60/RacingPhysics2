import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

/**
 * Binds a Rapier rigid body to a Three.js object and interpolates its
 * transform between physics steps so rendering stays smooth when the render
 * rate and the fixed 120 Hz simulation rate disagree.
 */
export class InterpolatedBody {
  readonly body: RAPIER.RigidBody;
  readonly object: THREE.Object3D;

  private prevPos = new THREE.Vector3();
  private currPos = new THREE.Vector3();
  private prevRot = new THREE.Quaternion();
  private currRot = new THREE.Quaternion();

  constructor(body: RAPIER.RigidBody, object: THREE.Object3D) {
    this.body = body;
    this.object = object;
    this.capture();
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);
  }

  /** Call once per physics step, after the step, to latch the new state. */
  capture(): void {
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);
    const t = this.body.translation();
    const r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currRot.set(r.x, r.y, r.z, r.w);
  }

  /** Call once per rendered frame with the loop's interpolation alpha. */
  apply(alpha: number): void {
    this.object.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.object.quaternion.slerpQuaternions(this.prevRot, this.currRot, alpha);
  }

  /** Interpolated position, for camera targeting. */
  getInterpolatedPosition(alpha: number, out: THREE.Vector3): THREE.Vector3 {
    return out.lerpVectors(this.prevPos, this.currPos, alpha);
  }
}

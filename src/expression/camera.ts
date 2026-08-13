import * as THREE from 'three';
import { angleDelta, clamp, damp } from '../core/math';
import type { Params } from '../core/params';
import type { SceneView } from '../render/scene';

/**
 * Isometric camera rig.
 *
 * In an overhead view the player sees less road ahead than in any other view,
 * so the camera leads the car with speed and pulls back as it rises. The
 * orientation toggle exists because it is an open design question: mode A is
 * classic fixed-world isometric, mode B damps the camera yaw toward the car's
 * heading so "left" stays meaningful when the car is at a high slip angle.
 */
export class ChaseCamera {
  private currentYaw = 0;
  private shake = new THREE.Vector3();
  private shakeDecay = 0;
  private lead = new THREE.Vector3();
  private target = new THREE.Vector3();

  constructor(
    private view: SceneView,
    private params: Params,
  ) {
    this.currentYaw = view.cameraConfig.yaw;
  }

  /** Directional kick matching an impact vector, not a generic rumble. */
  kick(direction: THREE.Vector3, magnitude: number): void {
    this.shake.addScaledVector(direction.clone().normalize(), magnitude);
    this.shakeDecay = 1;
  }

  /**
   * Steering is screen-relative in mode A and car-relative in mode B; the
   * rig's yaw is what makes the difference, so it is returned for the input
   * layer to use.
   */
  get yaw(): number {
    return this.currentYaw;
  }

  update(
    carPosition: THREE.Vector3,
    carVelocity: THREE.Vector3,
    carHeading: number,
    frameDelta: number,
  ): void {
    const c = this.params.camera;
    const speed = carVelocity.length();

    if (c.mode === 'B-follow') {
      const delta = angleDelta(this.currentYaw, carHeading);
      const k = 1 - Math.pow(0.5, frameDelta / Math.max(0.01, c.yawDamping));
      this.currentYaw += delta * k;
      // Keep the accumulated angle bounded so it stays readable in telemetry.
      if (this.currentYaw > Math.PI) this.currentYaw -= Math.PI * 2;
      else if (this.currentYaw < -Math.PI) this.currentYaw += Math.PI * 2;
    } else {
      this.currentYaw = damp(this.currentYaw, Math.PI * 0.25, 0.25, frameDelta);
    }
    this.view.cameraConfig.yaw = this.currentYaw;
    this.view.cameraConfig.pitch = c.pitch;

    // Lead the car by its velocity, capped so a spin does not fling the view.
    const leadTarget = this.lead.set(
      carVelocity.x * c.leadFactor,
      0,
      carVelocity.z * c.leadFactor,
    );
    const maxLead = 22;
    if (leadTarget.length() > maxLead) leadTarget.setLength(maxLead);

    this.target.set(carPosition.x + leadTarget.x, carPosition.y, carPosition.z + leadTarget.z);
    const follow = 1 - Math.pow(0.5, frameDelta / Math.max(0.01, c.followDamping));
    this.view.target.lerp(this.target, clamp(follow, 0, 1));

    this.view.cameraConfig.viewHeight = c.baseViewHeight + speed * c.pullbackFactor;
    this.view.updateProjection();
    this.view.updateCamera();

    if (this.shakeDecay > 0) {
      const amp = this.shakeDecay * this.params.collision.shakeScale;
      const jitter = 0.35;
      this.view.camera.position.x += this.shake.x * amp * (1 + (Math.random() - 0.5) * jitter);
      this.view.camera.position.y += this.shake.y * amp * (1 + (Math.random() - 0.5) * jitter);
      this.view.camera.position.z += this.shake.z * amp * (1 + (Math.random() - 0.5) * jitter);
      this.shakeDecay = Math.max(0, this.shakeDecay - frameDelta * 4.5);
      if (this.shakeDecay === 0) this.shake.set(0, 0, 0);
    }
  }
}

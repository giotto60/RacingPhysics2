import * as THREE from 'three';
import type { Params } from '../core/params';
import type { Car } from './car';
import { InterpolatedBody } from '../render/interpolated';

/**
 * The car's visual representation.
 *
 * Two deliberate lies live here, both of them legibility features rather than
 * decoration: the chassis mesh exaggerates roll and pitch beyond the computed
 * physics so weight transfer is readable from above, and the wheel meshes show
 * the *actual* rack angle and *actual* wheel spin, so the gap between what the
 * driver asked for and what the car is doing is visible.
 */
export class CarView {
  readonly group = new THREE.Group();
  readonly chassisMesh: THREE.Mesh;
  readonly wheelMeshes: THREE.Group[] = [];
  readonly interpolated: InterpolatedBody;

  private baseChassisPositions: Float32Array;
  private chassisGeometry: THREE.BufferGeometry;
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private tmpQuat = new THREE.Quaternion();

  constructor(
    scene: THREE.Scene,
    private car: Car,
    private params: Params,
    colour = 0xd94f3d,
  ) {
    const c = params.chassis;
    // Segmented so the cosmetic dent displacement has vertices to move.
    this.chassisGeometry = new THREE.BoxGeometry(c.hullWidth, c.hullHeight, c.hullLength, 6, 4, 12);
    this.chassisMesh = new THREE.Mesh(
      this.chassisGeometry,
      new THREE.MeshLambertMaterial({ color: colour, flatShading: true }),
    );
    this.chassisMesh.position.y = c.hullOffsetY;
    this.group.add(this.chassisMesh);

    const pos = this.chassisGeometry.getAttribute('position') as THREE.BufferAttribute;
    this.baseChassisPositions = new Float32Array(pos.array as Float32Array);

    // A nose marker: in an isometric view the car's heading must be readable
    // at a glance, especially when it is travelling sideways.
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(c.hullWidth * 0.45, c.hullHeight * 0.4, 0.35),
      new THREE.MeshLambertMaterial({ color: 0xf2e6c8 }),
    );
    nose.position.set(0, c.hullOffsetY + c.hullHeight * 0.35, -c.hullLength * 0.5 + 0.1);
    this.group.add(nose);

    const wheelGeometry = new THREE.CylinderGeometry(
      params.suspension.wheelRadius,
      params.suspension.wheelRadius,
      params.suspension.wheelWidth,
      16,
    );
    wheelGeometry.rotateZ(Math.PI / 2);
    const wheelMaterial = new THREE.MeshLambertMaterial({ color: 0x20242a, flatShading: true });
    const spokeMaterial = new THREE.MeshLambertMaterial({ color: 0xc8ccd2 });

    for (let i = 0; i < 4; i += 1) {
      const wheelGroup = new THREE.Group();
      const spinner = new THREE.Group();
      const mesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
      spinner.add(mesh);
      // A spoke so the wheel's actual rotation rate is visible, including
      // lockup under braking and spin-up on corner exit.
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(params.suspension.wheelWidth * 1.05, 0.06, params.suspension.wheelRadius * 1.7),
        spokeMaterial,
      );
      spinner.add(spoke);
      wheelGroup.add(spinner);
      wheelGroup.userData.spinner = spinner;
      this.group.add(wheelGroup);
      this.wheelMeshes.push(wheelGroup);
    }

    scene.add(this.group);
    this.interpolated = new InterpolatedBody(car.body, this.group);
  }

  capture(): void {
    this.interpolated.capture();
  }

  /** Rebuild the chassis mesh after a hull dimension changes. */
  rebuildHull(): void {
    const c = this.params.chassis;
    const next = new THREE.BoxGeometry(c.hullWidth, c.hullHeight, c.hullLength, 6, 4, 12);
    this.chassisMesh.geometry.dispose();
    this.chassisMesh.geometry = next;
    this.chassisGeometry = next;
    this.chassisMesh.position.y = c.hullOffsetY;
    const pos = next.getAttribute('position') as THREE.BufferAttribute;
    this.baseChassisPositions = new Float32Array(pos.array as Float32Array);
  }

  /**
   * Cosmetic deformation. Purely visual: no handling effect, but it is the
   * cheapest possible signal that impacts have persistent consequence.
   */
  dent(worldPoint: THREE.Vector3, worldDirection: THREE.Vector3, strength: number): void {
    const scale = this.params.expression.deformation;
    if (scale <= 0) return;
    const local = this.group.worldToLocal(worldPoint.clone());
    local.y -= this.params.chassis.hullOffsetY;
    const dir = worldDirection.clone().normalize();
    this.group.getWorldQuaternion(this.tmpQuat);
    dir.applyQuaternion(this.tmpQuat.invert());

    const attr = this.chassisGeometry.getAttribute('position') as THREE.BufferAttribute;
    const array = attr.array as Float32Array;
    const radius = 1.1;
    const depth = Math.min(0.22, strength * 0.22) * scale;
    const v = new THREE.Vector3();
    for (let i = 0; i < array.length; i += 3) {
      v.set(array[i], array[i + 1], array[i + 2]);
      const d = v.distanceTo(local);
      if (d > radius) continue;
      const falloff = 1 - d / radius;
      array[i] += dir.x * depth * falloff;
      array[i + 1] += dir.y * depth * falloff;
      array[i + 2] += dir.z * depth * falloff;
    }
    attr.needsUpdate = true;
    this.chassisGeometry.computeVertexNormals();
  }

  resetDeformation(): void {
    const attr = this.chassisGeometry.getAttribute('position') as THREE.BufferAttribute;
    (attr.array as Float32Array).set(this.baseChassisPositions);
    attr.needsUpdate = true;
    this.chassisGeometry.computeVertexNormals();
  }

  update(alpha: number): void {
    this.interpolated.apply(alpha);

    // Exaggerate roll and pitch about the physics yaw. The simulation stays
    // honest; only the mesh leans further than the body actually does.
    const e = this.params.expression;
    if (e.visualRollMultiplier !== 1 || e.visualPitchMultiplier !== 1) {
      this.euler.setFromQuaternion(this.group.quaternion, 'YXZ');
      this.euler.x *= e.visualPitchMultiplier;
      this.euler.z *= e.visualRollMultiplier;
      this.group.quaternion.setFromEuler(this.euler);
    }

    const s = this.params.suspension;
    this.car.wheels.forEach((wheel, i) => {
      const meshGroup = this.wheelMeshes[i];
      const drop = wheel.grounded ? s.restLength - wheel.compression : s.restLength;
      meshGroup.position.set(wheel.hardpoint.x, wheel.hardpoint.y - drop, wheel.hardpoint.z);
      meshGroup.rotation.set(0, wheel.steerAngle, 0);
      const spinner = meshGroup.userData.spinner as THREE.Group;
      spinner.rotation.x = -wheel.spin;
    });
  }
}

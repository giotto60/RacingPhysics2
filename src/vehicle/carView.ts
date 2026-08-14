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

  private headlights: THREE.SpotLight[] = [];
  private headlightLenses: THREE.MeshPhongMaterial[] = [];
  private brakeLights: THREE.MeshPhongMaterial[] = [];
  private reverseLights: THREE.MeshPhongMaterial[] = [];

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
      new THREE.MeshPhongMaterial({
        color: colour,
        flatShading: true,
        shininess: 30,
        specular: 0x2a2f34,
      }),
    );
    this.chassisMesh.position.y = c.hullOffsetY;
    this.group.add(this.chassisMesh);

    const pos = this.chassisGeometry.getAttribute('position') as THREE.BufferAttribute;
    this.baseChassisPositions = new Float32Array(pos.array as Float32Array);

    // A nose marker: in an isometric view the car's heading must be readable
    // at a glance, especially when it is travelling sideways.
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(c.hullWidth * 0.45, c.hullHeight * 0.4, 0.35),
      new THREE.MeshPhongMaterial({ color: 0xf2e6c8 }),
    );
    nose.position.set(0, c.hullOffsetY + c.hullHeight * 0.35, -c.hullLength * 0.5 + 0.1);
    this.group.add(nose);

    this.buildLights();

    const wheelGeometry = new THREE.CylinderGeometry(
      params.suspension.wheelRadius,
      params.suspension.wheelRadius,
      params.suspension.wheelWidth,
      16,
    );
    wheelGeometry.rotateZ(Math.PI / 2);
    const wheelMaterial = new THREE.MeshPhongMaterial({ color: 0x20242a, flatShading: true });
    const spokeMaterial = new THREE.MeshPhongMaterial({ color: 0xc8ccd2 });

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

  /**
   * Headlights, brake lights and reverse lights.
   *
   * The headlights are real lights rather than glowing decals: from an
   * overhead camera the pool of light on the road ahead is the only cue that
   * says which way the car is pointing when it is travelling sideways.
   */
  private buildLights(): void {
    const c = this.params.chassis;
    const front = -c.hullLength * 0.5;
    const rear = c.hullLength * 0.5;
    const y = c.hullOffsetY + c.hullHeight * 0.05;

    for (const side of [-1, 1]) {
      const lens = new THREE.MeshPhongMaterial({
        color: 0xfff4d8,
        emissive: 0xfff0c8,
        emissiveIntensity: 1,
      });
      const lensMesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.1), lens);
      lensMesh.position.set(side * c.hullWidth * 0.32, y + 0.1, front + 0.03);
      this.group.add(lensMesh);
      this.headlightLenses.push(lens);

      // A shallow decay keeps the beam readable all the way out to its range
      // instead of blowing out into a small white puddle by the front bumper.
      const light = new THREE.SpotLight(0xfff1d2, 7, 46, 0.36, 0.6, 0.55);
      light.position.set(side * c.hullWidth * 0.32, y + 0.1, front);
      const target = new THREE.Object3D();
      target.position.set(side * c.hullWidth * 1.1, -2.2, front - 34);
      this.group.add(target);
      light.target = target;
      this.group.add(light);
      this.headlights.push(light);

      const brake = new THREE.MeshPhongMaterial({
        color: 0x8c1a12,
        emissive: 0xff2a14,
        emissiveIntensity: 0.12,
      });
      const brakeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.08), brake);
      brakeMesh.position.set(side * c.hullWidth * 0.3, y + 0.14, rear - 0.02);
      this.group.add(brakeMesh);
      this.brakeLights.push(brake);

      const reverse = new THREE.MeshPhongMaterial({
        color: 0x9aa2ab,
        emissive: 0xf2f6ff,
        emissiveIntensity: 0,
      });
      const reverseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.08), reverse);
      reverseMesh.position.set(side * c.hullWidth * 0.12, y + 0.14, rear - 0.02);
      this.group.add(reverseMesh);
      this.reverseLights.push(reverse);
    }
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

    this.updateLights();

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

  private updateLights(): void {
    const e = this.params.expression;
    const on = e.headlights;
    for (const light of this.headlights) {
      light.visible = on;
      light.intensity = 7 * e.headlightIntensity;
      light.distance = e.headlightRange;
    }
    for (const lens of this.headlightLenses) lens.emissiveIntensity = on ? 1 : 0.05;

    const braking = this.car.brakeInput > 0.02;
    for (const brake of this.brakeLights) {
      brake.emissiveIntensity = braking ? 1.2 : on ? 0.28 : 0.08;
    }
    const reversing = this.car.drivetrain.gear < 0;
    for (const reverse of this.reverseLights) reverse.emissiveIntensity = reversing ? 1.2 : 0;
  }
}

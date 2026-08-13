import * as THREE from 'three';
import type { Car } from '../vehicle/car';

/**
 * Debug draw: suspension rays with compression, per-wheel force vectors,
 * contact patches, the centre of mass and the velocity vector. Combined with
 * slow motion this is how collision feel actually gets diagnosed.
 */
const MAX_LINES = 256;

export class DebugDraw {
  readonly lines: THREE.LineSegments;
  visible = false;

  private positions = new Float32Array(MAX_LINES * 2 * 3);
  private colours = new Float32Array(MAX_LINES * 2 * 3);
  private geometry = new THREE.BufferGeometry();
  private cursor = 0;

  private contacts: THREE.Points;
  private contactPositions = new Float32Array(64 * 3);
  private contactGeometry = new THREE.BufferGeometry();
  private contactCursor = 0;

  constructor(scene: THREE.Scene) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colours, 3));
    this.lines = new THREE.LineSegments(
      this.geometry,
      new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }),
    );
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.lines.renderOrder = 10;
    scene.add(this.lines);

    this.contactGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.contactPositions, 3),
    );
    this.contacts = new THREE.Points(
      this.contactGeometry,
      new THREE.PointsMaterial({ color: 0xff5a3c, size: 0.5, depthTest: false }),
    );
    this.contacts.frustumCulled = false;
    this.contacts.visible = false;
    scene.add(this.contacts);
    for (let i = 0; i < 64; i += 1) this.contactPositions[i * 3 + 1] = -1000;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.lines.visible = this.visible;
    this.contacts.visible = this.visible;
  }

  /** Record a solver contact point so impact locations stay visible. */
  markContact(point: THREE.Vector3): void {
    const i = this.contactCursor;
    this.contactCursor = (this.contactCursor + 1) % 64;
    this.contactPositions[i * 3 + 0] = point.x;
    this.contactPositions[i * 3 + 1] = point.y;
    this.contactPositions[i * 3 + 2] = point.z;
    (this.contactGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  private line(from: THREE.Vector3, to: THREE.Vector3, colour: THREE.Color): void {
    if (this.cursor >= MAX_LINES) return;
    const i = this.cursor * 6;
    this.positions[i + 0] = from.x;
    this.positions[i + 1] = from.y;
    this.positions[i + 2] = from.z;
    this.positions[i + 3] = to.x;
    this.positions[i + 4] = to.y;
    this.positions[i + 5] = to.z;
    for (let k = 0; k < 2; k += 1) {
      this.colours[i + k * 3 + 0] = colour.r;
      this.colours[i + k * 3 + 1] = colour.g;
      this.colours[i + k * 3 + 2] = colour.b;
    }
    this.cursor += 1;
  }

  update(car: Car): void {
    if (!this.visible) return;
    this.cursor = 0;

    const forceScale = 1 / 4000;
    const spring = new THREE.Color(0x4fa3d9);
    const lateral = new THREE.Color(0xe2604a);
    const longitudinal = new THREE.Color(0x5fc27e);
    const ray = new THREE.Color(0xf2b134);
    const velocityColour = new THREE.Color(0xffffff);
    const comColour = new THREE.Color(0xd94fd9);

    const tmp = new THREE.Vector3();
    const t = car.body.translation();
    const r = car.body.rotation();
    const bodyQuat = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const bodyPos = new THREE.Vector3(t.x, t.y, t.z);
    const hardpointWorld = new THREE.Vector3();

    for (const wheel of car.wheels) {
      hardpointWorld.copy(wheel.hardpoint).applyQuaternion(bodyQuat).add(bodyPos);

      // Suspension ray, brightening with compression.
      const compressionColour = ray.clone().lerp(new THREE.Color(0xffffff), wheel.compression * 3);
      this.line(hardpointWorld, wheel.contactPoint, compressionColour);

      if (!wheel.grounded) continue;
      this.line(
        wheel.contactPoint,
        tmp.copy(wheel.contactPoint).addScaledVector(wheel.springForce, forceScale),
        spring,
      );
      this.line(
        wheel.contactPoint,
        tmp.copy(wheel.contactPoint).addScaledVector(wheel.lateralForce, forceScale),
        lateral,
      );
      this.line(
        wheel.contactPoint,
        tmp.copy(wheel.contactPoint).addScaledVector(wheel.longitudinalForce, forceScale),
        longitudinal,
      );
    }

    const com = car.body.worldCom();
    const comVec = new THREE.Vector3(com.x, com.y, com.z);
    this.line(comVec, tmp.copy(comVec).add(new THREE.Vector3(0, 1.2, 0)), comColour);

    const lv = car.body.linvel();
    this.line(
      comVec,
      tmp.copy(comVec).add(new THREE.Vector3(lv.x * 0.25, lv.y * 0.25, lv.z * 0.25)),
      velocityColour,
    );

    for (let i = this.cursor; i < MAX_LINES; i += 1) {
      const idx = i * 6;
      this.positions[idx + 0] = 0;
      this.positions[idx + 1] = -1000;
      this.positions[idx + 2] = 0;
      this.positions[idx + 3] = 0;
      this.positions[idx + 4] = -1000;
      this.positions[idx + 5] = 0;
    }
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}

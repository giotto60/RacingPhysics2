import * as THREE from 'three';
import { clamp } from '../core/math';
import type { Params } from '../core/params';
import type { WheelState } from '../vehicle/car';
import { surfaceIsLoose } from '../world/surfaces';

/**
 * Skid marks.
 *
 * Driven by the continuous combined-slip magnitude per wheel, never by a
 * boolean "is drifting" flag: slip maps continuously to opacity, so the decal
 * is a readout of how hard the tyre is working rather than an on/off effect.
 * This is the primary grip-state readout in an isometric view.
 */

const MAX_SEGMENTS = 6000;
/** Minimum distance between decal segments, squared. */
const MIN_SEGMENT_SQ = 0.12 * 0.12;

export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private geometry = new THREE.BufferGeometry();
  private positions = new Float32Array(MAX_SEGMENTS * 4 * 3);
  private colours = new Float32Array(MAX_SEGMENTS * 4 * 4);
  private indices = new Uint32Array(MAX_SEGMENTS * 6);
  private cursor = 0;
  private count = 0;
  private lastPoint: (THREE.Vector3 | null)[] = [null, null, null, null];

  constructor(scene: THREE.Scene, private params: Params) {
    for (let i = 0; i < MAX_SEGMENTS; i += 1) {
      const v = i * 4;
      const t = i * 6;
      // Wound so the decal faces up. A ground decal that faces down is
      // invisible from an overhead camera and looks like it was never laid.
      this.indices[t + 0] = v + 0;
      this.indices[t + 1] = v + 2;
      this.indices[t + 2] = v + 1;
      this.indices[t + 3] = v + 2;
      this.indices[t + 4] = v + 3;
      this.indices[t + 5] = v + 1;
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colours, 4));
    this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));
    this.geometry.setDrawRange(0, 0);

    this.mesh = new THREE.Mesh(
      this.geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      }),
    );
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  clear(): void {
    this.cursor = 0;
    this.count = 0;
    this.lastPoint = [null, null, null, null];
    this.geometry.setDrawRange(0, 0);
  }

  update(wheels: WheelState[]): void {
    const p = this.params.expression;
    const halfWidth = this.params.suspension.wheelWidth * 0.6;

    wheels.forEach((wheel, i) => {
      const laysRubber = wheel.grounded && !surfaceIsLoose[wheel.surface];
      const slip = wheel.utilisation;
      if (!laysRubber || slip < p.skidThreshold) {
        this.lastPoint[i] = null;
        return;
      }

      const current = wheel.contactPoint.clone();
      current.y += 0.02;
      const previous = this.lastPoint[i];
      if (!previous) {
        this.lastPoint[i] = current;
        return;
      }
      // The anchor only moves when a segment is actually emitted, so short
      // steps accumulate into one segment instead of cancelling each other.
      if (previous.distanceToSquared(current) < MIN_SEGMENT_SQ) return;
      this.lastPoint[i] = current;

      const dir = current.clone().sub(previous).normalize();
      const side = new THREE.Vector3(0, 1, 0).cross(dir).multiplyScalar(halfWidth);

      // Opacity and colour both ride the continuous slip magnitude: a tyre
      // just past the threshold leaves a faint grey line, a fully saturated
      // one leaves solid black. The floor is high enough that a light scuff
      // is still readable against dark tarmac.
      const t = clamp((slip - p.skidThreshold) / Math.max(0.05, 1.2 - p.skidThreshold), 0, 1);
      const alpha = (0.3 + 0.7 * t) * p.skidOpacity;
      const shade = 0.12 - t * 0.1;

      this.pushQuad(previous, current, side, shade, alpha);
    });

    this.geometry.setDrawRange(0, this.count * 6);
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  private pushQuad(
    from: THREE.Vector3,
    to: THREE.Vector3,
    side: THREE.Vector3,
    shade: number,
    alpha: number,
  ): void {
    const v = this.cursor * 4;
    const write = (index: number, x: number, y: number, z: number): void => {
      this.positions[index * 3 + 0] = x;
      this.positions[index * 3 + 1] = y;
      this.positions[index * 3 + 2] = z;
      this.colours[index * 4 + 0] = shade;
      this.colours[index * 4 + 1] = shade;
      this.colours[index * 4 + 2] = shade;
      this.colours[index * 4 + 3] = alpha;
    };
    write(v + 0, from.x - side.x, from.y, from.z - side.z);
    write(v + 1, from.x + side.x, from.y, from.z + side.z);
    write(v + 2, to.x - side.x, to.y, to.z - side.z);
    write(v + 3, to.x + side.x, to.y, to.z + side.z);

    this.cursor = (this.cursor + 1) % MAX_SEGMENTS;
    this.count = Math.min(this.count + 1, MAX_SEGMENTS);
  }
}

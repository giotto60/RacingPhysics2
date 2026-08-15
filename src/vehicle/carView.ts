import * as THREE from 'three';
import { clamp } from '../core/math';
import type { Params } from '../core/params';
import type { Car } from './car';
import { InterpolatedBody } from '../render/interpolated';
import { repaint } from './tint';
import {
  CAR_MODELS,
  instantiate,
  loadCarModel,
  modelById,
  type CarModelDef,
  type LoadedCarModel,
} from './models';

/**
 * The car's visual representation.
 *
 * Two deliberate lies live here, both of them legibility features rather than
 * decoration: the chassis mesh exaggerates roll and pitch beyond the computed
 * physics so weight transfer is readable from above, and the wheel meshes show
 * the *actual* rack angle and *actual* wheel spin, so the gap between what the
 * driver asked for and what the car is doing is visible.
 *
 * The body itself is swappable. Whichever model is picked, it is scaled to fill
 * the hull box exactly and its wheels are drawn at the suspension's hardpoints,
 * so the thing on screen is the thing being simulated rather than a decoration
 * sitting near it.
 */

interface Deformable {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  base: Float32Array;
}

export class CarView {
  readonly group = new THREE.Group();
  readonly wheelMeshes: THREE.Group[] = [];
  readonly interpolated: InterpolatedBody;

  /** Fires when the drawn body's box changes, so the collider can follow it. */
  onHullChanged: (() => void) | null = null;

  private bodyRoot = new THREE.Group();
  private deformable: Deformable[] = [];
  private blockWheelGeometry: THREE.CylinderGeometry | null = null;
  private lightRig = new THREE.Group();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private tmpQuat = new THREE.Quaternion();
  private up = new THREE.Vector3();

  private headlights: THREE.SpotLight[] = [];
  private headlightLenses: THREE.MeshPhongMaterial[] = [];
  private brakeLights: THREE.MeshPhongMaterial[] = [];
  private reverseLights: THREE.MeshPhongMaterial[] = [];

  private model: CarModelDef = CAR_MODELS[0];
  private loaded: LoadedCarModel | null = null;
  /** Guards against a slow load landing after the player has picked again. */
  private loadToken = 0;

  /** Hue rotation applied to this car's paint, degrees. 0 leaves it alone. */
  hueShift = 0;

  constructor(
    scene: THREE.Scene,
    private car: Car,
    private params: Params,
    private colour = 0xd94f3d,
  ) {
    this.group.add(this.bodyRoot);
    this.group.add(this.lightRig);
    this.buildLights();
    this.buildWheelGroups();
    this.buildBlocks();
    this.buildBlockWheels();

    scene.add(this.group);
    this.interpolated = new InterpolatedBody(car.body, this.group);
  }

  // --- model selection ------------------------------------------------------

  get modelId(): string {
    return this.model.id;
  }

  /**
   * Swap the drawn car. The load is asynchronous and the old body stays on
   * screen until the new one is ready, so picking through the list never leaves
   * an empty road.
   */
  async setModel(id: string): Promise<void> {
    const def = modelById(id);
    const token = (this.loadToken += 1);
    if (def.file === null) {
      this.model = def;
      this.loaded = null;
      this.buildBlocks();
      this.applyWheels();
      this.params.expression.carModel = def.id;
      this.onHullChanged?.();
      return;
    }
    let loaded: LoadedCarModel;
    try {
      loaded = await loadCarModel(def, import.meta.env.BASE_URL);
    } catch (err) {
      console.error(`car model "${def.id}" failed to load`, err);
      if (token === this.loadToken) await this.setModel('blocks');
      return;
    }
    if (token !== this.loadToken) return; // a later pick already won
    this.model = def;
    this.loaded = loaded;
    this.buildFromModel(loaded);
    this.applyWheels();
    // Kept in step even when a load failed and dropped back to the box, so the
    // picker never claims to be showing something it is not.
    this.params.expression.carModel = def.id;
    this.onHullChanged?.();
  }

  // --- body construction ----------------------------------------------------

  private clearBody(): void {
    for (const child of [...this.bodyRoot.children]) this.bodyRoot.remove(child);
    for (const entry of this.deformable) entry.geometry.dispose();
    this.deformable = [];
  }

  private trackDeformable(root: THREE.Object3D): void {
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      this.deformable.push({
        mesh,
        geometry: mesh.geometry,
        base: new Float32Array(attr.array as Float32Array),
      });
    });
  }

  /** The built-in box: no model, and the shape the collider was authored as. */
  private buildBlocks(): void {
    this.clearBody();
    const c = this.params.chassis;
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(c.hullWidth, c.hullHeight, c.hullLength, 6, 4, 12),
      new THREE.MeshPhongMaterial({
        color: this.colour,
        flatShading: true,
        shininess: 30,
        specular: 0x2a2f34,
      }),
    );
    hull.position.y = c.hullOffsetY;
    this.bodyRoot.add(hull);

    // A nose marker: with no model to give the car a recognisable shape, the
    // heading has to be readable at a glance, especially when it is travelling
    // sideways.
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(c.hullWidth * 0.45, c.hullHeight * 0.4, 0.35),
      new THREE.MeshPhongMaterial({ color: 0xf2e6c8 }),
    );
    nose.position.set(0, c.hullOffsetY + c.hullHeight * 0.35, -c.hullLength * 0.5 + 0.1);
    this.bodyRoot.add(nose);

    this.trackDeformable(this.bodyRoot);
    this.placeLights();
  }

  private buildFromModel(loaded: LoadedCarModel): void {
    this.clearBody();
    const copy = instantiate(loaded);
    const c = this.params.chassis;
    const size = loaded.bodyBox.getSize(new THREE.Vector3());
    const centre = loaded.bodyBox.getCenter(new THREE.Vector3());

    // Fill the hull box exactly: what is drawn and what the car collides with
    // are then the same object, whatever the model's own proportions were.
    const scale = new THREE.Vector3(
      c.hullWidth / Math.max(1e-3, size.x),
      c.hullHeight / Math.max(1e-3, size.y),
      c.hullLength / Math.max(1e-3, size.z),
    );
    const holder = new THREE.Group();
    holder.add(copy.body);
    holder.scale.copy(scale);
    holder.position.set(
      -centre.x * scale.x,
      c.hullOffsetY - centre.y * scale.y,
      -centre.z * scale.z,
    );
    repaint(holder, this.hueShift, this.colour);
    this.bodyRoot.add(holder);
    this.trackDeformable(holder);
    this.placeLights();
  }

  // --- wheels ---------------------------------------------------------------

  private buildWheelGroups(): void {
    for (let i = 0; i < 4; i += 1) {
      const wheelGroup = new THREE.Group();
      const spinner = new THREE.Group();
      wheelGroup.add(spinner);
      wheelGroup.userData.spinner = spinner;
      this.group.add(wheelGroup);
      this.wheelMeshes.push(wheelGroup);
    }
  }

  private clearWheels(): void {
    for (const wheelGroup of this.wheelMeshes) {
      const spinner = wheelGroup.userData.spinner as THREE.Group;
      for (const child of [...spinner.children]) spinner.remove(child);
    }
  }

  /** Rebuild the wheels for whatever model is current, after a geometry change. */
  applyWheels(): void {
    if (this.loaded) this.buildModelWheels(this.loaded);
    else this.buildBlockWheels();
  }

  private buildBlockWheels(): void {
    this.clearWheels();
    const s = this.params.suspension;
    this.blockWheelGeometry?.dispose();
    const wheelGeometry = new THREE.CylinderGeometry(s.wheelRadius, s.wheelRadius, s.wheelWidth, 16);
    wheelGeometry.rotateZ(Math.PI / 2);
    this.blockWheelGeometry = wheelGeometry;
    const wheelMaterial = new THREE.MeshPhongMaterial({ color: 0x20242a, flatShading: true });
    const spokeMaterial = new THREE.MeshPhongMaterial({ color: 0xc8ccd2 });

    for (const wheelGroup of this.wheelMeshes) {
      const spinner = wheelGroup.userData.spinner as THREE.Group;
      const mesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
      mesh.castShadow = true;
      spinner.add(mesh);
      // A spoke so the wheel's actual rotation rate is visible, including
      // lockup under braking and spin-up on corner exit.
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(s.wheelWidth * 1.05, 0.06, s.wheelRadius * 1.7),
        spokeMaterial,
      );
      spinner.add(spoke);
    }
  }

  /**
   * A model's own wheels, scaled to the simulated wheel and hung on the
   * suspension. A model without separable wheels keeps the built-in ones, which
   * still spin and steer, rather than being drawn without any.
   */
  private buildModelWheels(loaded: LoadedCarModel): void {
    if (loaded.wheelRadius <= 0 || loaded.wheels.some((w) => w === null)) {
      this.buildBlockWheels();
      return;
    }
    const wheels = instantiate(loaded).wheels;
    for (const wheel of wheels) if (wheel) repaint(wheel, this.hueShift, this.colour);
    this.clearWheels();
    const scale = this.params.suspension.wheelRadius / loaded.wheelRadius;
    this.wheelMeshes.forEach((wheelGroup, i) => {
      const spinner = wheelGroup.userData.spinner as THREE.Group;
      const wheel = wheels[i]!;
      wheel.scale.multiplyScalar(scale);
      wheel.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) mesh.castShadow = true;
      });
      spinner.add(wheel);
    });
  }

  // --- lights ---------------------------------------------------------------

  /**
   * Headlights, brake lights and reverse lights.
   *
   * The headlights are real lights rather than glowing decals: from an
   * overhead camera the pool of light on the road ahead is the only cue that
   * says which way the car is pointing when it is travelling sideways.
   */
  private buildLights(): void {
    for (const side of [-1, 1]) {
      const lens = new THREE.MeshPhongMaterial({
        color: 0xfff4d8,
        emissive: 0xfff0c8,
        emissiveIntensity: 1,
      });
      const lensMesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.1), lens);
      lensMesh.userData.role = 'headlight';
      lensMesh.userData.side = side;
      this.lightRig.add(lensMesh);
      this.headlightLenses.push(lens);

      // A shallow decay keeps the beam readable all the way out to its range
      // instead of blowing out into a small white puddle by the front bumper.
      const light = new THREE.SpotLight(0xfff1d2, 7, 46, 0.36, 0.6, 0.55);
      // A beam that shines through a wall or a parked car reads as painted-on
      // light rather than as a headlight, so the beam is occluded properly.
      light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.bias = -0.001;
      light.shadow.normalBias = 0.05;
      light.shadow.camera.near = 0.4;
      light.shadow.camera.far = 46;
      light.userData.side = side;
      const target = new THREE.Object3D();
      target.userData.side = side;
      this.lightRig.add(target);
      light.target = target;
      this.lightRig.add(light);
      this.headlights.push(light);

      const brake = new THREE.MeshPhongMaterial({
        color: 0x8c1a12,
        emissive: 0xff2a14,
        emissiveIntensity: 0.12,
      });
      const brakeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.08), brake);
      brakeMesh.userData.role = 'brake';
      brakeMesh.userData.side = side;
      this.lightRig.add(brakeMesh);
      this.brakeLights.push(brake);

      const reverse = new THREE.MeshPhongMaterial({
        color: 0x9aa2ab,
        emissive: 0xf2f6ff,
        emissiveIntensity: 0,
      });
      const reverseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.08), reverse);
      reverseMesh.userData.role = 'reverse';
      reverseMesh.userData.side = side;
      this.lightRig.add(reverseMesh);
      this.reverseLights.push(reverse);
    }
  }

  /** Hang the lamps off the corners of whatever body is currently drawn. */
  private placeLights(): void {
    const c = this.params.chassis;
    const front = -c.hullLength * 0.5;
    const rear = c.hullLength * 0.5;
    // Bumper height on whatever body is drawn, rather than a fixed offset that
    // would put the lamps on the roof of a low car and under the sill of a van.
    const lampY = c.hullOffsetY - c.hullHeight * 0.5 + Math.min(0.55, c.hullHeight * 0.34);

    for (const node of this.lightRig.children) {
      const side = (node.userData.side as number) ?? 1;
      switch (node.userData.role) {
        case 'headlight':
          node.position.set(side * c.hullWidth * 0.32, lampY, front + 0.07);
          break;
        case 'brake':
          node.position.set(side * c.hullWidth * 0.3, lampY + 0.04, rear - 0.06);
          break;
        case 'reverse':
          node.position.set(side * c.hullWidth * 0.12, lampY + 0.04, rear - 0.06);
          break;
        default:
          if ((node as THREE.SpotLight).isSpotLight) {
            node.position.set(side * c.hullWidth * 0.32, lampY, front);
          } else {
            // the spotlight's aim point
            node.position.set(side * c.hullWidth * 1.1, lampY - 2.3, front - 34);
          }
          break;
      }
    }
  }

  capture(): void {
    this.interpolated.capture();
  }

  /** Re-fit the drawn body after a hull dimension changes. */
  applyHull(): void {
    if (this.loaded) this.buildFromModel(this.loaded);
    else this.buildBlocks();
  }

  /**
   * Cosmetic deformation. Purely visual: no handling effect, but it is the
   * cheapest possible signal that impacts have persistent consequence.
   */
  dent(worldPoint: THREE.Vector3, worldDirection: THREE.Vector3, strength: number): void {
    const scale = this.params.expression.deformation;
    if (scale <= 0 || this.deformable.length === 0) return;
    const dir = worldDirection.clone().normalize();
    this.group.getWorldQuaternion(this.tmpQuat);
    dir.applyQuaternion(this.tmpQuat.invert());

    const worldRadius = 1.1;
    const worldDepth = Math.min(0.22, strength * 0.22) * scale;
    const local = new THREE.Vector3();
    const worldScale = new THREE.Vector3();
    const inverse = new THREE.Matrix4();
    const v = new THREE.Vector3();
    for (const entry of this.deformable) {
      // The dent is measured in world metres, so it has to come back through
      // whatever scaling the model was fitted with to reach these vertices.
      entry.mesh.updateMatrixWorld(true);
      entry.mesh.getWorldScale(worldScale);
      const shrink = Math.max(1e-4, (worldScale.x + worldScale.y + worldScale.z) / 3);
      const radius = worldRadius / shrink;
      const depth = worldDepth / shrink;
      inverse.copy(entry.mesh.matrixWorld).invert();
      local.copy(worldPoint).applyMatrix4(inverse);

      const attr = entry.geometry.getAttribute('position') as THREE.BufferAttribute;
      const array = attr.array as Float32Array;
      let touched = false;
      for (let i = 0; i < array.length; i += 3) {
        v.set(array[i], array[i + 1], array[i + 2]);
        const d = v.distanceTo(local);
        if (d > radius) continue;
        const falloff = 1 - d / radius;
        array[i] += dir.x * depth * falloff;
        array[i + 1] += dir.y * depth * falloff;
        array[i + 2] += dir.z * depth * falloff;
        touched = true;
      }
      if (touched) {
        attr.needsUpdate = true;
        entry.geometry.computeVertexNormals();
      }
    }
  }

  resetDeformation(): void {
    for (const entry of this.deformable) {
      const attr = entry.geometry.getAttribute('position') as THREE.BufferAttribute;
      (attr.array as Float32Array).set(entry.base);
      attr.needsUpdate = true;
      entry.geometry.computeVertexNormals();
    }
  }

  update(alpha: number): void {
    this.interpolated.apply(alpha);

    // Exaggerate roll and pitch about the physics yaw. The simulation stays
    // honest; only the mesh leans further than the body actually does.
    //
    // The exaggeration has to fade out as the car leaves upright. Scaling a
    // roll angle works while the car is on its wheels, but an inverted car
    // decomposes to roughly 180 degrees, and 180 x 1.75 is a completely
    // different orientation -- which is why an upside-down car used to hover
    // over the road at an angle instead of resting on its roof.
    const e = this.params.expression;
    if (e.visualRollMultiplier !== 1 || e.visualPitchMultiplier !== 1) {
      this.up.set(0, 1, 0).applyQuaternion(this.group.quaternion);
      const upright = clamp((this.up.y - 0.35) / 0.4, 0, 1);
      if (upright > 0) {
        this.euler.setFromQuaternion(this.group.quaternion, 'YXZ');
        this.euler.x += this.euler.x * (e.visualPitchMultiplier - 1) * upright;
        this.euler.z += this.euler.z * (e.visualRollMultiplier - 1) * upright;
        this.group.quaternion.setFromEuler(this.euler);
      }
    }

    this.updateLights();

    const s = this.params.suspension;
    this.car.wheels.forEach((wheel, i) => {
      const meshGroup = this.wheelMeshes[i];
      // Over-travel counts against the drop as well as compression: when the
      // suspension has bottomed out the ground is above where the arch can
      // take the wheel, and drawing it at full bump buries it in the road.
      const drop = wheel.grounded
        ? s.restLength - wheel.compression - wheel.overTravel
        : s.restLength;
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
      light.castShadow = on && e.headlightShadows;
      if (light.shadow.camera.far !== e.headlightRange) {
        light.shadow.camera.far = e.headlightRange;
        light.shadow.camera.updateProjectionMatrix();
      }
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

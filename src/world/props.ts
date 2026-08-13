import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Params } from '../core/params';
import type { PhysicsWorld } from '../physics/world';
import {
  applyMaterial,
  interactionGroups,
  CAR_GROUP,
  PROP_GROUP,
  STATIC_GROUP,
  DEBRIS_GROUP,
  type MaterialName,
} from '../physics/materials';
import { InterpolatedBody } from '../render/interpolated';
import { registerSurface } from './surfaces';

/**
 * Props and their response classes.
 *
 * The mass ladder between classes is the important design lever -- players
 * read collision realism almost entirely through whether the speed penalty
 * matches the apparent size of what was hit, so there is roughly an order of
 * magnitude between adjacent classes.
 *
 * Inertia tensors are authored per prop type rather than derived from collider
 * bounds. The *character* of a tumble comes from the ratio between the three
 * principal moments: a cone has almost no inertia and a high centre of gravity
 * so it flips end over end; a tyre stack carries its mass at radius so it
 * topples slowly then rolls; a barrier has enormous inertia about its short
 * axes so it pivots and slides.
 */

export type PropClass = 'A' | 'B' | 'C' | 'D';

export type PropKind =
  | 'cone'
  | 'sign'
  | 'barrel'
  | 'tyreStack'
  | 'crate'
  | 'barrier'
  | 'dumpster'
  | 'wall'
  | 'dummyCar';

export interface PropDefinition {
  kind: PropKind;
  propClass: PropClass;
  /** Half extents for boxes, or radius/height for cylinders. */
  size: THREE.Vector3;
  shape: 'box' | 'cylinder' | 'cone';
  material: MaterialName;
  colour: number;
  /** Principal moments, authored. Scaled with mass when mass is tuned. */
  inertia: THREE.Vector3;
  /** Centre of mass offset -- a cone's is high, which is why it topples. */
  com: THREE.Vector3;
  massOf: (p: Params) => number;
  restitutionOf: (p: Params) => number;
}

/** Class colour coding, so the user knows which mass class they just hit. */
export const CLASS_COLOUR: Record<PropClass, number> = {
  A: 0xf2b134,
  B: 0x4fa3d9,
  C: 0x9a6ad9,
  D: 0x8d9299,
};

export const PROP_DEFS: Record<PropKind, PropDefinition> = {
  cone: {
    kind: 'cone',
    propClass: 'A',
    size: new THREE.Vector3(0.22, 0.35, 0.22),
    shape: 'cone',
    material: 'plastic',
    colour: CLASS_COLOUR.A,
    inertia: new THREE.Vector3(0.1, 0.02, 0.1),
    com: new THREE.Vector3(0, 0.12, 0),
    massOf: (p) => p.collision.massCone,
    restitutionOf: (p) => p.collision.restitutionCone,
  },
  sign: {
    kind: 'sign',
    propClass: 'A',
    size: new THREE.Vector3(0.5, 0.6, 0.06),
    shape: 'box',
    material: 'plastic',
    colour: CLASS_COLOUR.A,
    inertia: new THREE.Vector3(0.3, 0.28, 0.06),
    com: new THREE.Vector3(0, 0.25, 0),
    massOf: (p) => p.collision.massCone * 1.5,
    restitutionOf: (p) => p.collision.restitutionCone,
  },
  barrel: {
    kind: 'barrel',
    propClass: 'B',
    size: new THREE.Vector3(0.32, 0.48, 0.32),
    shape: 'cylinder',
    material: 'steel',
    colour: CLASS_COLOUR.B,
    inertia: new THREE.Vector3(7.5, 2.8, 7.5),
    com: new THREE.Vector3(0, 0, 0),
    massOf: (p) => p.collision.massBarrel,
    restitutionOf: (p) => p.collision.restitutionBarrel,
  },
  tyreStack: {
    kind: 'tyreStack',
    propClass: 'B',
    size: new THREE.Vector3(0.55, 0.42, 0.55),
    shape: 'cylinder',
    material: 'rubber',
    colour: CLASS_COLOUR.B,
    // Mass at radius: high spin inertia, so it topples slowly and then rolls.
    inertia: new THREE.Vector3(18.5, 27, 18.5),
    com: new THREE.Vector3(0, -0.05, 0),
    massOf: (p) => p.collision.massTyreStack,
    restitutionOf: (p) => p.collision.restitutionTyreStack,
  },
  crate: {
    kind: 'crate',
    propClass: 'B',
    size: new THREE.Vector3(0.45, 0.45, 0.45),
    shape: 'box',
    material: 'wood',
    colour: CLASS_COLOUR.B,
    inertia: new THREE.Vector3(9.5, 9.5, 9.5),
    com: new THREE.Vector3(0, 0, 0),
    massOf: (p) => p.collision.massCrate,
    restitutionOf: (p) => p.collision.restitutionCrate,
  },
  barrier: {
    kind: 'barrier',
    propClass: 'C',
    size: new THREE.Vector3(1.5, 0.4, 0.18),
    shape: 'box',
    material: 'concrete',
    colour: CLASS_COLOUR.C,
    // Huge about the short axes, small about the long one: it pivots and slides
    // rather than tumbling.
    inertia: new THREE.Vector3(58, 690, 725),
    com: new THREE.Vector3(0, -0.12, 0),
    massOf: (p) => p.collision.massBarrier,
    restitutionOf: (p) => p.collision.restitutionBarrier,
  },
  dumpster: {
    kind: 'dumpster',
    propClass: 'C',
    size: new THREE.Vector3(1.0, 0.65, 0.55),
    shape: 'box',
    material: 'steel',
    colour: CLASS_COLOUR.C,
    inertia: new THREE.Vector3(320, 430, 520),
    com: new THREE.Vector3(0, -0.2, 0),
    massOf: (p) => p.collision.massDumpster,
    restitutionOf: (p) => p.collision.restitutionDumpster,
  },
  wall: {
    kind: 'wall',
    propClass: 'D',
    size: new THREE.Vector3(4, 1.2, 0.5),
    shape: 'box',
    material: 'concrete',
    colour: CLASS_COLOUR.D,
    inertia: new THREE.Vector3(1, 1, 1),
    com: new THREE.Vector3(0, 0, 0),
    massOf: () => 0,
    restitutionOf: () => 0.05,
  },
  dummyCar: {
    kind: 'dummyCar',
    propClass: 'C',
    size: new THREE.Vector3(0.9, 0.4, 2.1),
    shape: 'box',
    material: 'carBody',
    colour: 0x6f7d8c,
    inertia: new THREE.Vector3(1650, 1800, 480),
    com: new THREE.Vector3(0, -0.25, 0),
    massOf: (p) => p.collision.massDummyCar,
    restitutionOf: (p) => p.collision.carRestitution,
  },
};

/** Class masses the inertia tensors above were authored against. */
const referenceMass: Record<PropKind, number> = {
  cone: 4,
  sign: 6,
  barrel: 55,
  tyreStack: 90,
  crate: 70,
  barrier: 900,
  dumpster: 1300,
  wall: 1,
  dummyCar: 1200,
};

export interface PropInstance {
  def: PropDefinition;
  body: RAPIER.RigidBody | null;
  collider: RAPIER.Collider;
  mesh: THREE.Mesh;
  interpolated: InterpolatedBody | null;
  spawnPosition: THREE.Vector3;
  spawnRotation: THREE.Quaternion;
  /** Frozen props are static colliders left exactly where they came to rest. */
  frozen: boolean;
  /** Monotonic index used to pick the oldest settled body when over budget. */
  order: number;
}

function meshFor(def: PropDefinition): THREE.Mesh {
  const material = new THREE.MeshLambertMaterial({ color: def.colour, flatShading: true });
  switch (def.shape) {
    case 'cylinder':
      return new THREE.Mesh(
        new THREE.CylinderGeometry(def.size.x, def.size.x, def.size.y * 2, 14),
        material,
      );
    case 'cone':
      return new THREE.Mesh(new THREE.ConeGeometry(def.size.x, def.size.y * 2, 12), material);
    default:
      return new THREE.Mesh(
        new THREE.BoxGeometry(def.size.x * 2, def.size.y * 2, def.size.z * 2),
        material,
      );
  }
}

function colliderDescFor(def: PropDefinition): RAPIER.ColliderDesc {
  switch (def.shape) {
    case 'cylinder':
      return RAPIER.ColliderDesc.cylinder(def.size.y, def.size.x);
    case 'cone':
      return RAPIER.ColliderDesc.cone(def.size.y, def.size.x);
    default:
      return RAPIER.ColliderDesc.cuboid(def.size.x, def.size.y, def.size.z);
  }
}

export class PropWorld {
  readonly props: PropInstance[] = [];
  private nextOrder = 0;

  constructor(
    private physics: PhysicsWorld,
    private scene: THREE.Scene,
    private params: Params,
  ) {}

  spawn(kind: PropKind, position: THREE.Vector3, yaw = 0): PropInstance {
    const def = PROP_DEFS[kind];
    const mesh = meshFor(def);
    mesh.position.copy(position);
    mesh.rotation.y = yaw;
    this.scene.add(mesh);

    const rotation = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const isStatic = def.propClass === 'D';

    const bodyDesc = isStatic
      ? RAPIER.RigidBodyDesc.fixed()
      : RAPIER.RigidBodyDesc.dynamic()
          .setCcdEnabled(true)
          .setLinearDamping(0.05)
          .setAngularDamping(0.15)
          // Settled debris must go fully inactive so a degraded track stays free.
          .setSleeping(false);
    bodyDesc.setTranslation(position.x, position.y, position.z).setRotation(rotation);
    const body = this.physics.world.createRigidBody(bodyDesc);

    const desc = applyMaterial(colliderDescFor(def), def.material)
      .setDensity(0)
      .setRestitution(def.restitutionOf(this.params))
      .setCollisionGroups(
        interactionGroups(
          isStatic ? STATIC_GROUP : PROP_GROUP,
          CAR_GROUP | PROP_GROUP | STATIC_GROUP | DEBRIS_GROUP,
        ),
      )
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(400);
    const collider = this.physics.world.createCollider(desc, body);
    if (isStatic) registerSurface(collider.handle, 'tarmac');

    const instance: PropInstance = {
      def,
      body: isStatic ? null : body,
      collider,
      mesh,
      interpolated: isStatic ? null : new InterpolatedBody(body, mesh),
      spawnPosition: position.clone(),
      spawnRotation: new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
      frozen: isStatic,
      order: this.nextOrder,
    };
    this.nextOrder += 1;
    if (!isStatic) this.applyMassProperties(instance);
    this.props.push(instance);
    return instance;
  }

  /** Authored mass and inertia, rescaled if the class mass is retuned live. */
  applyMassProperties(instance: PropInstance): void {
    if (!instance.body || instance.frozen) return;
    const def = instance.def;
    const mass = Math.max(0.1, def.massOf(this.params));
    // The inertia figures were authored against the default class mass, so
    // retuning mass keeps the ratios between the three moments -- and with
    // them the character of the tumble -- and only changes the scale.
    const k = mass / Math.max(0.1, referenceMass[def.kind]);
    instance.body.setAdditionalMassProperties(
      mass,
      { x: def.com.x, y: def.com.y, z: def.com.z },
      { x: def.inertia.x * k, y: def.inertia.y * k, z: def.inertia.z * k },
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );
  }

  refreshAllMassProperties(): void {
    for (const p of this.props) {
      this.applyMassProperties(p);
      p.collider.setRestitution(p.def.restitutionOf(this.params));
    }
  }

  capture(): void {
    for (const p of this.props) p.interpolated?.capture();
  }

  render(alpha: number, cameraPosition: THREE.Vector3): void {
    const fade = this.params.expression.debrisFadeDistance;
    for (const p of this.props) {
      p.interpolated?.apply(alpha);
      if (fade > 0) {
        // Debris tumbling toward the camera occludes exactly what the player
        // needs to see, so fade anything that gets too close to the lens.
        const d = p.mesh.position.distanceTo(cameraPosition);
        const material = p.mesh.material as THREE.MeshLambertMaterial;
        const opacity = d < fade ? Math.max(0.05, d / fade) : 1;
        if (opacity < 1) {
          material.transparent = true;
          material.opacity = opacity;
        } else if (material.transparent) {
          material.transparent = false;
          material.opacity = 1;
        }
      }
    }
  }

  /**
   * Budget management that keeps persistence: when the simulated-body cap is
   * exceeded the oldest settled bodies are frozen into static colliders where
   * they lie. They remain as track hazards at near-zero cost.
   */
  enforceBudget(): void {
    const cap = this.params.collision.maxDynamicProps;
    const dynamic = this.props.filter((p) => !p.frozen);
    if (dynamic.length <= cap) return;

    const settled = dynamic
      .filter((p) => p.body !== null && p.body.isSleeping())
      .sort((a, b) => a.order - b.order);
    let toFreeze = dynamic.length - cap;
    for (const prop of settled) {
      if (toFreeze <= 0) break;
      this.freeze(prop);
      toFreeze -= 1;
    }
  }

  private freeze(prop: PropInstance): void {
    if (!prop.body || prop.frozen) return;
    const t = prop.body.translation();
    const r = prop.body.rotation();
    this.physics.world.removeRigidBody(prop.body);

    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(t.x, t.y, t.z).setRotation(r),
    );
    const desc = applyMaterial(colliderDescFor(prop.def), prop.def.material)
      .setCollisionGroups(interactionGroups(STATIC_GROUP, CAR_GROUP | PROP_GROUP | DEBRIS_GROUP));
    const collider = this.physics.world.createCollider(desc, body);
    registerSurface(collider.handle, 'tarmac');

    prop.body = body;
    prop.interpolated = null;
    prop.frozen = true;
    (prop as { collider: RAPIER.Collider }).collider = collider;
    prop.mesh.position.set(t.x, t.y, t.z);
    prop.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  /** Restore every prop to its authored spawn transform. */
  reset(): void {
    for (const prop of this.props) {
      if (prop.frozen && prop.def.propClass !== 'D') {
        // Frozen debris has to be re-created as a dynamic body to come back.
        if (prop.body) this.physics.world.removeRigidBody(prop.body);
        const body = this.physics.world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic()
            .setCcdEnabled(true)
            .setLinearDamping(0.05)
            .setAngularDamping(0.15)
            .setTranslation(prop.spawnPosition.x, prop.spawnPosition.y, prop.spawnPosition.z)
            .setRotation(prop.spawnRotation),
        );
        const desc = applyMaterial(colliderDescFor(prop.def), prop.def.material)
          .setDensity(0)
          .setRestitution(prop.def.restitutionOf(this.params))
          .setCollisionGroups(
            interactionGroups(PROP_GROUP, CAR_GROUP | PROP_GROUP | STATIC_GROUP | DEBRIS_GROUP),
          )
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(400);
        const collider = this.physics.world.createCollider(desc, body);
        prop.body = body;
        (prop as { collider: RAPIER.Collider }).collider = collider;
        prop.interpolated = new InterpolatedBody(body, prop.mesh);
        prop.frozen = false;
        this.applyMassProperties(prop);
        continue;
      }
      if (!prop.body || prop.frozen) continue;
      prop.body.setTranslation(prop.spawnPosition, true);
      prop.body.setRotation(prop.spawnRotation, true);
      prop.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      prop.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      prop.interpolated?.capture();
      prop.interpolated?.capture();
    }
  }

  isProp(colliderHandle: number): PropInstance | undefined {
    return this.props.find((p) => p.collider.handle === colliderHandle);
  }
}

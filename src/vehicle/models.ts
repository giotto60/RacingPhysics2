import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { DriveLayout } from '../core/params';

/**
 * The car models the picker offers, and the loader that normalises them.
 *
 * Two kits with nothing in common: Kenney's Car Kit is two dozen low-poly
 * vehicles sharing one 12 KB palette texture, each with its body and its four
 * wheels as separate nodes; the Pony Cartoon is a single detailed mesh with its
 * own PBR textures and no separable wheels. Everything below exists to hand the
 * view the same shape of thing whichever it loaded.
 *
 * Models are fetched at runtime from `public/`, not bundled: they are 5 MB of
 * geometry between them and only the chosen one is ever needed.
 */

/**
 * What a vehicle is, as opposed to what it looks like.
 *
 * Size, mass and drive layout are authored per class; everything else the
 * simulation needs -- inertia, spring rates, brake torque, wheelbase, track,
 * tyre size -- is derived from these and from the model's own geometry, so
 * adding a vehicle means adding one row rather than a tuning session.
 *
 * `power` and `grip` are multipliers on the authored defaults and never drop
 * below 1: every vehicle got the power and grip rise the defaults carry, and a
 * fire engine is slow because it weighs nine tonnes, not because it was handed
 * a weaker engine.
 */
export interface CarClass {
  /** Overall body length and width the model is scaled to, metres. */
  length: number;
  width: number;
  mass: number;
  power: number;
  grip: number;
  layout: DriveLayout;
  /** Centre of mass height as a fraction of body height. Low is stable. */
  comHeight: number;
}

export const CAR_CLASSES = {
  kart: { length: 2.6, width: 1.4, mass: 210, power: 1.0, grip: 1.2, layout: 'RWD', comHeight: 0.34 },
  race: { length: 4.7, width: 2.0, mass: 820, power: 1.9, grip: 1.35, layout: 'RWD', comHeight: 0.3 },
  raceFuture: { length: 4.7, width: 2.0, mass: 870, power: 2.0, grip: 1.35, layout: 'AWD', comHeight: 0.3 },
  sports: { length: 4.35, width: 1.88, mass: 1280, power: 1.45, grip: 1.15, layout: 'RWD', comHeight: 0.36 },
  hatch: { length: 4.05, width: 1.8, mass: 1150, power: 1.2, grip: 1.08, layout: 'FWD', comHeight: 0.4 },
  sedan: { length: 4.6, width: 1.86, mass: 1450, power: 1.25, grip: 1.0, layout: 'RWD', comHeight: 0.38 },
  taxi: { length: 4.6, width: 1.86, mass: 1580, power: 1.15, grip: 1.0, layout: 'FWD', comHeight: 0.4 },
  police: { length: 4.75, width: 1.92, mass: 1650, power: 1.6, grip: 1.12, layout: 'RWD', comHeight: 0.37 },
  suv: { length: 4.85, width: 2.0, mass: 2050, power: 1.35, grip: 1.0, layout: 'AWD', comHeight: 0.45 },
  van: { length: 5.4, width: 2.1, mass: 2500, power: 1.2, grip: 1.0, layout: 'FWD', comHeight: 0.47 },
  truck: { length: 6.3, width: 2.35, mass: 4600, power: 1.7, grip: 1.0, layout: 'RWD', comHeight: 0.44 },
  heavy: { length: 7.4, width: 2.5, mass: 9000, power: 2.6, grip: 1.0, layout: 'RWD', comHeight: 0.46 },
  ambulance: { length: 5.9, width: 2.25, mass: 3200, power: 1.7, grip: 1.0, layout: 'RWD', comHeight: 0.48 },
  tractor: { length: 4.0, width: 2.1, mass: 3100, power: 1.3, grip: 1.05, layout: 'RWD', comHeight: 0.5 },
  classic: { length: 4.7, width: 1.95, mass: 1520, power: 1.5, grip: 1.15, layout: 'RWD', comHeight: 0.38 },
  blocks: { length: 4.2, width: 1.8, mass: 1200, power: 1.0, grip: 1.0, layout: 'RWD', comHeight: 0.4 },
} satisfies Record<string, CarClass>;

export type CarClassName = keyof typeof CAR_CLASSES;

export interface CarModelDef {
  id: string;
  label: string;
  /** Path relative to the site root, or null for the built-in box. */
  file: string | null;
  klass: CarClassName;
  /** Model kits face +Z; the simulation's forward is -Z. */
  faces?: 'forward' | 'backward';
}

const kenney = (id: string, label: string, klass: CarClassName): CarModelDef => ({
  id,
  label,
  file: `models/kenney/${id}.glb`,
  klass,
  faces: 'backward',
});

export const CAR_MODELS: CarModelDef[] = [
  { id: 'blocks', label: 'Blocks (built-in)', file: null, klass: 'blocks' },
  { id: 'pony', label: 'Pony cartoon', file: 'models/pony/pony.glb', klass: 'classic', faces: 'forward' },
  kenney('sedan', 'Sedan', 'sedan'),
  kenney('sedan-sports', 'Sedan sports', 'sports'),
  kenney('hatchback-sports', 'Hatchback sports', 'hatch'),
  kenney('race', 'Race', 'race'),
  kenney('race-future', 'Race future', 'raceFuture'),
  kenney('suv', 'SUV', 'suv'),
  kenney('suv-luxury', 'SUV luxury', 'suv'),
  kenney('taxi', 'Taxi', 'taxi'),
  kenney('police', 'Police', 'police'),
  kenney('ambulance', 'Ambulance', 'ambulance'),
  kenney('firetruck', 'Fire truck', 'heavy'),
  kenney('garbage-truck', 'Garbage truck', 'heavy'),
  kenney('delivery', 'Delivery', 'van'),
  kenney('delivery-flat', 'Delivery flatbed', 'van'),
  kenney('truck', 'Truck', 'truck'),
  kenney('truck-flat', 'Truck flatbed', 'truck'),
  kenney('van', 'Van', 'van'),
  kenney('tractor', 'Tractor', 'tractor'),
  kenney('tractor-police', 'Tractor police', 'tractor'),
  kenney('tractor-shovel', 'Tractor shovel', 'tractor'),
  kenney('kart-oobi', 'Kart oobi', 'kart'),
  kenney('kart-oodi', 'Kart oodi', 'kart'),
  kenney('kart-ooli', 'Kart ooli', 'kart'),
  kenney('kart-oopi', 'Kart oopi', 'kart'),
  kenney('kart-oozi', 'Kart oozi', 'kart'),
];

export const modelById = (id: string): CarModelDef =>
  CAR_MODELS.find((m) => m.id === id) ?? CAR_MODELS[0];

export interface LoadedCarModel {
  /** Body, spoilers, doors, kart drivers -- everything that is not a wheel. */
  body: THREE.Object3D;
  /** FL FR RL RR in the simulation's wheel order, each centred on its own hub. */
  wheels: (THREE.Object3D | null)[];
  /** Bounding box of `body` alone, in the model's own units. */
  bodyBox: THREE.Box3;
  /**
   * Mean radius of the model's own wheels, its own units, 0 if it has none.
   * The mean rather than any one of them because the simulation runs a single
   * wheel size and a tractor's rear tyres are half again its fronts.
   */
  wheelRadius: number;
  /** Width of the model's own wheels, its own units. */
  wheelWidth: number;
  /** Front-to-rear hub distance in the model's own units, 0 if it has none. */
  wheelbase: number;
  /** Left-to-right hub distance in the model's own units, 0 if it has none. */
  track: number;
}

const WHEEL_SLOT: Record<string, number> = {
  'wheel-front-left': 0,
  'wheel-front-right': 1,
  'wheel-back-left': 2,
  'wheel-back-right': 3,
};

const loader = new GLTFLoader();
const cache = new Map<string, Promise<LoadedCarModel>>();

/**
 * Split a loaded scene into a body and four wheels, with the whole thing turned
 * to face -Z and each wheel re-centred on its own hub so it can be dropped
 * straight onto a suspension hardpoint.
 */
function normalise(scene: THREE.Object3D, def: CarModelDef): LoadedCarModel {
  const root = new THREE.Group();
  root.add(scene);
  if (def.faces !== 'forward') root.rotation.y = Math.PI;
  root.updateMatrixWorld(true);

  const wheels: (THREE.Object3D | null)[] = [null, null, null, null];
  const wheelNodes: THREE.Object3D[] = [];
  scene.traverse((node) => {
    const slot = WHEEL_SLOT[node.name];
    if (slot !== undefined && wheels[slot] === null) {
      wheels[slot] = node;
      wheelNodes.push(node);
    }
  });

  // Lift the wheels out of the hierarchy, keeping the world transform the model
  // gave them, then re-centre each on its own hub: the kits model a wheel
  // reaching outward from its node rather than sitting on it.
  let radiusSum = 0;
  let widthSum = 0;
  const hubs: THREE.Vector3[] = [];
  for (const node of wheelNodes) {
    const world = node.matrixWorld.clone();
    const slot = WHEEL_SLOT[node.name];
    node.removeFromParent();

    const holder = new THREE.Group();
    holder.name = node.name;
    holder.add(node);
    node.position.set(0, 0, 0);
    node.quaternion.identity();
    node.scale.set(1, 1, 1);
    node.applyMatrix4(world);
    holder.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(node);
    const hub = box.getCenter(new THREE.Vector3());
    node.position.sub(hub);
    holder.updateMatrixWorld(true);
    // The hub the model put the wheel on: what the wheelbase, the track and
    // the tyre's size are all read from, so a vehicle is proportioned by its
    // own drawing rather than by a number typed next to it.
    hubs[slot] = hub;
    radiusSum += (box.max.y - box.min.y) / 2;
    widthSum += box.max.x - box.min.x;
    wheels[slot] = holder;
  }
  const found = wheelNodes.length;
  const wheelRadius = found > 0 ? radiusSum / found : 0;
  const wheelWidth = found > 0 ? widthSum / found : 0;
  const wheelbase = hubs[0] && hubs[2] ? Math.abs(hubs[0].z - hubs[2].z) : 0;
  const track = hubs[0] && hubs[1] ? Math.abs(hubs[0].x - hubs[1].x) : 0;

  // Whatever is left is body: shells, spoilers, doors, and the karts' drivers.
  root.updateMatrixWorld(true);
  const bodyBox = new THREE.Box3().setFromObject(root);
  return { body: root, wheels, bodyBox, wheelRadius, wheelWidth, wheelbase, track };
}

/** Load and normalise a model, once per id. */
export function loadCarModel(def: CarModelDef, baseUrl: string): Promise<LoadedCarModel> {
  const existing = cache.get(def.id);
  if (existing) return existing;
  const url = `${baseUrl}${def.file}`;
  const pending = loader.loadAsync(url).then((gltf) => normalise(gltf.scene, def));
  cache.set(def.id, pending);
  // A failure must not be cached, or a model that lost one fetch to a flaky
  // connection could never be picked again for the rest of the session.
  pending.catch(() => cache.delete(def.id));
  return pending;
}

/**
 * A fresh, independent copy: geometries are cloned as well as nodes, because
 * the car dents its own bodywork and the cached original has to stay clean.
 */
export function instantiate(loaded: LoadedCarModel): {
  body: THREE.Object3D;
  wheels: (THREE.Object3D | null)[];
} {
  const deepClone = (source: THREE.Object3D): THREE.Object3D => {
    const copy = source.clone(true);
    copy.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry = mesh.geometry.clone();
    });
    return copy;
  };
  return {
    body: deepClone(loaded.body),
    wheels: loaded.wheels.map((w) => (w ? deepClone(w) : null)),
  };
}

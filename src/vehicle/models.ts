import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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

export interface CarModelDef {
  id: string;
  label: string;
  /** Path relative to the site root, or null for the built-in box. */
  file: string | null;
  /** Model kits face +Z; the simulation's forward is -Z. */
  faces?: 'forward' | 'backward';
}

const kenney = (id: string, label: string): CarModelDef => ({
  id,
  label,
  file: `models/kenney/${id}.glb`,
  faces: 'backward',
});

export const CAR_MODELS: CarModelDef[] = [
  { id: 'blocks', label: 'Blocks (built-in)', file: null },
  { id: 'pony', label: 'Pony cartoon', file: 'models/pony/pony.glb', faces: 'forward' },
  kenney('sedan', 'Sedan'),
  kenney('sedan-sports', 'Sedan sports'),
  kenney('hatchback-sports', 'Hatchback sports'),
  kenney('race', 'Race'),
  kenney('race-future', 'Race future'),
  kenney('suv', 'SUV'),
  kenney('suv-luxury', 'SUV luxury'),
  kenney('taxi', 'Taxi'),
  kenney('police', 'Police'),
  kenney('ambulance', 'Ambulance'),
  kenney('firetruck', 'Fire truck'),
  kenney('garbage-truck', 'Garbage truck'),
  kenney('delivery', 'Delivery'),
  kenney('delivery-flat', 'Delivery flatbed'),
  kenney('truck', 'Truck'),
  kenney('truck-flat', 'Truck flatbed'),
  kenney('van', 'Van'),
  kenney('tractor', 'Tractor'),
  kenney('tractor-police', 'Tractor police'),
  kenney('tractor-shovel', 'Tractor shovel'),
  kenney('kart-oobi', 'Kart oobi'),
  kenney('kart-oodi', 'Kart oodi'),
  kenney('kart-ooli', 'Kart ooli'),
  kenney('kart-oopi', 'Kart oopi'),
  kenney('kart-oozi', 'Kart oozi'),
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
  /** Radius of the model's own wheels in its own units, 0 if it has none. */
  wheelRadius: number;
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
  let wheelRadius = 0;
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
    node.position.sub(box.getCenter(new THREE.Vector3()));
    holder.updateMatrixWorld(true);
    wheelRadius = Math.max(wheelRadius, (box.max.y - box.min.y) / 2);
    wheels[slot] = holder;
  }

  // Whatever is left is body: shells, spoilers, doors, and the karts' drivers.
  root.updateMatrixWorld(true);
  const bodyBox = new THREE.Box3().setFromObject(root);
  return { body: root, wheels, bodyBox, wheelRadius };
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

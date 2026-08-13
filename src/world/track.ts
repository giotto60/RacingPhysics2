import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/world';
import { applyMaterial, interactionGroups, STATIC_GROUP } from '../physics/materials';
import { registerSurface, surfaceColour } from './surfaces';
import type { SurfaceType } from '../core/params';

/**
 * The test circuit. Geometry is functional only -- flat untextured colour,
 * no scenery. A figure-8 with a flat at-grade crossing, plus a skid pad and a
 * surface strip attached off the loop.
 */

const CAR_MASK = 0xffff;
const staticGroups = interactionGroups(STATIC_GROUP, CAR_MASK);

export const TRACK_WIDTH = 13;
export const GROUND_HALF = 420;
/**
 * The racing surface sits a few centimetres proud of the grass. Without the
 * offset the track and the ground share a plane and a suspension ray picks
 * whichever collider it happens to reach first, so wheels report grip at
 * random. The step is small enough that the suspension absorbs it.
 */
const TRACK_BASE_Y = 0.05;

/** Teleport targets offered in the debug panel. */
export const SKIDPAD_CENTRE = new THREE.Vector3(60, 0, 235);
export const SKIDPAD_RADIUS = 46;
export const SURFACE_STRIP_START = new THREE.Vector3(250, 0, -78);
const STRIP_SECTION_LENGTH = 44;

/**
 * Figure-8 centreline control points. The two neck segments both pass through
 * the origin from opposite diagonals, which is what makes the crossing real
 * rather than two lobes joined at a pinch.
 */
const CENTRELINE: Array<[number, number]> = [
  // right lobe: long constant-radius sweeper into the long straight
  [28, 22],
  [62, 46],
  [100, 58],
  [134, 46],
  [146, 10],
  [150, -34],
  [140, -70],
  [104, -88],
  [66, -78],
  [44, -52],
  // neck heading north-west across the crossing
  [16, -14],
  [-14, 22],
  // left lobe: hairpin at the far end, chicane on the way back
  [-42, 48],
  [-78, 62],
  [-112, 44],
  [-128, 12],
  [-134, -14],
  [-116, -34],
  [-88, -40],
  [-70, -56],
  [-52, -40],
  [-34, -56],
  // neck heading north-east back across the crossing
  [-16, -30],
  [10, 2],
];

/**
 * Elevation is authored in world space rather than by lap fraction, so the
 * crest and the jump stay attached to the corners they belong to even if the
 * control points move.
 */
const CREST = { x: 66, z: -78, radius: 28, height: 1.7 };
const JUMP = {
  x: -88,
  z: -40,
  dirX: 0.9,
  dirZ: -0.44,
  ramp: 15,
  height: 1.15,
  extent: 24,
};

function elevationAt(x: number, z: number): number {
  let h = TRACK_BASE_Y;

  const dc = Math.hypot(x - CREST.x, z - CREST.z);
  if (dc < CREST.radius) {
    const c = Math.cos(((Math.PI / 2) * dc) / CREST.radius);
    h += CREST.height * c * c;
  }

  const dx = x - JUMP.x;
  const dz = z - JUMP.z;
  if (Math.hypot(dx, dz) < JUMP.extent) {
    // Ramp up along the direction of travel, then a hard lip: the abrupt end
    // is the point, since a smooth crest launches nothing.
    const along = dx * JUMP.dirX + dz * JUMP.dirZ;
    if (along <= 0 && along >= -JUMP.ramp) {
      h += JUMP.height * (1 + along / JUMP.ramp);
    }
  }

  return h;
}

export interface TrackBuild {
  meshes: THREE.Object3D[];
  colliders: RAPIER.Collider[];
  centreline: THREE.Vector3[];
}

/**
 * Spawn on the generated centreline rather than at a hand-typed coordinate,
 * so the car always starts square on the racing surface even if the layout
 * control points move.
 */
export function spawnOnCentreline(
  centreline: THREE.Vector3[],
  index = 0,
): { position: THREE.Vector3; heading: number } {
  const here = centreline[index % centreline.length];
  const next = centreline[(index + 4) % centreline.length];
  const dx = next.x - here.x;
  const dz = next.z - here.z;
  // The car's forward is local -Z, so this yaw points it along the track.
  return {
    position: new THREE.Vector3(here.x, here.y + 0.95, here.z),
    heading: Math.atan2(-dx, -dz),
  };
}

function addTrimesh(
  physics: PhysicsWorld,
  scene: THREE.Scene,
  vertices: Float32Array,
  indices: Uint32Array,
  surface: SurfaceType,
  build: TrackBuild,
  colour = surfaceColour[surface],
): void {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: colour }));
  scene.add(mesh);
  build.meshes.push(mesh);

  const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const desc = applyMaterial(RAPIER.ColliderDesc.trimesh(vertices, indices), 'tarmac')
    .setCollisionGroups(staticGroups);
  const collider = physics.world.createCollider(desc, body);
  registerSurface(collider.handle, surface);
  build.colliders.push(collider);
}

function addBox(
  physics: PhysicsWorld,
  scene: THREE.Scene,
  size: THREE.Vector3,
  position: THREE.Vector3,
  yaw: number,
  surface: SurfaceType,
  build: TrackBuild,
  colour = surfaceColour[surface],
): RAPIER.Collider {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    new THREE.MeshLambertMaterial({ color: colour }),
  );
  mesh.position.copy(position);
  mesh.rotation.y = yaw;
  scene.add(mesh);
  build.meshes.push(mesh);

  const body = physics.world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
  );
  const desc = applyMaterial(
    RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2),
    surface === 'kerb' ? 'concrete' : 'tarmac',
  ).setCollisionGroups(staticGroups);
  const collider = physics.world.createCollider(desc, body);
  registerSurface(collider.handle, surface);
  build.colliders.push(collider);
  return collider;
}

/** Ribbon of road generated along a closed spline, with elevation. */
function buildRibbon(
  physics: PhysicsWorld,
  scene: THREE.Scene,
  build: TrackBuild,
  samples: number,
): THREE.Vector3[] {
  const points = CENTRELINE.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal', 0.5);

  const centre: THREE.Vector3[] = [];
  const vertices = new Float32Array(samples * 2 * 3);
  const indices = new Uint32Array(samples * 6);
  const half = TRACK_WIDTH * 0.5;
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let i = 0; i < samples; i += 1) {
    const t = i / samples;
    const p = curve.getPointAt(t);
    p.y = elevationAt(p.x, p.z);
    centre.push(p.clone());
    curve.getTangentAt(t, tangent);
    tangent.y = 0;
    tangent.normalize();
    normal.set(-tangent.z, 0, tangent.x);

    const base = i * 6;
    vertices[base + 0] = p.x - normal.x * half;
    vertices[base + 1] = p.y;
    vertices[base + 2] = p.z - normal.z * half;
    vertices[base + 3] = p.x + normal.x * half;
    vertices[base + 4] = p.y;
    vertices[base + 5] = p.z + normal.z * half;

    const next = (i + 1) % samples;
    const idx = i * 6;
    const a = i * 2;
    const b = i * 2 + 1;
    const c = next * 2;
    const d = next * 2 + 1;
    // Wound so the surface faces up; a downward-facing ribbon is invisible
    // from an overhead camera even though the collider still works.
    indices[idx + 0] = a;
    indices[idx + 1] = b;
    indices[idx + 2] = c;
    indices[idx + 3] = b;
    indices[idx + 4] = d;
    indices[idx + 5] = c;
  }

  addTrimesh(physics, scene, vertices, indices, 'tarmac', build);
  return centre;
}

function buildDisc(
  physics: PhysicsWorld,
  scene: THREE.Scene,
  build: TrackBuild,
  centre: THREE.Vector3,
  radius: number,
  segments: number,
  surface: SurfaceType,
): void {
  const vertices = new Float32Array((segments + 1) * 3);
  const indices = new Uint32Array(segments * 3);
  vertices[0] = centre.x;
  vertices[1] = centre.y;
  vertices[2] = centre.z;
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    vertices[(i + 1) * 3 + 0] = centre.x + Math.cos(a) * radius;
    vertices[(i + 1) * 3 + 1] = centre.y;
    vertices[(i + 1) * 3 + 2] = centre.z + Math.sin(a) * radius;
    indices[i * 3 + 0] = 0;
    indices[i * 3 + 1] = ((i + 1) % segments) + 1;
    indices[i * 3 + 2] = i + 1;
  }
  addTrimesh(physics, scene, vertices, indices, surface, build);
}

export function buildTrack(physics: PhysicsWorld, scene: THREE.Scene): TrackBuild {
  const build: TrackBuild = { meshes: [], colliders: [], centreline: [] };

  // Ground: everything off the racing surface is grass.
  const groundBody = physics.world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0),
  );
  const groundDesc = applyMaterial(
    RAPIER.ColliderDesc.cuboid(GROUND_HALF, 1, GROUND_HALF),
    'loose',
  ).setCollisionGroups(staticGroups);
  const groundCollider = physics.world.createCollider(groundDesc, groundBody);
  registerSurface(groundCollider.handle, 'grass');
  build.colliders.push(groundCollider);

  const groundMesh = new THREE.Mesh(
    new THREE.BoxGeometry(GROUND_HALF * 2, 2, GROUND_HALF * 2),
    new THREE.MeshLambertMaterial({ color: surfaceColour.grass }),
  );
  groundMesh.position.y = -1;
  scene.add(groundMesh);
  build.meshes.push(groundMesh);

  build.centreline = buildRibbon(physics, scene, build, 720);

  // Skid pad: a wide flat circle for steady-state cornering and doughnuts,
  // where most of the tyre tuning will actually happen.
  const skidPadCentre = SKIDPAD_CENTRE.clone();
  skidPadCentre.y = TRACK_BASE_Y;
  buildDisc(physics, scene, build, skidPadCentre, SKIDPAD_RADIUS, 96, 'tarmac');
  // Access lane from the top of the right lobe.
  addBox(
    physics,
    scene,
    new THREE.Vector3(14, 0.1, 150),
    new THREE.Vector3(96, TRACK_BASE_Y, 130),
    0,
    'tarmac',
    build,
  );

  // Surface strip: consecutive sections so grip multipliers can be felt back
  // to back at a constant throttle.
  const strip: SurfaceType[] = ['tarmac', 'dirt', 'grass', 'gravel', 'kerb'];
  strip.forEach((surface, i) => {
    addBox(
      physics,
      scene,
      new THREE.Vector3(14, 0.1, STRIP_SECTION_LENGTH),
      new THREE.Vector3(
        SURFACE_STRIP_START.x,
        surface === 'kerb' ? TRACK_BASE_Y + 0.05 : TRACK_BASE_Y,
        SURFACE_STRIP_START.z + i * STRIP_SECTION_LENGTH,
      ),
      0,
      surface,
      build,
    );
  });
  // Lane connecting the long straight to the surface strip.
  addBox(
    physics,
    scene,
    new THREE.Vector3(112, 0.1, 14),
    new THREE.Vector3(198, TRACK_BASE_Y, -96),
    0,
    'tarmac',
    build,
  );

  // Kerbs on the inside of the hairpin, where a wheel will actually find them.
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI * 0.42 + (i / 9) * Math.PI * 0.84;
    addBox(
      physics,
      scene,
      new THREE.Vector3(2.4, 0.22, 3.4),
      new THREE.Vector3(-122 + Math.cos(a) * -8, TRACK_BASE_Y + 0.05, -12 + Math.sin(a) * 22),
      -a,
      'kerb',
      build,
    );
  }

  return build;
}

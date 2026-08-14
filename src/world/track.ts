import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/world';
import { applyMaterial, interactionGroups, STATIC_GROUP } from '../physics/materials';
import { registerSurface } from './surfaces';
import { roadTexture, surfaceTexture } from './textures';
import type { SurfaceType } from '../core/params';

/**
 * The test circuit: a figure-8 with a flat at-grade crossing, plus a skid pad,
 * a surface strip and a set of ramps hung off the loop.
 *
 * The racing surface is flush with the surrounding ground. The grass collider
 * sits a few centimetres below its own mesh instead, which keeps the suspension
 * rays unambiguous where the two overlap without putting a visible step around
 * the whole circuit.
 */

const CAR_MASK = 0xffff;
const staticGroups = interactionGroups(STATIC_GROUP, CAR_MASK);

export const TRACK_WIDTH = 13;
export const GROUND_HALF = 420;
/** Racing surfaces are the zero datum; everything else is measured from here. */
const TRACK_BASE_Y = 0;
/** How far the grass collider is sunk below its mesh. Sub-pixel from above. */
const GRASS_COLLIDER_DROP = 0.05;
const GRASS_MESH_DROP = 0.02;

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
  ramp: 12,
  height: 1.7,
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

/** Point on the racing surface at lap fraction `t`, offset sideways by `lateral`. */
export function pointOnTrack(
  centreline: THREE.Vector3[],
  t: number,
  lateral = 0,
): { position: THREE.Vector3; heading: number } {
  const n = centreline.length;
  const i = ((Math.floor(t * n) % n) + n) % n;
  const here = centreline[i];
  const next = centreline[(i + 1) % n];
  const dx = next.x - here.x;
  const dz = next.z - here.z;
  const len = Math.max(1e-4, Math.hypot(dx, dz));
  const nx = -dz / len;
  const nz = dx / len;
  return {
    position: new THREE.Vector3(here.x + nx * lateral, here.y, here.z + nz * lateral),
    heading: Math.atan2(-dx, -dz),
  };
}

function surfaceMaterial(
  surface: SurfaceType,
  repeatX: number,
  repeatY: number,
): THREE.MeshPhongMaterial {
  return new THREE.MeshPhongMaterial({
    color: 0xffffff,
    map: surfaceTexture(surface, repeatX, repeatY),
    shininess: surface === 'tarmac' ? 8 : 2,
    specular: 0x0e1114,
  });
}

function addTrimesh(
  physics: PhysicsWorld,
  scene: THREE.Scene,
  geometry: THREE.BufferGeometry,
  vertices: Float32Array,
  indices: Uint32Array,
  surface: SurfaceType,
  build: TrackBuild,
  material: THREE.Material,
): void {
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  build.meshes.push(mesh);

  const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const desc = applyMaterial(RAPIER.ColliderDesc.trimesh(vertices, indices), 'tarmac')
    .setCollisionGroups(staticGroups);
  const collider = physics.world.createCollider(desc, body);
  registerSurface(collider.handle, surface);
  build.colliders.push(collider);
}

/**
 * A flat pad of racing surface. `topY` is the height of its driving surface,
 * so pads sit flush with the ground rather than standing proud of it.
 */
function addPad(
  physics: PhysicsWorld,
  scene: THREE.Scene,
  size: THREE.Vector3,
  centreXZ: THREE.Vector3,
  topY: number,
  yaw: number,
  surface: SurfaceType,
  build: TrackBuild,
): RAPIER.Collider {
  const position = new THREE.Vector3(centreXZ.x, topY - size.y / 2, centreXZ.z);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    surfaceMaterial(surface, Math.max(1, size.x / 6), Math.max(1, size.z / 6)),
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

/**
 * A launch ramp: a wedge whose leading edge is flush with the road, so a car
 * drives on to it instead of hitting a step. Built as a convex hull, which
 * gives the car hull something solid to ride rather than a paper-thin shell.
 */
function addRamp(
  physics: PhysicsWorld,
  scene: THREE.Scene,
  build: TrackBuild,
  centre: THREE.Vector3,
  /** World direction the ramp climbs toward. */
  dirX: number,
  dirZ: number,
  length: number,
  width: number,
  height: number,
): void {
  const hl = length / 2;
  const hw = width / 2;
  // Local +X climbs; the vertical face is at the far end.
  const points = new Float32Array([
    -hl, 0, -hw,
    -hl, 0, hw,
    hl, 0, -hw,
    hl, 0, hw,
    hl, height, -hw,
    hl, height, hw,
  ]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(points.slice(), 3));
  geometry.setIndex([
    0, 2, 1, 1, 2, 3, // base
    0, 1, 5, 0, 5, 4, // ramp face
    2, 4, 5, 2, 5, 3, // back wall
    0, 4, 2, // left side
    1, 3, 5, // right side
  ]);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshPhongMaterial({
      color: 0xffffff,
      map: surfaceTexture('tarmac', 2, 2),
      shininess: 8,
      specular: 0x0e1114,
    }),
  );
  const yaw = Math.atan2(-dirZ, dirX);
  mesh.position.copy(centre);
  mesh.rotation.y = yaw;
  scene.add(mesh);
  build.meshes.push(mesh);

  // A painted chevron on the face, so the ramp is obvious from above.
  const chevron = new THREE.Mesh(
    new THREE.BoxGeometry(length * 0.9, 0.02, width * 0.18),
    new THREE.MeshPhongMaterial({ color: 0xe6c84a, emissive: 0x3a3208 }),
  );
  chevron.position.set(0, height / 2 + 0.04, 0);
  chevron.rotation.z = Math.atan2(height, length);
  mesh.add(chevron);

  const body = physics.world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed()
      .setTranslation(centre.x, centre.y, centre.z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
  );
  const hull = RAPIER.ColliderDesc.convexHull(points);
  if (!hull) return;
  const collider = physics.world.createCollider(
    applyMaterial(hull, 'tarmac').setCollisionGroups(staticGroups),
    body,
  );
  registerSurface(collider.handle, 'tarmac');
  build.colliders.push(collider);
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
  const uvs = new Float32Array(samples * 2 * 2);
  const indices = new Uint32Array(samples * 6);
  const half = TRACK_WIDTH * 0.5;
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  let travelled = 0;

  for (let i = 0; i < samples; i += 1) {
    const t = i / samples;
    const p = curve.getPointAt(t);
    p.y = elevationAt(p.x, p.z);
    if (i > 0) travelled += p.distanceTo(centre[i - 1]);
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

    // u spans the width so the baked edge lines land on the edges; v is real
    // distance, so the centre-line dashes keep a constant length.
    const uvBase = i * 4;
    uvs[uvBase + 0] = 0;
    uvs[uvBase + 1] = travelled / 14;
    uvs[uvBase + 2] = 1;
    uvs[uvBase + 3] = travelled / 14;

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

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices.slice(), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices.slice(), 1));
  geometry.computeVertexNormals();

  addTrimesh(
    physics,
    scene,
    geometry,
    vertices,
    indices,
    'tarmac',
    build,
    new THREE.MeshPhongMaterial({
      color: 0xffffff,
      map: roadTexture(1),
      shininess: 10,
      specular: 0x0e1114,
    }),
  );
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
  const uvs = new Float32Array((segments + 1) * 2);
  const indices = new Uint32Array(segments * 3);
  vertices[0] = centre.x;
  vertices[1] = centre.y;
  vertices[2] = centre.z;
  uvs[0] = 0;
  uvs[1] = 0;
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    vertices[(i + 1) * 3 + 0] = centre.x + Math.cos(a) * radius;
    vertices[(i + 1) * 3 + 1] = centre.y;
    vertices[(i + 1) * 3 + 2] = centre.z + Math.sin(a) * radius;
    uvs[(i + 1) * 2 + 0] = (Math.cos(a) * radius) / 8;
    uvs[(i + 1) * 2 + 1] = (Math.sin(a) * radius) / 8;
    indices[i * 3 + 0] = 0;
    indices[i * 3 + 1] = ((i + 1) % segments) + 1;
    indices[i * 3 + 2] = i + 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices.slice(), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices.slice(), 1));
  geometry.computeVertexNormals();
  addTrimesh(
    physics,
    scene,
    geometry,
    vertices,
    indices,
    surface,
    build,
    surfaceMaterial(surface, 1, 1),
  );
}

/** Painted start/finish line. Visual only -- it must not disturb a wheel. */
function addStartLine(scene: THREE.Scene, build: TrackBuild, centreline: THREE.Vector3[]): void {
  const here = centreline[0];
  const next = centreline[4 % centreline.length];
  const yaw = Math.atan2(next.x - here.x, next.z - here.z);

  const group = new THREE.Group();
  group.position.set(here.x, here.y + 0.012, here.z);
  group.rotation.y = yaw;

  const squares = 13;
  for (let i = 0; i < squares; i += 1) {
    for (let row = 0; row < 2; row += 1) {
      if ((i + row) % 2 === 1) continue;
      const cell = new THREE.Mesh(
        new THREE.BoxGeometry(TRACK_WIDTH / squares, 0.02, 0.6),
        new THREE.MeshPhongMaterial({ color: 0xe8ebee }),
      );
      cell.position.set(
        -TRACK_WIDTH / 2 + (i + 0.5) * (TRACK_WIDTH / squares),
        0,
        -0.3 + row * 0.6,
      );
      group.add(cell);
    }
  }
  scene.add(group);
  build.meshes.push(group);
}

export function buildTrack(physics: PhysicsWorld, scene: THREE.Scene): TrackBuild {
  const build: TrackBuild = { meshes: [], colliders: [], centreline: [] };

  // Ground: everything off the racing surface is grass. Its collider is sunk a
  // little below its mesh so a suspension ray always prefers the road where the
  // two overlap, while the two still look flush from above.
  const groundBody = physics.world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1 - GRASS_COLLIDER_DROP, 0),
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
    surfaceMaterial('grass', GROUND_HALF / 5, GROUND_HALF / 5),
  );
  groundMesh.position.y = -1 - GRASS_MESH_DROP;
  scene.add(groundMesh);
  build.meshes.push(groundMesh);

  build.centreline = buildRibbon(physics, scene, build, 720);
  addStartLine(scene, build, build.centreline);

  // Skid pad: a wide flat circle for steady-state cornering and doughnuts,
  // where most of the tyre tuning will actually happen.
  const skidPadCentre = SKIDPAD_CENTRE.clone();
  skidPadCentre.y = TRACK_BASE_Y;
  buildDisc(physics, scene, build, skidPadCentre, SKIDPAD_RADIUS, 96, 'tarmac');
  // Access lane from the top of the right lobe.
  addPad(
    physics,
    scene,
    new THREE.Vector3(14, 0.3, 150),
    new THREE.Vector3(96, 0, 130),
    TRACK_BASE_Y,
    0,
    'tarmac',
    build,
  );

  // Surface strip: consecutive sections so grip multipliers can be felt back
  // to back at a constant throttle.
  const strip: SurfaceType[] = ['tarmac', 'dirt', 'grass', 'gravel', 'kerb'];
  strip.forEach((surface, i) => {
    addPad(
      physics,
      scene,
      new THREE.Vector3(14, 0.3, STRIP_SECTION_LENGTH),
      new THREE.Vector3(SURFACE_STRIP_START.x, 0, SURFACE_STRIP_START.z + i * STRIP_SECTION_LENGTH),
      surface === 'kerb' ? TRACK_BASE_Y + 0.04 : TRACK_BASE_Y,
      0,
      surface,
      build,
    );
  });
  // Lane connecting the long straight to the surface strip.
  addPad(
    physics,
    scene,
    new THREE.Vector3(112, 0.3, 14),
    new THREE.Vector3(198, 0, -96),
    TRACK_BASE_Y,
    0,
    'tarmac',
    build,
  );

  // Kerbs on the inside of the hairpin, where a wheel will actually find them.
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI * 0.42 + (i / 9) * Math.PI * 0.84;
    addPad(
      physics,
      scene,
      new THREE.Vector3(2.4, 0.24, 3.4),
      new THREE.Vector3(-122 + Math.cos(a) * -8, 0, -12 + Math.sin(a) * 22),
      TRACK_BASE_Y + 0.07,
      -a,
      'kerb',
      build,
    );
  }

  buildRamps(physics, scene, build);

  return build;
}

/**
 * Ramps, sized in a ladder so a jump can be tried at three severities without
 * changing anything else about the lap.
 */
function buildRamps(physics: PhysicsWorld, scene: THREE.Scene, build: TrackBuild): void {
  const line = build.centreline;
  const ramps: Array<{ t: number; lateral: number; length: number; width: number; height: number }> =
    [
      // Long straight on the right lobe: the big one, taken at full speed.
      { t: 0.17, lateral: 0, length: 11, width: 8.5, height: 1.9 },
      // Exit of the right lobe: a gentler kicker.
      { t: 0.3, lateral: -2.5, length: 9, width: 7, height: 1.15 },
      // Back straight on the left lobe.
      { t: 0.63, lateral: 2, length: 10, width: 7.5, height: 1.5 },
      // Approaching the crossing: a small one for landing practice.
      { t: 0.93, lateral: 0, length: 8, width: 7, height: 0.85 },
    ];

  for (const r of ramps) {
    const n = line.length;
    const i = Math.floor(r.t * n) % n;
    const here = line[i];
    const next = line[(i + 3) % n];
    const dx = next.x - here.x;
    const dz = next.z - here.z;
    const len = Math.max(1e-4, Math.hypot(dx, dz));
    const ux = dx / len;
    const uz = dz / len;
    const centre = new THREE.Vector3(
      here.x - uz * r.lateral,
      here.y,
      here.z + ux * r.lateral,
    );
    addRamp(physics, scene, build, centre, ux, uz, r.length, r.width, r.height);
  }
}

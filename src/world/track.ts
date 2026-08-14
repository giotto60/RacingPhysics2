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
/**
 * The road is a solid slab rather than a sheet of triangles. A ribbon with no
 * thickness is something a car can be pushed through -- most obviously into the
 * back of the jump, which is a vertical wall one triangle thick. The underside
 * is buried below the grass, so on the flat none of it is visible.
 */
const ROAD_SLAB_DEPTH = 0.35;
const ROAD_SLAB_FLOOR = -0.5;
/** Vertical clearance given to the second pass through a self-crossing. */
const CROSSING_LIFT = 0.035;
/**
 * Connecting lanes are laid a whisker below the racing surface. Exactly flush
 * they would be coplanar with the ribbon where the two meet, and coplanar
 * surfaces fight over every pixel they share.
 */
const LANE_SINK = 0.015;

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
  mesh.receiveShadow = true;
  mesh.castShadow = true;
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
  mesh.receiveShadow = true;
  mesh.castShadow = true;
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
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  build.meshes.push(mesh);

  // A painted chevron on the face, so the ramp is obvious from above.
  const chevron = new THREE.Mesh(
    new THREE.BoxGeometry(length * 0.9, 0.02, width * 0.18),
    new THREE.MeshPhongMaterial({ color: 0xe6c84a, emissive: 0x3a3208 }),
  );
  chevron.position.set(0, height / 2 + 0.04, 0);
  chevron.rotation.z = Math.atan2(height, length);
  chevron.receiveShadow = true;
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

/**
 * A figure-8 crosses itself, and where it does, two strips of road sit in
 * exactly the same plane. Coplanar surfaces have no stable answer to which one
 * is in front, so the lane markings flicker in and out across the crossing as
 * the camera moves. Find each self-overlap -- samples that are far apart around
 * the lap but close together in the world -- and lift the second pass through
 * it, ramped in over the whole approach so there is nothing to drive over.
 */
function liftCrossings(centre: THREE.Vector3[]): void {
  const n = centre.length;
  /** Samples this far apart around the lap are different parts of the circuit. */
  const separation = Math.floor(n / 8);
  const radius = TRACK_WIDTH * 1.1;
  const overlapping = new Array<boolean>(n).fill(false);

  for (let i = 0; i < n; i += 1) {
    for (let j = i + separation; j < n; j += 1) {
      // Circular distance, so the samples either side of the lap's seam are
      // not mistaken for a crossing with themselves.
      if (Math.min(j - i, n - (j - i)) < separation) continue;
      const dx = centre[i].x - centre[j].x;
      const dz = centre[i].z - centre[j].z;
      if (dx * dx + dz * dz < radius * radius) {
        overlapping[i] = true;
        overlapping[j] = true;
      }
    }
  }

  // Walk from a sample that is clear of any crossing, so a run is never split
  // in two by the start of the lap.
  const start = overlapping.indexOf(false);
  if (start < 0) return;

  let pass = 0;
  let k = 0;
  while (k < n) {
    if (!overlapping[(start + k) % n]) {
      k += 1;
      continue;
    }
    let length = 0;
    while (length < n && overlapping[(start + k + length) % n]) length += 1;
    // Alternate passes: the first through a crossing stays at grade, the
    // second rides over it.
    if (pass % 2 === 1) {
      for (let m = 0; m < length; m += 1) {
        const s = (m + 0.5) / length;
        centre[(start + k + m) % n].y += CROSSING_LIFT * 0.5 * (1 - Math.cos(2 * Math.PI * s));
      }
    }
    pass += 1;
    k += length;
  }
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
  const half = TRACK_WIDTH * 0.5;

  // Sample the centreline first and settle the elevation before any geometry
  // is built, so the crossing lift moves the road and its collider together.
  const centre: THREE.Vector3[] = [];
  const across: THREE.Vector3[] = [];
  const tangent = new THREE.Vector3();
  for (let i = 0; i < samples; i += 1) {
    const t = i / samples;
    const p = curve.getPointAt(t);
    p.y = elevationAt(p.x, p.z);
    centre.push(p);
    curve.getTangentAt(t, tangent);
    tangent.y = 0;
    tangent.normalize();
    across.push(new THREE.Vector3(-tangent.z, 0, tangent.x));
  }
  liftCrossings(centre);

  // Four vertices per sample: the two road edges and the two buried corners
  // directly below them. The driving surface is drawn from the top pair, and
  // the collider is the whole closed slab.
  const solid = new Float32Array(samples * 4 * 3);
  const surface = new Float32Array(samples * 2 * 3);
  const uvs = new Float32Array(samples * 2 * 2);
  const surfaceIndices = new Uint32Array(samples * 6);
  const skirtIndices = new Uint32Array(samples * 12);
  const solidIndices = new Uint32Array(samples * 24);
  let travelled = 0;

  for (let i = 0; i < samples; i += 1) {
    const p = centre[i];
    const n = across[i];
    if (i > 0) travelled += p.distanceTo(centre[i - 1]);
    const floor = Math.min(p.y - ROAD_SLAB_DEPTH, ROAD_SLAB_FLOOR);

    const v = i * 12;
    solid[v + 0] = p.x - n.x * half;
    solid[v + 1] = p.y;
    solid[v + 2] = p.z - n.z * half;
    solid[v + 3] = p.x + n.x * half;
    solid[v + 4] = p.y;
    solid[v + 5] = p.z + n.z * half;
    solid[v + 6] = p.x - n.x * half;
    solid[v + 7] = floor;
    solid[v + 8] = p.z - n.z * half;
    solid[v + 9] = p.x + n.x * half;
    solid[v + 10] = floor;
    solid[v + 11] = p.z + n.z * half;

    const s = i * 6;
    surface[s + 0] = solid[v + 0];
    surface[s + 1] = solid[v + 1];
    surface[s + 2] = solid[v + 2];
    surface[s + 3] = solid[v + 3];
    surface[s + 4] = solid[v + 4];
    surface[s + 5] = solid[v + 5];

    // u spans the width so the baked edge lines land on the edges; v is real
    // distance, so the centre-line dashes keep a constant length.
    const uvBase = i * 4;
    uvs[uvBase + 0] = 0;
    uvs[uvBase + 1] = travelled / 14;
    uvs[uvBase + 2] = 1;
    uvs[uvBase + 3] = travelled / 14;

    const next = (i + 1) % samples;
    // Left and right edge, top and bottom, for this cross-section and the next.
    const tl = i * 4;
    const tr = i * 4 + 1;
    const bl = i * 4 + 2;
    const br = i * 4 + 3;
    const ntl = next * 4;
    const ntr = next * 4 + 1;
    const nbl = next * 4 + 2;
    const nbr = next * 4 + 3;

    // Wound so the surface faces up; a downward-facing ribbon is invisible
    // from an overhead camera even though the collider still works.
    const si = i * 6;
    surfaceIndices[si + 0] = i * 2;
    surfaceIndices[si + 1] = i * 2 + 1;
    surfaceIndices[si + 2] = next * 2;
    surfaceIndices[si + 3] = i * 2 + 1;
    surfaceIndices[si + 4] = next * 2 + 1;
    surfaceIndices[si + 5] = next * 2;

    const ki = i * 12;
    const walls = [tl, ntl, bl, bl, ntl, nbl, tr, br, ntr, br, nbr, ntr];
    for (let m = 0; m < 12; m += 1) skirtIndices[ki + m] = walls[m];

    const ci = i * 24;
    const cell = [
      tl, tr, ntl, tr, ntr, ntl, // top
      bl, nbl, br, br, nbl, nbr, // bottom
      ...walls, // both sides
    ];
    for (let m = 0; m < 24; m += 1) solidIndices[ci + m] = cell[m];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(surface, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(surfaceIndices.slice(), 1));
  geometry.computeVertexNormals();

  addTrimesh(
    physics,
    scene,
    geometry,
    solid,
    solidIndices,
    'tarmac',
    build,
    new THREE.MeshPhongMaterial({
      color: 0xffffff,
      map: roadTexture(1),
      shininess: 10,
      specular: 0x0e1114,
    }),
  );

  // The sides of the slab. Buried on the flat, and the visible face of the
  // crest, the jump lip and the crossing where the road stands proud.
  const skirtGeometry = new THREE.BufferGeometry();
  skirtGeometry.setAttribute('position', new THREE.BufferAttribute(solid.slice(), 3));
  skirtGeometry.setIndex(new THREE.BufferAttribute(skirtIndices, 1));
  skirtGeometry.computeVertexNormals();
  const skirt = new THREE.Mesh(
    skirtGeometry,
    new THREE.MeshPhongMaterial({
      color: 0x2b2f34,
      side: THREE.DoubleSide,
      flatShading: true,
      shininess: 4,
      specular: 0x0b0d10,
    }),
  );
  skirt.castShadow = true;
  skirt.receiveShadow = true;
  scene.add(skirt);
  build.meshes.push(skirt);

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
      // Paint, not kerbing: it must not throw a shadow of its own thickness.
      cell.receiveShadow = true;
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
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
  build.meshes.push(groundMesh);

  build.centreline = buildRibbon(physics, scene, build, 720);
  addStartLine(scene, build, build.centreline);

  // Skid pad: a wide flat circle for steady-state cornering and doughnuts,
  // where most of the tyre tuning will actually happen.
  const skidPadCentre = SKIDPAD_CENTRE.clone();
  skidPadCentre.y = TRACK_BASE_Y;
  buildDisc(physics, scene, build, skidPadCentre, SKIDPAD_RADIUS, 96, 'tarmac');
  // Access lane from the top of the right lobe. It runs into the racing
  // surface, so it is laid just below it rather than flush with it.
  addPad(
    physics,
    scene,
    new THREE.Vector3(14, 0.3, 150),
    new THREE.Vector3(96, 0, 130),
    TRACK_BASE_Y - LANE_SINK,
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
    TRACK_BASE_Y - LANE_SINK,
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

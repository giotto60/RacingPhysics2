import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from './world';

export const GROUND_HALF_EXTENT = 200;
const GROUND_THICKNESS = 2; // thick enough that nothing can tunnel through it

/**
 * Flat untextured ground plane -- the placeholder world until the test
 * circuit lands. Collider is a thick box rather than a zero-thickness plane
 * so fast bodies cannot tunnel.
 */
export function createGround(physics: PhysicsWorld, scene: THREE.Scene): RAPIER.Collider {
  const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -GROUND_THICKNESS * 0.5, 0);
  const body = physics.world.createRigidBody(bodyDesc);
  const colliderDesc = RAPIER.ColliderDesc.cuboid(
    GROUND_HALF_EXTENT,
    GROUND_THICKNESS * 0.5,
    GROUND_HALF_EXTENT,
  )
    .setFriction(1.0)
    .setRestitution(0.0);
  const collider = physics.world.createCollider(colliderDesc, body);

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(GROUND_HALF_EXTENT * 2, GROUND_THICKNESS, GROUND_HALF_EXTENT * 2),
    new THREE.MeshLambertMaterial({ color: 0x2f3a44 }),
  );
  mesh.position.set(0, -GROUND_THICKNESS * 0.5, 0);
  scene.add(mesh);

  const grid = new THREE.GridHelper(GROUND_HALF_EXTENT * 2, GROUND_HALF_EXTENT, 0x556270, 0x3c4752);
  grid.position.y = 0.01;
  scene.add(grid);

  return collider;
}

import * as THREE from 'three';
import type { PropWorld, PropClass } from './props';
import { CLASS_COLOUR } from './props';

/**
 * Where the props go. Everything is placed to be hit deliberately, so the
 * user can compare the four response classes back to back without hunting.
 */

function labelSprite(text: string, colour: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 34px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `#${colour.toString(16).padStart(6, '0')}`;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
  );
  sprite.scale.set(24, 3, 1);
  return sprite;
}

function addLabel(
  scene: THREE.Scene,
  position: THREE.Vector3,
  propClass: PropClass,
  caption: string,
): void {
  const sprite = labelSprite(`${propClass} - ${caption}`, CLASS_COLOUR[propClass]);
  sprite.position.copy(position);
  sprite.position.y += 4;
  scene.add(sprite);
}

export function placeProps(props: PropWorld, scene: THREE.Scene): void {
  // --- Class A: cones on the racing line at the chicane exit ------------
  const chicaneExit = new THREE.Vector3(-28, 0, -50);
  for (let i = 0; i < 12; i += 1) {
    const row = Math.floor(i / 4);
    const col = i % 4;
    props.spawn(
      'cone',
      new THREE.Vector3(chicaneExit.x + col * 2.4 - 3.6, 0.4, chicaneExit.z + row * 3.2 - 3),
    );
  }
  for (let i = 0; i < 3; i += 1) {
    props.spawn('sign', new THREE.Vector3(chicaneExit.x - 8, 0.65, chicaneExit.z + i * 4));
  }
  addLabel(scene, chicaneExit, 'A', 'cosmetic');

  // --- Class B: tyre stacks and barrels in the hairpin runoff -----------
  const hairpinRunoff = new THREE.Vector3(-152, 0, -14);
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI * 0.5 + (i / 9) * Math.PI;
    props.spawn(
      'tyreStack',
      new THREE.Vector3(hairpinRunoff.x + Math.cos(a) * 5, 0.46, hairpinRunoff.z + Math.sin(a) * 15),
    );
  }
  for (let i = 0; i < 6; i += 1) {
    props.spawn('barrel', new THREE.Vector3(-146, 0.52, -34 - i * 6));
  }
  for (let i = 0; i < 6; i += 1) {
    props.spawn('crate', new THREE.Vector3(-142, 0.48, 8 + i * 2.4));
  }
  addLabel(scene, hairpinRunoff, 'B', 'consequential');

  // --- Class C: barriers and dumpsters lining the long straight ---------
  for (let i = 0; i < 14; i += 1) {
    props.spawn('barrier', new THREE.Vector3(161, 0.44, 18 - i * 5), Math.PI * 0.5);
  }
  for (let i = 0; i < 3; i += 1) {
    props.spawn('dumpster', new THREE.Vector3(163, 0.7, -60 - i * 10));
  }
  addLabel(scene, new THREE.Vector3(163, 0, -10), 'C', 'movable heavy');

  // --- Class D: solid walls around the outside of the hairpin -----------
  for (let i = 0; i < 12; i += 1) {
    const a = -Math.PI * 0.58 + (i / 11) * Math.PI * 1.16;
    const x = -134 - Math.cos(a) * 30;
    const z = -14 + Math.sin(a) * 30;
    props.spawn('wall', new THREE.Vector3(x, 1.25, z), a + Math.PI * 0.5);
  }
  addLabel(scene, new THREE.Vector3(-168, 0, -14), 'D', 'immovable');

  // --- Inert dummy cars, for car-versus-car response --------------------
  props.spawn('dummyCar', new THREE.Vector3(126, 0.65, 52), Math.PI * 0.25);
  props.spawn('dummyCar', new THREE.Vector3(156, 0.65, -20), Math.PI * 0.5);
  props.spawn('dummyCar', new THREE.Vector3(-60, 0.65, 56), -Math.PI * 0.35);
  addLabel(scene, new THREE.Vector3(-60, 0, 56), 'C', 'dummy car');
}

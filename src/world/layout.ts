import * as THREE from 'three';
import type { PropWorld, PropClass, PropKind } from './props';
import { CLASS_COLOUR, PROP_DEFS } from './props';
import { pointOnTrack } from './track';

/**
 * Where the props go.
 *
 * Everything that is meant to be hit sits on the racing surface, in the line
 * the car actually takes: a prop in the runoff is a prop that never gets
 * tested. Only the immovable class stays off the road, because its job is to
 * be the thing you bounce off rather than the thing you drive through.
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

export function placeProps(
  props: PropWorld,
  scene: THREE.Scene,
  centreline: THREE.Vector3[],
): void {
  /** Drop a prop on the road at lap fraction `t`, `lateral` metres off centre. */
  const onRoad = (
    kind: PropKind,
    t: number,
    lateral: number,
    alongOffset = 0,
    yawOffset = 0,
  ): THREE.Vector3 => {
    const spot = pointOnTrack(centreline, t + alongOffset / centreline.length, lateral);
    spot.position.y += PROP_DEFS[kind].size.y + 0.02;
    props.spawn(kind, spot.position, spot.heading + yawOffset);
    return spot.position;
  };

  // --- Class A: cones scattered down the racing line ---------------------
  let coneAt = new THREE.Vector3();
  [0.05, 0.44, 0.76].forEach((t, cluster) => {
    for (let i = 0; i < 10; i += 1) {
      const row = Math.floor(i / 2);
      const side = i % 2 === 0 ? -1 : 1;
      coneAt = onRoad('cone', t, side * (1.4 + row * 0.9), row * 7 + cluster);
    }
  });
  [0.05, 0.44].forEach((t) => {
    for (let i = 0; i < 2; i += 1) onRoad('sign', t, i === 0 ? -4.8 : 4.8, 24);
  });
  addLabel(scene, coneAt, 'A', 'cosmetic');

  // --- Class B: barrels, tyre stacks and crates, all on the road ---------
  let bAt = new THREE.Vector3();
  for (let i = 0; i < 8; i += 1) {
    bAt = onRoad('barrel', 0.54, (i % 2 === 0 ? -1 : 1) * 2.6, i * 6);
  }
  for (let i = 0; i < 9; i += 1) {
    onRoad('tyreStack', 0.7, -4.5 + i * 1.15, i * 2);
  }
  for (let i = 0; i < 8; i += 1) {
    onRoad('crate', 0.86, (i % 2 === 0 ? -3 : 3), i * 5);
  }
  addLabel(scene, bAt, 'B', 'consequential');

  // --- Class C: a barrier chicane and dumpsters narrowing the straight ---
  let cAt = new THREE.Vector3();
  for (let i = 0; i < 5; i += 1) {
    cAt = onRoad('barrier', 0.36, -5 + i * 0.4, i * 5, Math.PI * 0.5);
  }
  for (let i = 0; i < 5; i += 1) {
    onRoad('barrier', 0.4, 5 - i * 0.4, i * 5, Math.PI * 0.5);
  }
  for (let i = 0; i < 3; i += 1) {
    onRoad('dumpster', 0.49, i % 2 === 0 ? -3.4 : 3.4, i * 9);
  }
  addLabel(scene, cAt, 'C', 'movable heavy');

  // --- Parked cars in three sizes, for car-versus-car response -----------
  const carAt = onRoad('carSmall', 0.11, -3.2, 0);
  onRoad('carSmall', 0.24, 3.4, 0, 0.3);
  onRoad('dummyCar', 0.32, -3.6, 0);
  onRoad('dummyCar', 0.58, 3.2, 0, -0.25);
  onRoad('dummyCar', 0.9, -2.8, 0);
  onRoad('carLarge', 0.5, -3.8, 0);
  onRoad('carLarge', 0.81, 3.6, 0, 0.2);
  addLabel(scene, carAt, 'C', 'parked cars');

  // --- Class D: solid walls around the outside of the hairpin -----------
  for (let i = 0; i < 12; i += 1) {
    const a = -Math.PI * 0.58 + (i / 11) * Math.PI * 1.16;
    const x = -134 - Math.cos(a) * 30;
    const z = -14 + Math.sin(a) * 30;
    props.spawn('wall', new THREE.Vector3(x, 1.25, z), a + Math.PI * 0.5);
  }
  addLabel(scene, new THREE.Vector3(-168, 0, -14), 'D', 'immovable');
}

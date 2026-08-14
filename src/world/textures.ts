import * as THREE from 'three';
import type { SurfaceType } from '../core/params';

/**
 * Procedural surface textures.
 *
 * Nothing is loaded from disk: every texture is drawn into a canvas at boot, so
 * the build stays a single self-contained bundle. The point is not decoration
 * -- an untextured surface gives the eye nothing to measure speed against, so
 * grain and markings are a legibility feature.
 */

const TILE = 256;

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

interface Speckle {
  count: number;
  radius: number;
  colour: string;
}

function grainCanvas(base: number, grain: number, speckles: Speckle[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d')!;

  const image = ctx.createImageData(TILE, TILE);
  const r = (base >> 16) & 255;
  const g = (base >> 8) & 255;
  const b = base & 255;
  for (let i = 0; i < TILE * TILE; i += 1) {
    // Sum of three uniforms: roughly gaussian, so the grain reads as material
    // rather than as television static.
    const n = (Math.random() + Math.random() + Math.random() - 1.5) * grain;
    image.data[i * 4 + 0] = clamp255(r + n);
    image.data[i * 4 + 1] = clamp255(g + n * 0.9);
    image.data[i * 4 + 2] = clamp255(b + n * 0.8);
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  for (const speckle of speckles) {
    ctx.fillStyle = speckle.colour;
    for (let i = 0; i < speckle.count; i += 1) {
      const x = Math.random() * TILE;
      const y = Math.random() * TILE;
      ctx.beginPath();
      ctx.ellipse(
        x,
        y,
        speckle.radius * (0.35 + Math.random()),
        speckle.radius * (0.35 + Math.random()),
        Math.random() * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  return canvas;
}

function kerbCanvas(): HTMLCanvasElement {
  const canvas = grainCanvas(0xb14a44, 12, []);
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < 4; i += 1) {
    ctx.fillStyle = 'rgba(226,228,231,0.94)';
    ctx.fillRect(0, i * 64 + 32, TILE, 32);
  }
  return canvas;
}

const recipes: Record<SurfaceType, () => HTMLCanvasElement> = {
  tarmac: () =>
    grainCanvas(0x3a3f45, 22, [
      { count: 260, radius: 2.0, colour: 'rgba(126,134,144,0.18)' },
      { count: 120, radius: 3.2, colour: 'rgba(18,20,24,0.30)' },
    ]),
  dirt: () =>
    grainCanvas(0x7a5c3a, 30, [
      { count: 200, radius: 3.4, colour: 'rgba(60,42,26,0.30)' },
      { count: 140, radius: 2.2, colour: 'rgba(168,134,90,0.28)' },
    ]),
  grass: () =>
    grainCanvas(0x3d5f36, 24, [
      { count: 320, radius: 3.0, colour: 'rgba(74,102,58,0.34)' },
      { count: 180, radius: 2.0, colour: 'rgba(38,60,32,0.36)' },
    ]),
  gravel: () =>
    grainCanvas(0x8a8577, 30, [
      { count: 420, radius: 2.4, colour: 'rgba(196,192,180,0.34)' },
      { count: 260, radius: 2.0, colour: 'rgba(88,84,74,0.34)' },
    ]),
  kerb: kerbCanvas,
};

const cache = new Map<string, THREE.Texture>();

function cached(key: string, make: () => HTMLCanvasElement): THREE.Texture {
  const existing = cache.get(key);
  if (existing) return existing;
  const texture = new THREE.CanvasTexture(make());
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  cache.set(key, texture);
  return texture;
}

/** A tiling texture for a surface, repeated `repeatX` by `repeatY` times. */
export function surfaceTexture(
  surface: SurfaceType,
  repeatX: number,
  repeatY: number,
): THREE.Texture {
  const texture = cached(surface, recipes[surface]).clone();
  texture.needsUpdate = true;
  texture.repeat.set(repeatX, repeatY);
  return texture;
}

/**
 * The road ribbon gets its own texture: u runs across the full track width, so
 * edge lines and a dashed centre line can be baked straight in and follow the
 * curve for free.
 */
export function roadTexture(repeatAlong: number): THREE.Texture {
  const key = 'road';
  const existing = cache.get(key);
  const source =
    existing ??
    (() => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 512;
      const ctx = canvas.getContext('2d')!;
      const grain = grainCanvas(0x3a3f45, 22, [
        { count: 300, radius: 2.0, colour: 'rgba(126,134,144,0.18)' },
        { count: 150, radius: 3.2, colour: 'rgba(18,20,24,0.30)' },
      ]);
      ctx.drawImage(grain, 0, 0, 128, 256);
      ctx.drawImage(grain, 0, 256, 128, 256);

      ctx.fillStyle = 'rgba(222,226,230,0.82)';
      ctx.fillRect(4, 0, 5, 512);
      ctx.fillRect(119, 0, 5, 512);
      for (let i = 0; i < 4; i += 1) {
        ctx.fillRect(62, i * 128 + 20, 4, 88);
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 4;
      cache.set(key, texture);
      return texture;
    })();

  const texture = source.clone();
  texture.needsUpdate = true;
  texture.repeat.set(1, repeatAlong);
  return texture;
}

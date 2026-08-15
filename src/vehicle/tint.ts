import * as THREE from 'three';

/**
 * Recolouring a car that wears a painted texture.
 *
 * Both kits put their colour in the texture -- Kenney's whole catalogue shares
 * one palette image -- so multiplying the material's colour only darkens the
 * paint towards the tint rather than changing it. Rotating the hue of the image
 * itself gives a genuinely different car, and works the same for a palette
 * atlas and for the Pony's photographic maps.
 */

const cache = new Map<string, THREE.Texture>();

function drawable(image: unknown): CanvasImageSource | null {
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) return image;
  if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) return image;
  if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) return image;
  return null;
}

/** Rotate every pixel's hue by `degrees`, keeping saturation and lightness. */
export function hueShifted(source: THREE.Texture, degrees: number): THREE.Texture {
  const key = `${source.uuid}:${Math.round(degrees)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const image = drawable(source.image);
  const width = (source.image as { width?: number })?.width ?? 0;
  const height = (source.image as { height?: number })?.height ?? 0;
  if (!image || width === 0 || height === 0) return source;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, width, height);

  const data = ctx.getImageData(0, 0, width, height);
  const px = data.data;
  const colour = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };
  const shift = ((degrees % 360) + 360) / 360;
  for (let i = 0; i < px.length; i += 4) {
    colour.setRGB(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255);
    colour.getHSL(hsl);
    // Leave the greys alone: rotating them does nothing anyway, and skipping
    // them keeps glass, tyres and chrome looking like glass, tyres and chrome.
    if (hsl.s < 0.12) continue;
    colour.setHSL((hsl.h + shift) % 1, hsl.s, hsl.l);
    px[i] = Math.round(colour.r * 255);
    px[i + 1] = Math.round(colour.g * 255);
    px[i + 2] = Math.round(colour.b * 255);
  }
  ctx.putImageData(data, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = source.flipY;
  texture.wrapS = source.wrapS;
  texture.wrapT = source.wrapT;
  texture.colorSpace = source.colorSpace;
  texture.anisotropy = source.anisotropy;
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
}

/**
 * Repaint every mesh under `root`. Materials are cloned first, because the
 * model cache hands the same ones to every car wearing that model.
 */
export function repaint(root: THREE.Object3D, degrees: number, fallback: number): void {
  if (degrees === 0) return;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const source = mesh.material;
    const recolour = (from: THREE.Material): THREE.Material => {
      const material = from.clone() as THREE.MeshStandardMaterial;
      if (material.map) material.map = hueShifted(material.map, degrees);
      else if (material.color) material.color.setHex(fallback);
      return material;
    };
    mesh.material = Array.isArray(source) ? source.map(recolour) : recolour(source);
  });
}

import type { SurfaceType } from '../core/params';

/**
 * Surface lookup. Every static collider registers the surface it represents;
 * wheels read it from the raycast hit so grip is decided per wheel, not per car.
 */
const surfaceByCollider = new Map<number, SurfaceType>();

export function registerSurface(colliderHandle: number, surface: SurfaceType): void {
  surfaceByCollider.set(colliderHandle, surface);
}

export function surfaceOf(colliderHandle: number): SurfaceType {
  return surfaceByCollider.get(colliderHandle) ?? 'tarmac';
}

export function clearSurfaces(): void {
  surfaceByCollider.clear();
}

export const surfaceColour: Record<SurfaceType, number> = {
  tarmac: 0x3a3f45,
  dirt: 0x7a5c3a,
  grass: 0x3d5f36,
  gravel: 0x8a8577,
  kerb: 0xb14a44,
};

/** Colour of the dust or spray a wheel throws up on this surface. */
export const surfaceDust: Record<SurfaceType, number> = {
  tarmac: 0x9aa2ab,
  dirt: 0xa8825a,
  grass: 0x6d8f5c,
  gravel: 0xb5b0a0,
  kerb: 0xc0bcb4,
};

/** Loose surfaces spray; tarmac and kerb lay rubber instead. */
export const surfaceIsLoose: Record<SurfaceType, boolean> = {
  tarmac: false,
  dirt: true,
  grass: true,
  gravel: true,
  kerb: false,
};

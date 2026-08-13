import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Collision groups and per-class physics materials.
 *
 * Friction and restitution are authored per material class so rubber on
 * concrete, steel on steel and plastic on tarmac each behave visibly
 * differently. Rapier combines the two colliders' values, so the rules are
 * set to multiply/average rather than picking one side.
 */

export const STATIC_GROUP = 0x0001;
export const CAR_GROUP = 0x0002;
export const PROP_GROUP = 0x0004;
export const DEBRIS_GROUP = 0x0008;

export function interactionGroups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export type MaterialName =
  | 'tarmac'
  | 'concrete'
  | 'rubber'
  | 'steel'
  | 'plastic'
  | 'wood'
  | 'carBody'
  | 'loose';

export interface PhysicsMaterial {
  friction: number;
  restitution: number;
}

export const materials: Record<MaterialName, PhysicsMaterial> = {
  tarmac: { friction: 1.0, restitution: 0.02 },
  concrete: { friction: 0.85, restitution: 0.06 },
  rubber: { friction: 1.25, restitution: 0.28 },
  steel: { friction: 0.42, restitution: 0.22 },
  plastic: { friction: 0.55, restitution: 0.55 },
  wood: { friction: 0.62, restitution: 0.18 },
  carBody: { friction: 0.4, restitution: 0.08 },
  loose: { friction: 0.72, restitution: 0.05 },
};

export function applyMaterial(desc: RAPIER.ColliderDesc, name: MaterialName): RAPIER.ColliderDesc {
  const m = materials[name];
  return desc
    .setFriction(m.friction)
    .setRestitution(m.restitution)
    .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
    .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
}

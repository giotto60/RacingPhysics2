import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Rapier world wrapper.
 *
 * Rapier is responsible only for rigid body integration, collision detection
 * and contact resolution. Suspension and tyre forces are computed in our own
 * code and applied as forces at world points (see later milestones); the
 * built-in vehicle controller is deliberately unused.
 */

export interface PhysicsConfig {
  gravity: number;
  /** Solver substeps per step -- raised so stacked props settle without jitter. */
  numSolverIterations: number;
  numAdditionalFrictionIterations: number;
  numInternalPgsIterations: number;
}

export const defaultPhysicsConfig: PhysicsConfig = {
  gravity: -9.81,
  numSolverIterations: 8,
  numAdditionalFrictionIterations: 8,
  numInternalPgsIterations: 2,
};

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly config: PhysicsConfig;
  readonly eventQueue: RAPIER.EventQueue;

  constructor(config: PhysicsConfig, stepSeconds: number) {
    this.config = config;
    this.world = new RAPIER.World({ x: 0, y: config.gravity, z: 0 });
    this.world.timestep = stepSeconds;
    this.eventQueue = new RAPIER.EventQueue(true);
    this.applySolverConfig();
  }

  applySolverConfig(): void {
    this.world.numSolverIterations = this.config.numSolverIterations;
    this.world.numAdditionalFrictionIterations = this.config.numAdditionalFrictionIterations;
    this.world.numInternalPgsIterations = this.config.numInternalPgsIterations;
    this.world.gravity = { x: 0, y: this.config.gravity, z: 0 };
  }

  step(): void {
    this.world.step(this.eventQueue);
  }
}

let initialised = false;

export async function initRapier(): Promise<typeof RAPIER> {
  if (!initialised) {
    await RAPIER.init();
    initialised = true;
  }
  return RAPIER;
}

export { RAPIER };

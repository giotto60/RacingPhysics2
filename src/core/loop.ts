/**
 * Fixed-timestep accumulator loop.
 *
 * Physics steps at a constant rate (120 Hz) regardless of display refresh.
 * Rendering happens once per animation frame with an interpolation alpha so
 * visual transforms can be blended between the previous and current physics
 * states. No force calculation anywhere in the project may consume a raw
 * frame delta -- only FixedLoop.stepSeconds.
 */

export interface LoopHooks {
  /** Advance simulation by exactly `dt` seconds. */
  step(dt: number): void;
  /** Draw. `alpha` in [0,1] is the blend between previous and current state. */
  render(alpha: number, frameDelta: number): void;
}

export interface LoopStats {
  fps: number;
  stepsLastFrame: number;
  simSeconds: number;
  physicsMs: number;
  renderMs: number;
}

const MAX_FRAME_DELTA = 0.25; // clamp so a tab-out never floods the accumulator

export class FixedLoop {
  readonly hz: number;
  readonly stepSeconds: number;

  /** Global time scale: 1 = realtime, <1 = slow motion, 0 = frozen. */
  timeScale = 1;
  /** When paused, only single-step requests advance the simulation. */
  paused = false;

  readonly stats: LoopStats = {
    fps: 0,
    stepsLastFrame: 0,
    simSeconds: 0,
    physicsMs: 0,
    renderMs: 0,
  };

  private hooks: LoopHooks;
  private accumulator = 0;
  private lastTime = 0;
  private pendingSingleSteps = 0;
  private running = false;
  private rafHandle = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;

  constructor(hooks: LoopHooks, hz = 120) {
    this.hooks = hooks;
    this.hz = hz;
    this.stepSeconds = 1 / hz;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
  }

  /** Queue `n` physics steps to run even while paused. */
  singleStep(n = 1): void {
    this.pendingSingleSteps += n;
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.tick);

    let frameDelta = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (frameDelta > MAX_FRAME_DELTA) frameDelta = MAX_FRAME_DELTA;
    if (frameDelta < 0) frameDelta = 0;

    this.fpsAccum += frameDelta;
    this.fpsFrames += 1;
    if (this.fpsAccum >= 0.25) {
      this.stats.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    if (!this.paused) {
      this.accumulator += frameDelta * this.timeScale;
    }
    while (this.pendingSingleSteps > 0) {
      this.accumulator += this.stepSeconds;
      this.pendingSingleSteps -= 1;
    }

    // Bound catch-up work so a slow machine degrades instead of spiralling.
    const maxSteps = Math.max(1, Math.ceil((MAX_FRAME_DELTA / this.stepSeconds) * 1.0));
    let steps = 0;
    const physicsStart = performance.now();
    while (this.accumulator >= this.stepSeconds && steps < maxSteps) {
      this.hooks.step(this.stepSeconds);
      this.accumulator -= this.stepSeconds;
      this.stats.simSeconds += this.stepSeconds;
      steps += 1;
    }
    if (steps >= maxSteps) this.accumulator = 0;
    this.stats.physicsMs = performance.now() - physicsStart;
    this.stats.stepsLastFrame = steps;

    const alpha = this.stepSeconds > 0 ? this.accumulator / this.stepSeconds : 0;
    const renderStart = performance.now();
    this.hooks.render(Math.min(1, Math.max(0, alpha)), frameDelta);
    this.stats.renderMs = performance.now() - renderStart;
  };
}

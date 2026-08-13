export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const smoothstep = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/** Move `current` toward `target` at `rate` units per second. Frame-rate independent. */
export const approach = (current: number, target: number, rate: number, dt: number): number => {
  const delta = target - current;
  const step = rate * dt;
  if (Math.abs(delta) <= step) return target;
  return current + Math.sign(delta) * step;
};

/** Exponential smoothing that behaves identically at any timestep. */
export const damp = (current: number, target: number, halfLife: number, dt: number): number => {
  if (halfLife <= 0) return target;
  const k = 1 - Math.pow(0.5, dt / halfLife);
  return current + (target - current) * k;
};

export const signedPow = (v: number, exponent: number): number =>
  Math.sign(v) * Math.pow(Math.abs(v), exponent);

/** Shortest signed angular difference, radians. */
export const angleDelta = (from: number, to: number): number => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

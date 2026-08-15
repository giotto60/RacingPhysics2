/**
 * The single source of truth for every tunable quantity in the project.
 *
 * Everything here is plain data so it can be bound live by lil-gui, cloned,
 * diffed, serialised to localStorage and exported as JSON. Nothing in the
 * simulation may hold a private copy of one of these values -- read through
 * the live object every step so edits apply without a reload.
 *
 * Axis convention throughout the project: +Y is up, the car's forward is
 * local -Z, the car's right is local +X. So the longitudinal axis is Z, the
 * lateral axis is X, and yaw is about Y.
 */

export type DriveLayout = 'RWD' | 'FWD' | 'AWD';
export type CameraMode = 'A-fixed' | 'B-follow';
export type SurfaceType = 'tarmac' | 'dirt' | 'grass' | 'gravel' | 'kerb';

export interface Params {
  chassis: {
    mass: number;
    /** Authored centre of mass, chassis-local metres. Rearward = +Z. */
    comX: number;
    comY: number;
    comZ: number;
    /** Authored principal moments, kg m^2. Roll is about Z, pitch about X, yaw about Y. */
    inertiaRoll: number;
    inertiaPitch: number;
    inertiaYaw: number;
    /** Quadratic drag: F = -k |v| v. Sets natural top speed. */
    dragCoefficient: number;
    /**
     * Rolling resistance coefficient: newtons of retarding force per newton of
     * vertical load. Applied as a torque at the wheel rather than a force at
     * the contact patch -- see `Car.integrateWheel` for why that matters.
     */
    rollingResistance: number;
    hullLength: number;
    hullWidth: number;
    hullHeight: number;
    /** Hull centre height above the chassis origin -- keeps it clear of kerbs. */
    hullOffsetY: number;
  };

  suspension: {
    wheelbase: number;
    trackFront: number;
    trackRear: number;
    wheelRadius: number;
    wheelWidth: number;
    /** Hardpoint height relative to the chassis origin. */
    hardpointY: number;
    restLength: number;
    maxTravel: number;
    /**
     * Rate of the rubber bump stop the suspension hits at full travel, N/m.
     * Without one the spring simply saturates and the chassis sinks into the
     * road on a hard landing.
     */
    bumpStopStiffness: number;
    bumpStopDamping: number;
    stiffnessFront: number;
    stiffnessRear: number;
    dampingFront: number;
    dampingRear: number;
    maxForce: number;
    antiRollFront: number;
    antiRollRear: number;
  };

  tyre: {
    peakGrip: number;
    /** Slip angle at which lateral grip peaks, degrees. */
    peakSlipAngle: number;
    /** Slip ratio at which longitudinal grip peaks. */
    peakSlipRatio: number;
    /** How fast grip decays past the peak. Low = forgiving. */
    falloffSharpness: number;
    /** Grip retained deep in a slide, as a fraction of peak. */
    tailGrip: number;
    /** Load sensitivity exponent, < 1 so grip rises less than proportionally. */
    loadSensitivity: number;
    referenceLoad: number;
    combinedSlip: boolean;
    /** Grip multiplier while a tyre is past the limit. */
    slidingGrip: number;
    /** How fast a sliding tyre recovers, per second. Low = readable. */
    gripRecoveryRate: number;
    /** How fast a tyre loses grip once saturated, per second. */
    gripLossRate: number;
    wheelInertia: number;
    surfaceGrip: Record<SurfaceType, number>;
  };

  drivetrain: {
    layout: DriveLayout;
    /** Fraction of torque to the front axle in AWD. */
    awdFrontSplit: number;
    /** Engine torque in Nm sampled every 1000 rpm from 1000 to 8000. */
    torqueCurve: number[];
    idleRPM: number;
    limiterRPM: number;
    finalDrive: number;
    gearRatios: number[];
    reverseRatio: number;
    shiftUpRPM: number;
    shiftDownRPM: number;
    shiftCutTime: number;
    /** Guard band the next gear's rpm must clear before a shift is allowed. */
    shiftHysteresisRPM: number;
    /** Minimum seconds between two shifts. */
    shiftHoldTime: number;
    drivelineEfficiency: number;
    brakeTorqueFront: number;
    brakeTorqueRear: number;
    reverseTorqueScale: number;
    lsdOpen: boolean;
    lsdPreload: number;
    lsdPowerLock: number;
    lsdCoastLock: number;
  };

  steering: {
    maxAngle: number;
    /** Steering limit multiplier at and above `speedForMinLimit`. */
    minLimitFactor: number;
    speedForMinLimit: number;
    /** Shape of the speed-sensitive falloff. */
    limitCurve: number;
    ackermann: number;
    rateToTarget: number;
    returnRate: number;
    deadzone: number;
    inputCurve: number;
    driftAssist: number;
    driftAssistMaxAngle: number;
  };

  airborne: {
    angularDamping: number;
    yawAuthority: number;
    pitchAuthority: number;
  };

  expression: {
    /** Which car model is drawn. See `vehicle/models.ts` for the catalogue. */
    carModel: string;
    visualRollMultiplier: number;
    visualPitchMultiplier: number;
    skidThreshold: number;
    skidOpacity: number;
    dustRate: number;
    /**
     * Contact-patch sliding speed a tyre must actually reach before it marks
     * or sprays, m/s. Grip utilisation alone goes high at a crawl, which is
     * how a stationary car ends up throwing gravel.
     */
    minSlipSpeed: number;
    audioEnabled: boolean;
    masterVolume: number;
    engineVolume: number;
    scrubVolume: number;
    impactVolume: number;
    deformation: number;
    /** Scene brightness, 1 = full daylight. Lower it to see the headlights. */
    daylight: number;
    /** Sun shadows: what makes the key light stop at solid objects. */
    shadows: boolean;
    /** Headlight beams occluded by whatever they hit. Costs two shadow passes. */
    headlightShadows: boolean;
    headlights: boolean;
    headlightIntensity: number;
    headlightRange: number;
    /** Debris closer to the camera than this fades out so it stops occluding. */
    debrisFadeDistance: number;
    /** Bias applied to prop impulses, pushing them away from the racing line. */
    debrisScatterBias: number;
  };

  collision: {
    exceptionsEnabled: boolean;
    /** Fraction of tangential velocity restored after a wall impact. */
    wallTangentPreservation: number;
    /** How much a head-on angle amplifies the speed penalty. */
    wallAngleScale: number;
    /** Automatic steer away from a scraped surface, radians of target offset. */
    wallSteerNudge: number;
    suppressVerticalImpulse: boolean;
    maxInducedYawRate: number;
    carRestitution: number;
    /** Rapier contact softness -- lower is squashier. */
    contactFrequency: number;
    scuffThreshold: number;
    bumpThreshold: number;
    crashThreshold: number;
    shakeScale: number;
    timeDilation: number;
    timeDilationDuration: number;
    maxDynamicProps: number;
    massCone: number;
    massBarrel: number;
    massTyreStack: number;
    massCrate: number;
    massBarrier: number;
    massDumpster: number;
    massCarSmall: number;
    massDummyCar: number;
    massCarLarge: number;
    restitutionCone: number;
    restitutionBarrel: number;
    restitutionTyreStack: number;
    restitutionCrate: number;
    restitutionBarrier: number;
    restitutionDumpster: number;
  };

  camera: {
    mode: CameraMode;
    /** World yaw the fixed camera sits at, degrees. Any angle is valid. */
    fixedYaw: number;
    /** Angle the follow camera trails the car from, degrees off its heading. */
    followOffset: number;
    /** Half-life in seconds for the yaw-follow damping in mode B. */
    yawDamping: number;
    /** Metres of lead per m/s of speed. */
    leadFactor: number;
    /** Extra view height per m/s of speed. */
    pullbackFactor: number;
    baseViewHeight: number;
    pitch: number;
    followDamping: number;
  };
}

export const defaultParams = (): Params => ({
  chassis: {
    mass: 1200,
    comX: 0,
    comY: -0.3,
    comZ: 0.05,
    inertiaRoll: 480,
    inertiaPitch: 1650,
    inertiaYaw: 1800,
    dragCoefficient: 0.62,
    rollingResistance: 0.12,
    hullLength: 4.2,
    hullWidth: 1.8,
    hullHeight: 0.8,
    hullOffsetY: 0.05,
  },

  suspension: {
    wheelbase: 2.6,
    trackFront: 1.56,
    trackRear: 1.56,
    wheelRadius: 0.32,
    wheelWidth: 0.24,
    hardpointY: -0.2,
    restLength: 0.35,
    maxTravel: 0.25,
    bumpStopStiffness: 420000,
    bumpStopDamping: 9000,
    stiffnessFront: 45000,
    stiffnessRear: 42000,
    dampingFront: 4000,
    dampingRear: 3700,
    maxForce: 34000,
    antiRollFront: 16000,
    antiRollRear: 12000,
  },

  tyre: {
    // Half again the grip the car was first tuned with, to match the torque.
    peakGrip: 2.18,
    peakSlipAngle: 9,
    peakSlipRatio: 0.14,
    falloffSharpness: 1.1,
    tailGrip: 0.78,
    loadSensitivity: 0.86,
    referenceLoad: 3200,
    combinedSlip: true,
    slidingGrip: 0.82,
    gripRecoveryRate: 1.4,
    gripLossRate: 7,
    wheelInertia: 1.3,
    surfaceGrip: {
      tarmac: 1.0,
      dirt: 0.62,
      grass: 0.48,
      gravel: 0.55,
      kerb: 0.85,
    },
  },

  drivetrain: {
    layout: 'RWD',
    awdFrontSplit: 0.4,
    // Half again the torque the car was first tuned with: it was accurate for a
    // 1200 kg road car and too polite to be worth driving.
    torqueCurve: [225, 323, 398, 450, 480, 495, 458, 375],
    idleRPM: 900,
    limiterRPM: 7600,
    finalDrive: 3.9,
    gearRatios: [3.2, 2.1, 1.5, 1.15, 0.95, 0.8],
    // Geared low enough to pull hard and to cap the car at a sane speed
    // backwards: the ratio, not a throttle scale, is what a real gearbox uses.
    reverseRatio: 4.6,
    shiftUpRPM: 7000,
    shiftDownRPM: 3000,
    shiftCutTime: 0.09,
    shiftHysteresisRPM: 600,
    shiftHoldTime: 0.55,
    drivelineEfficiency: 0.9,
    brakeTorqueFront: 3600,
    brakeTorqueRear: 2400,
    // Reverse used to be geared and throttled so far down that rolling
    // resistance ate most of it: 3.1 m/s after six seconds of trying.
    reverseTorqueScale: 0.8,
    lsdOpen: false,
    lsdPreload: 90,
    lsdPowerLock: 0.45,
    lsdCoastLock: 0.2,
  },

  steering: {
    maxAngle: 34,
    minLimitFactor: 0.3,
    speedForMinLimit: 55,
    limitCurve: 1.4,
    ackermann: 0.85,
    rateToTarget: 330,
    returnRate: 420,
    deadzone: 0.08,
    inputCurve: 1.6,
    driftAssist: 0.35,
    driftAssistMaxAngle: 12,
  },

  airborne: {
    angularDamping: 2.4,
    yawAuthority: 1600,
    pitchAuthority: 2200,
  },

  expression: {
    carModel: 'sedan',
    visualRollMultiplier: 1.75,
    visualPitchMultiplier: 1.75,
    skidThreshold: 0.22,
    skidOpacity: 0.85,
    dustRate: 1.0,
    minSlipSpeed: 1.2,
    audioEnabled: true,
    masterVolume: 0.7,
    engineVolume: 0.5,
    scrubVolume: 0.9,
    impactVolume: 0.8,
    deformation: 1.0,
    daylight: 0.72,
    shadows: true,
    headlightShadows: true,
    headlights: true,
    headlightIntensity: 1.0,
    headlightRange: 46,
    debrisFadeDistance: 7,
    debrisScatterBias: 0.35,
  },

  collision: {
    exceptionsEnabled: true,
    wallTangentPreservation: 0.85,
    wallAngleScale: 1.0,
    wallSteerNudge: 0.12,
    suppressVerticalImpulse: true,
    maxInducedYawRate: 1.1,
    carRestitution: 0.08,
    // Stiff enough that a hard landing does not push the hull into the road
    // before the solver catches it.
    contactFrequency: 55,
    scuffThreshold: 1500,
    bumpThreshold: 12000,
    crashThreshold: 45000,
    shakeScale: 1.0,
    timeDilation: 0.35,
    timeDilationDuration: 0.4,
    maxDynamicProps: 80,
    massCone: 4,
    massBarrel: 55,
    massTyreStack: 90,
    massCrate: 70,
    massBarrier: 900,
    massDumpster: 1300,
    massCarSmall: 950,
    massDummyCar: 1200,
    massCarLarge: 2600,
    restitutionCone: 0.55,
    restitutionBarrel: 0.3,
    restitutionTyreStack: 0.25,
    restitutionCrate: 0.2,
    restitutionBarrier: 0.1,
    restitutionDumpster: 0.08,
  },

  camera: {
    mode: 'B-follow',
    fixedYaw: 45,
    followOffset: 0,
    yawDamping: 0.45,
    leadFactor: 0.32,
    pullbackFactor: 0.34,
    baseViewHeight: 26,
    pitch: Math.atan(Math.SQRT1_2),
    followDamping: 0.06,
  },
});

// --- Presets -------------------------------------------------------------

export interface Preset {
  name: string;
  params: Params;
}

const withOverrides = (fn: (p: Params) => void): Params => {
  const p = defaultParams();
  fn(p);
  return p;
};

export const builtinPresets = (): Preset[] => [
  {
    name: 'Grippy',
    params: withOverrides((p) => {
      p.tyre.peakGrip = 1.75;
      p.tyre.falloffSharpness = 0.8;
      p.tyre.tailGrip = 0.86;
      p.tyre.gripRecoveryRate = 2.2;
      p.suspension.stiffnessFront = 58000;
      p.suspension.stiffnessRear = 55000;
      p.suspension.dampingFront = 4900;
      p.suspension.dampingRear = 4600;
      p.suspension.antiRollFront = 20000;
      p.suspension.antiRollRear = 18000;
      p.drivetrain.lsdPowerLock = 0.6;
    }),
  },
  {
    name: 'Loose',
    params: withOverrides((p) => {
      p.tyre.peakGrip = 1.15;
      p.tyre.peakSlipAngle = 11;
      p.tyre.falloffSharpness = 1.5;
      p.tyre.tailGrip = 0.7;
      p.tyre.gripRecoveryRate = 0.9;
      p.chassis.comZ = 0.35;
      p.chassis.inertiaYaw = 1450;
      p.suspension.antiRollRear = 21000;
      p.suspension.antiRollFront = 9000;
      p.steering.driftAssist = 0.5;
      p.drivetrain.lsdPowerLock = 0.7;
    }),
  },
  {
    name: 'Heavy',
    params: withOverrides((p) => {
      p.chassis.mass = 1850;
      p.chassis.inertiaYaw = 3100;
      p.chassis.inertiaPitch = 2900;
      p.chassis.inertiaRoll = 820;
      p.chassis.comY = -0.22;
      p.suspension.stiffnessFront = 68000;
      p.suspension.stiffnessRear = 65000;
      p.suspension.dampingFront = 6100;
      p.suspension.dampingRear = 5800;
      p.suspension.maxForce = 52000;
      p.tyre.referenceLoad = 4600;
      p.drivetrain.brakeTorqueFront = 5200;
      p.drivetrain.brakeTorqueRear = 3600;
      p.steering.rateToTarget = 240;
      p.steering.maxAngle = 30;
    }),
  },
];

// --- Serialisation -------------------------------------------------------

/** Deep-merge `source` into `target` in place, keeping `target`'s identity. */
export function applyParams(target: Params, source: unknown): void {
  const merge = (dst: Record<string, unknown>, src: Record<string, unknown>): void => {
    for (const key of Object.keys(dst)) {
      if (!(key in src)) continue;
      const dv = dst[key];
      const sv = src[key];
      if (Array.isArray(dv) && Array.isArray(sv)) {
        dst[key] = sv.slice();
      } else if (dv && sv && typeof dv === 'object' && typeof sv === 'object') {
        merge(dv as Record<string, unknown>, sv as Record<string, unknown>);
      } else if (typeof dv === typeof sv) {
        dst[key] = sv;
      }
    }
  };
  if (source && typeof source === 'object') {
    merge(target as unknown as Record<string, unknown>, source as Record<string, unknown>);
  }
}

const STORAGE_KEY = 'racingphysics2.presets';

export function loadStoredPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Preset[]) : [];
  } catch {
    return [];
  }
}

export function storePresets(presets: Preset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    /* storage unavailable -- presets stay in-memory for this session */
  }
}

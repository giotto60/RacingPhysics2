import GUI from 'lil-gui';
import {
  applyParams,
  builtinPresets,
  defaultParams,
  loadStoredPresets,
  storePresets,
  type Params,
  type Preset,
} from '../core/params';

export interface PanelHooks {
  onChassisChanged(): void;
  onSuspensionGeometryChanged(): void;
  onHullChanged(): void;
  onPropMassChanged(): void;
  onSolverChanged(): void;
  onPresetApplied(): void;
  respawn(): void;
  fullReset(): void;
  resetProps(): void;
  clearMarks(): void;
  teleportSkidPad(): void;
  teleportSurfaceStrip(): void;
  toggleTelemetry(): void;
  toggleFrictionCircles(): void;
  toggleDebugDraw(): void;
  singleStep(): void;
  startAudio(): void;
}

export interface LoopControls {
  paused: boolean;
  timeScale: number;
}

/**
 * The user's only interface. Folders mirror the physics specification, every
 * named quantity in the brief appears, and every change applies immediately
 * with no reload.
 */
export class DebugPanel {
  readonly gui: GUI;
  private presets: Preset[] = [];
  private presetName = 'Custom';
  private presetController: ReturnType<GUI['add']> | null = null;

  constructor(
    private params: Params,
    private loop: LoopControls,
    private hooks: PanelHooks,
  ) {
    this.gui = new GUI({ title: 'RacingPhysics2', width: 340 });
    this.gui.domElement.style.zIndex = '20';
    this.gui.domElement.style.maxHeight = '96vh';
    this.gui.domElement.style.overflowY = 'auto';

    this.presets = [...builtinPresets(), ...loadStoredPresets()];

    this.buildSimulation();
    this.buildPresets();
    this.buildChassis();
    this.buildSuspension();
    this.buildTyres();
    this.buildDrivetrain();
    this.buildSteering();
    this.buildAirborne();
    this.buildExpression();
    this.buildCollision();
    this.buildCamera();
  }

  refresh(): void {
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  private folder(name: string): GUI {
    const f = this.gui.addFolder(name);
    f.close();
    return f;
  }

  // --- simulation ---------------------------------------------------------

  private buildSimulation(): void {
    const f = this.gui.addFolder('Simulation');
    f.add(this.loop, 'paused').name('pause  [space]').listen();
    f.add({ step: () => this.hooks.singleStep() }, 'step').name('single step  [.]');
    f.add(this.loop, 'timeScale', 0.05, 1, 0.05).name('slow motion  [m]').listen();
    f.add({ go: () => this.hooks.respawn() }, 'go').name('respawn  [r]');
    f.add({ go: () => this.hooks.fullReset() }, 'go').name('full reset  [shift+r]');
    f.add({ go: () => this.hooks.resetProps() }, 'go').name('reset props  [p]');
    f.add({ go: () => this.hooks.clearMarks() }, 'go').name('clear skid marks');
    f.add({ go: () => this.hooks.teleportSkidPad() }, 'go').name('go to skid pad');
    f.add({ go: () => this.hooks.teleportSurfaceStrip() }, 'go').name('go to surface strip');
    f.add({ go: () => this.hooks.toggleTelemetry() }, 'go').name('telemetry  [t]');
    f.add({ go: () => this.hooks.toggleFrictionCircles() }, 'go').name('friction circles');
    f.add({ go: () => this.hooks.toggleDebugDraw() }, 'go').name('debug draw  [g]');
    f.add({ go: () => this.hooks.startAudio() }, 'go').name('enable audio');
  }

  // --- presets ------------------------------------------------------------

  private buildPresets(): void {
    const f = this.gui.addFolder('Presets');
    const state = { name: this.presetName, saveAs: 'My setup' };

    this.presetController = f
      .add(state, 'name', this.presets.map((p) => p.name))
      .name('load preset')
      .onChange((value: string) => {
        const preset = this.presets.find((p) => p.name === value);
        if (!preset) return;
        applyParams(this.params, preset.params);
        this.hooks.onPresetApplied();
        this.refresh();
      });

    f.add(state, 'saveAs').name('name');
    f.add(
      {
        save: () => {
          const clone = JSON.parse(JSON.stringify(this.params)) as Params;
          const existing = this.presets.findIndex((p) => p.name === state.saveAs);
          if (existing >= 0) this.presets[existing] = { name: state.saveAs, params: clone };
          else this.presets.push({ name: state.saveAs, params: clone });
          storePresets(this.presets.filter((p) => !builtinPresets().some((b) => b.name === p.name)));
          this.presetController?.options(this.presets.map((p) => p.name));
          this.refresh();
        },
      },
      'save',
    ).name('save to browser');

    f.add(
      {
        exportJson: () => {
          const blob = new Blob([JSON.stringify(this.params, null, 2)], {
            type: 'application/json',
          });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'racingphysics2-setup.json';
          a.click();
          URL.revokeObjectURL(a.href);
        },
      },
      'exportJson',
    ).name('export JSON');

    f.add(
      {
        importJson: () => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'application/json';
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
              applyParams(this.params, JSON.parse(await file.text()));
              this.hooks.onPresetApplied();
              this.refresh();
            } catch {
              /* malformed file -- keep the current setup */
            }
          };
          input.click();
        },
      },
      'importJson',
    ).name('import JSON');

    f.add(
      {
        restore: () => {
          applyParams(this.params, defaultParams());
          this.hooks.onPresetApplied();
          this.refresh();
        },
      },
      'restore',
    ).name('restore defaults');
  }

  // --- physics folders ----------------------------------------------------

  private buildChassis(): void {
    const f = this.folder('Chassis');
    const c = this.params.chassis;
    const changed = (): void => this.hooks.onChassisChanged();
    f.add(c, 'mass', 400, 3000, 10).name('mass kg').onChange(changed);
    f.add(c, 'comX', -0.6, 0.6, 0.01).name('CoM x').onChange(changed);
    f.add(c, 'comY', -0.7, 0.4, 0.01).name('CoM y (height)').onChange(changed);
    f.add(c, 'comZ', -1.2, 1.2, 0.01).name('CoM z (rear +)').onChange(changed);
    f.add(c, 'inertiaRoll', 80, 2000, 10).name('inertia roll').onChange(changed);
    f.add(c, 'inertiaPitch', 200, 5000, 10).name('inertia pitch').onChange(changed);
    f.add(c, 'inertiaYaw', 200, 6000, 10).name('inertia yaw').onChange(changed);
    f.add(c, 'dragCoefficient', 0, 3, 0.01).name('linear drag');
    f.add(c, 'rollingResistance', 0, 0.08, 0.001).name('rolling resistance');
    const hull = (): void => this.hooks.onHullChanged();
    f.add(c, 'hullLength', 2, 6, 0.05).name('hull length').onChange(hull);
    f.add(c, 'hullWidth', 1, 3, 0.05).name('hull width').onChange(hull);
    f.add(c, 'hullHeight', 0.3, 1.6, 0.05).name('hull height').onChange(hull);
    f.add(c, 'hullOffsetY', -0.4, 0.8, 0.01).name('hull offset y').onChange(hull);
  }

  private buildSuspension(): void {
    const f = this.folder('Suspension');
    const s = this.params.suspension;
    const geometry = (): void => this.hooks.onSuspensionGeometryChanged();
    f.add(s, 'wheelbase', 1.6, 4, 0.02).name('wheelbase').onChange(geometry);
    f.add(s, 'trackFront', 1, 2.4, 0.02).name('track front').onChange(geometry);
    f.add(s, 'trackRear', 1, 2.4, 0.02).name('track rear').onChange(geometry);
    f.add(s, 'wheelRadius', 0.2, 0.55, 0.01).name('wheel radius').onChange(geometry);
    f.add(s, 'wheelWidth', 0.1, 0.5, 0.01).name('wheel width');
    f.add(s, 'hardpointY', -0.6, 0.3, 0.01).name('hardpoint y').onChange(geometry);
    f.add(s, 'restLength', 0.1, 0.7, 0.01).name('rest length');
    f.add(s, 'maxTravel', 0.05, 0.6, 0.01).name('max travel');
    f.add(s, 'stiffnessFront', 10000, 140000, 500).name('stiffness front');
    f.add(s, 'stiffnessRear', 10000, 140000, 500).name('stiffness rear');
    f.add(s, 'dampingFront', 0, 16000, 50).name('damping front');
    f.add(s, 'dampingRear', 0, 16000, 50).name('damping rear');
    f.add(s, 'maxForce', 5000, 120000, 500).name('max spring force');
    f.add(s, 'antiRollFront', 0, 60000, 250).name('anti-roll front');
    f.add(s, 'antiRollRear', 0, 60000, 250).name('anti-roll rear');
  }

  private buildTyres(): void {
    const f = this.folder('Tyres');
    const t = this.params.tyre;
    f.add(t, 'peakGrip', 0.3, 3, 0.01).name('peak grip');
    f.add(t, 'peakSlipAngle', 2, 25, 0.1).name('peak slip angle deg');
    f.add(t, 'peakSlipRatio', 0.02, 0.5, 0.005).name('peak slip ratio');
    f.add(t, 'falloffSharpness', 0.1, 6, 0.05).name('falloff sharpness');
    f.add(t, 'tailGrip', 0.2, 1, 0.01).name('tail grip');
    f.add(t, 'loadSensitivity', 0.4, 1.2, 0.01).name('load sensitivity');
    f.add(t, 'referenceLoad', 800, 9000, 50).name('reference load N');
    f.add(t, 'combinedSlip').name('combined slip (friction circle)');
    f.add(t, 'slidingGrip', 0.2, 1, 0.01).name('sliding grip');
    f.add(t, 'gripRecoveryRate', 0.1, 8, 0.05).name('grip recovery rate');
    f.add(t, 'gripLossRate', 0.5, 30, 0.5).name('grip loss rate');
    f.add(t, 'wheelInertia', 0.2, 6, 0.05).name('wheel inertia');

    const s = f.addFolder('Surface grip');
    s.add(t.surfaceGrip, 'tarmac', 0.1, 1.5, 0.01);
    s.add(t.surfaceGrip, 'dirt', 0.1, 1.5, 0.01);
    s.add(t.surfaceGrip, 'grass', 0.1, 1.5, 0.01);
    s.add(t.surfaceGrip, 'gravel', 0.1, 1.5, 0.01);
    s.add(t.surfaceGrip, 'kerb', 0.1, 1.5, 0.01);
  }

  private buildDrivetrain(): void {
    const f = this.folder('Drivetrain');
    const d = this.params.drivetrain;
    f.add(d, 'layout', ['RWD', 'FWD', 'AWD']).name('drive layout');
    f.add(d, 'awdFrontSplit', 0, 1, 0.01).name('AWD front split');
    f.add(d, 'finalDrive', 1.5, 6, 0.05).name('final drive');
    f.add(d, 'idleRPM', 500, 2000, 10).name('idle rpm');
    f.add(d, 'limiterRPM', 3000, 12000, 50).name('limiter rpm');
    f.add(d, 'shiftUpRPM', 2000, 11000, 50).name('shift up rpm');
    f.add(d, 'shiftDownRPM', 800, 8000, 50).name('shift down rpm');
    f.add(d, 'shiftCutTime', 0, 0.6, 0.01).name('shift cut s');
    f.add(d, 'drivelineEfficiency', 0.4, 1, 0.01).name('driveline efficiency');
    f.add(d, 'brakeTorqueFront', 200, 12000, 50).name('brake torque front');
    f.add(d, 'brakeTorqueRear', 200, 12000, 50).name('brake torque rear');
    f.add(d, 'reverseTorqueScale', 0.1, 1, 0.01).name('reverse scale');

    const lsd = f.addFolder('Differential');
    lsd.add(d, 'lsdOpen').name('open diff');
    lsd.add(d, 'lsdPreload', 0, 600, 5).name('preload Nm');
    lsd.add(d, 'lsdPowerLock', 0, 1, 0.01).name('power lock ratio');
    lsd.add(d, 'lsdCoastLock', 0, 1, 0.01).name('coast lock ratio');

    const torque = f.addFolder('Torque curve Nm');
    d.torqueCurve.forEach((_, i) => {
      torque
        .add(d.torqueCurve, `${i}` as never, 0, 700, 5)
        .name(`${(i + 1) * 1000} rpm`);
    });

    const gears = f.addFolder('Gear ratios');
    d.gearRatios.forEach((_, i) => {
      gears.add(d.gearRatios, `${i}` as never, 0.4, 6, 0.01).name(`gear ${i + 1}`);
    });
    gears.add(d, 'reverseRatio', 1, 6, 0.05).name('reverse');
  }

  private buildSteering(): void {
    const f = this.folder('Steering');
    const s = this.params.steering;
    f.add(s, 'maxAngle', 8, 60, 0.5).name('max angle deg');
    f.add(s, 'minLimitFactor', 0.05, 1, 0.01).name('limit at speed');
    f.add(s, 'speedForMinLimit', 10, 120, 1).name('speed for min limit');
    f.add(s, 'limitCurve', 0.3, 4, 0.05).name('limit curve');
    f.add(s, 'ackermann', 0, 1, 0.01).name('ackermann');
    f.add(s, 'rateToTarget', 30, 900, 5).name('rate to target deg/s');
    f.add(s, 'returnRate', 30, 1200, 5).name('return to centre deg/s');
    f.add(s, 'deadzone', 0, 0.4, 0.01).name('deadzone');
    f.add(s, 'inputCurve', 0.5, 3, 0.05).name('input curve');
    f.add(s, 'driftAssist', 0, 1.5, 0.01).name('counter-steer assist');
    f.add(s, 'driftAssistMaxAngle', 0, 30, 0.5).name('assist max deg');
  }

  private buildAirborne(): void {
    const f = this.folder('Airborne');
    const a = this.params.airborne;
    f.add(a, 'angularDamping', 0, 12, 0.05).name('angular damping');
    f.add(a, 'yawAuthority', 0, 8000, 50).name('air yaw authority');
    f.add(a, 'pitchAuthority', 0, 8000, 50).name('air pitch authority');
  }

  private buildExpression(): void {
    const f = this.folder('Expression');
    const e = this.params.expression;
    f.add(e, 'visualRollMultiplier', 1, 4, 0.05).name('visual roll x');
    f.add(e, 'visualPitchMultiplier', 1, 4, 0.05).name('visual pitch x');
    f.add(e, 'skidThreshold', 0, 1, 0.01).name('skid threshold');
    f.add(e, 'skidOpacity', 0, 1, 0.01).name('skid opacity');
    f.add(e, 'dustRate', 0, 4, 0.05).name('dust rate');
    f.add(e, 'deformation', 0, 3, 0.05).name('dent depth');
    f.add(e, 'debrisFadeDistance', 0, 20, 0.5).name('near-camera fade');
    f.add(e, 'debrisScatterBias', 0, 2, 0.01).name('scatter bias');

    const audio = f.addFolder('Audio');
    audio.add(e, 'audioEnabled').name('enabled');
    audio.add(e, 'masterVolume', 0, 1, 0.01).name('master');
    audio.add(e, 'engineVolume', 0, 1, 0.01).name('engine');
    audio.add(e, 'scrubVolume', 0, 2, 0.01).name('tyre scrub');
    audio.add(e, 'impactVolume', 0, 2, 0.01).name('impacts');
  }

  private buildCollision(): void {
    const f = this.folder('Collision');
    const c = this.params.collision;
    f.add(c, 'exceptionsEnabled').name('exception layer on');
    f.add(c, 'wallTangentPreservation', 0, 1, 0.01).name('wall tangent preserved');
    f.add(c, 'wallAngleScale', 0, 2, 0.01).name('impact angle scale');
    f.add(c, 'wallSteerNudge', 0, 0.5, 0.005).name('wall steer nudge');
    f.add(c, 'suppressVerticalImpulse').name('suppress launch');
    f.add(c, 'maxInducedYawRate', 0.2, 10, 0.05).name('max induced yaw rate');
    f.add(c, 'carRestitution', 0, 0.8, 0.01).name('car restitution');
    f.add(c, 'contactFrequency', 4, 120, 1).name('contact softness Hz').onChange(() => {
      this.hooks.onSolverChanged();
    });
    f.add(c, 'maxDynamicProps', 10, 400, 5).name('simulated prop cap');

    const tiers = f.addFolder('Feedback thresholds');
    tiers.add(c, 'scuffThreshold', 100, 20000, 100).name('scuff');
    tiers.add(c, 'bumpThreshold', 1000, 80000, 250).name('bump');
    tiers.add(c, 'crashThreshold', 5000, 200000, 500).name('crash');
    tiers.add(c, 'shakeScale', 0, 4, 0.05).name('camera shake');
    tiers.add(c, 'timeDilation', 0.05, 1, 0.05).name('crash time dilation');
    tiers.add(c, 'timeDilationDuration', 0, 2, 0.05).name('dilation seconds');

    const mass = f.addFolder('Mass ladder');
    const changed = (): void => this.hooks.onPropMassChanged();
    mass.add(c, 'massCone', 0.5, 60, 0.5).name('A cone').onChange(changed);
    mass.add(c, 'massBarrel', 5, 400, 1).name('B barrel').onChange(changed);
    mass.add(c, 'massTyreStack', 5, 400, 1).name('B tyre stack').onChange(changed);
    mass.add(c, 'massCrate', 5, 400, 1).name('B crate').onChange(changed);
    mass.add(c, 'massBarrier', 100, 4000, 10).name('C barrier').onChange(changed);
    mass.add(c, 'massDumpster', 100, 5000, 10).name('C dumpster').onChange(changed);
    mass.add(c, 'massDummyCar', 300, 4000, 10).name('C dummy car').onChange(changed);

    const restitution = f.addFolder('Restitution');
    restitution.add(c, 'restitutionCone', 0, 1, 0.01).name('cone').onChange(changed);
    restitution.add(c, 'restitutionBarrel', 0, 1, 0.01).name('barrel').onChange(changed);
    restitution.add(c, 'restitutionTyreStack', 0, 1, 0.01).name('tyre stack').onChange(changed);
    restitution.add(c, 'restitutionCrate', 0, 1, 0.01).name('crate').onChange(changed);
    restitution.add(c, 'restitutionBarrier', 0, 1, 0.01).name('barrier').onChange(changed);
    restitution.add(c, 'restitutionDumpster', 0, 1, 0.01).name('dumpster').onChange(changed);
  }

  private buildCamera(): void {
    const f = this.folder('Camera');
    const c = this.params.camera;
    f.add(c, 'mode', ['A-fixed', 'B-follow']).name('orientation  [c]').listen();
    f.add(c, 'yawDamping', 0.02, 2, 0.01).name('yaw damping (B)');
    f.add(c, 'leadFactor', 0, 1.2, 0.01).name('speed lead');
    f.add(c, 'pullbackFactor', 0, 1.5, 0.01).name('speed pull-back');
    f.add(c, 'baseViewHeight', 10, 70, 0.5).name('base view height');
    f.add(c, 'pitch', 0.15, 1.5, 0.01).name('pitch');
    f.add(c, 'followDamping', 0.005, 0.5, 0.005).name('follow damping');
  }
}

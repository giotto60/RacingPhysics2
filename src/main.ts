import * as THREE from 'three';
import { initRapier, PhysicsWorld, defaultPhysicsConfig } from './physics/world';
import { SceneView, defaultIsoCamera } from './render/scene';
import { FixedLoop } from './core/loop';
import { defaultParams } from './core/params';
import { Input } from './core/input';
import { Car } from './vehicle/car';
import { CarView } from './vehicle/carView';
import { CAR_MODELS, loadCarModel, modelById } from './vehicle/models';
import { applyVehicleSetup } from './vehicle/setup';
import { createDriverState, driveAlong } from './vehicle/driver';
import {
  buildTrack,
  pointOnTrack,
  spawnOnCentreline,
  SKIDPAD_CENTRE,
  SURFACE_STRIP_START,
} from './world/track';
import { PropWorld } from './world/props';
import { CollisionResponse } from './physics/collision';
import { ChaseCamera } from './expression/camera';
import { SkidMarks } from './expression/skidmarks';
import { Particles } from './expression/particles';
import { GameAudio } from './expression/audio';
import { MiniMap } from './expression/minimap';
import { Speedo } from './expression/speedo';
import { TelemetryOverlay } from './debug/telemetry';
import { FrictionCircles } from './debug/frictionCircle';
import { DebugDraw } from './debug/draw';
import { DebugPanel } from './debug/panel';

const PHYSICS_HZ = 120;

async function boot(): Promise<void> {
  await initRapier();

  const container = document.getElementById('app')!;
  document.getElementById('stats')?.remove();

  const params = defaultParams();
  const view = new SceneView(container, { ...defaultIsoCamera });
  const physics = new PhysicsWorld({ ...defaultPhysicsConfig }, 1 / PHYSICS_HZ);
  physics.world.integrationParameters.contact_natural_frequency = params.collision.contactFrequency;

  const track = buildTrack(physics, view.scene);
  const spawn = spawnOnCentreline(track.centreline);

  const car = new Car(physics, params, spawn.position, spawn.heading);
  const carView = new CarView(view.scene, car, params);
  // Whatever body is drawn, the collider is that body's box.
  carView.onHullChanged = () => car.applyHullShape();

  /**
   * The opponents.
   *
   * Each one is an ordinary `Car` with an ordinary `CarView`, driven by inputs
   * of exactly the same shape the keyboard produces -- there is no cheating
   * anywhere in the driver, and no separate physics path. They share the
   * player's parameters, so picking a car changes all three, which is why they
   * only differ in the hue of their paint and where they start.
   */
  // Both lines sit left of centre, because the ramps are lined up down the
  // right-hand side of the road: a jump is there to be aimed at, not to be
  // taken by surprise by a car that was only trying to drive round.
  const OPPONENTS = [
    { hue: 150, grid: 8, line: -3.0 },
    { hue: 232, grid: 16, line: -0.8 },
  ];
  const opponents = OPPONENTS.map((spec) => {
    const start = spawnOnCentreline(track.centreline, track.centreline.length - spec.grid * 3);
    const opponent = new Car(physics, params, start.position, start.heading);
    const opponentView = new CarView(view.scene, opponent, params);
    opponentView.hueShift = spec.hue;
    opponentView.onHullChanged = () => opponent.applyHullShape();
    return {
      car: opponent,
      view: opponentView,
      driver: createDriverState(spec.line),
      gridIndex: track.centreline.length - spec.grid * 3,
      lane: spec.line,
    };
  });

  type Opponent = (typeof opponents)[number];

  /** Set a computer driver back on the road where it went off it. */
  const rescue = (opponent: Opponent): void => {
    const spot = pointOnTrack(
      track.centreline,
      opponent.driver.index / track.centreline.length,
      opponent.driver.line,
    );
    opponent.car.respawn(
      spot.position.clone().setY(spot.position.y + 1.0),
      spot.heading,
    );
    opponent.driver.stuckFor = 0;
    opponent.driver.needsRescue = false;
    opponent.view.capture();
    opponent.view.capture();
  };

  let panelRef: DebugPanel | null = null;

  /**
   * Picking a car is a vehicle change, not a paint job: the class table and the
   * model's own geometry are written into the parameters first, and everything
   * that reads them -- the collider, the mass properties, the hardpoints, the
   * drawn body -- is rebuilt from that.
   */
  const selectCarModel = async (id: string): Promise<void> => {
    const def = modelById(id);
    const loaded = def.file ? await loadCarModel(def, import.meta.env.BASE_URL).catch(() => null) : null;
    applyVehicleSetup(params, def, loaded);
    const useId = loaded || !def.file ? id : 'blocks';
    for (const entry of [{ car, view: carView }, ...opponents]) {
      entry.car.applyMassProperties();
      entry.car.refreshGeometry();
      entry.car.applyHullShape();
      await entry.view.setModel(useId);
    }
    // The setup rewrote most of the panel's numbers, so it has to be told.
    panelRef?.refresh();
  };
  void selectCarModel(params.expression.carModel);

  // The prop world stays -- the mass ladder, the freeze-on-budget debris and
  // the collision harness are all built on it, and props can still be spawned
  // from the console -- but nothing is placed on the circuit any more.
  const props = new PropWorld(physics, view.scene, params);

  const collisions = new CollisionResponse(physics, car, props, params);
  const camera = new ChaseCamera(view, params);
  const skidMarks = new SkidMarks(view.scene, params);
  const particles = new Particles(view.scene, params);
  const audio = new GameAudio(params);
  const speedo = new Speedo();
  const minimap = new MiniMap(track.centreline);
  const telemetry = new TelemetryOverlay();
  const frictionCircles = new FrictionCircles();
  const debugDraw = new DebugDraw(view.scene);
  // The diagnostics are opt-in: the default screen carries the speedo and the
  // map and nothing else.
  telemetry.toggle();
  frictionCircles.toggle();

  const input = new Input(params);
  input.onFirstGesture = () => {
    audio.start();
    audio.resume();
  };

  let dilationTimer = 0;
  let slowMotionLatch = 1;

  collisions.onImpact = (event) => {
    audio.impact(event.magnitude, event.tier);
    const c = params.collision;
    const strength = Math.min(1, event.magnitude / Math.max(1, c.crashThreshold));

    if (event.tier !== 'scuff') {
      camera.kick(event.normal, strength * 1.6 * c.shakeScale);
      carView.dent(event.point, event.normal, strength);
    }
    if (event.tier === 'scuff') {
      particles.burst(event.point, 4, 3 + event.tangentialSpeed * 0.25);
    } else if (event.tier === 'bump') {
      particles.burst(event.point, 12, 6);
    } else {
      particles.burst(event.point, 34, 12, 0xffe0a0);
      dilationTimer = c.timeDilationDuration;
    }
    debugDraw.markContact(event.point);
    collisions.scatterProps(new THREE.Vector3().copy(carView.group.position));
  };

  // --- fixed-step simulation ---------------------------------------------

  const carHeading = (): number => {
    const r = car.body.rotation();
    return new THREE.Euler().setFromQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w), 'YXZ').y;
  };

  const step = (dt: number): void => {
    input.update(dt, car.forwardSpeed);

    // Steering is car-relative in every camera mode: left turns the car left,
    // whatever the camera happens to be doing.
    const carInput = {
      throttle: input.state.throttle,
      brake: input.state.brake,
      steer: input.state.steer,
      reverse: input.state.reverse,
    };

    car.step(dt, carInput);
    for (const opponent of opponents) {
      opponent.car.step(
        dt,
        driveAlong(opponent.car, track.centreline, opponent.driver, params, dt),
      );
      if (opponent.driver.needsRescue) rescue(opponent);
    }
    collisions.beforeStep();
    physics.step();
    collisions.afterStep(dt);
    props.enforceBudget();

    carView.capture();
    for (const opponent of opponents) {
      opponent.view.capture();
      skidMarks.update(opponent.car.wheels);
    }
    props.capture();
    skidMarks.update(car.wheels);
    particles.updateWheels(car.wheels, dt);
    particles.step(dt);

    if (dilationTimer > 0) {
      dilationTimer = Math.max(0, dilationTimer - dt);
    }
  };

  const render = (alpha: number, frameDelta: number): void => {
    carView.update(alpha);
    for (const opponent of opponents) opponent.view.update(alpha);
    props.render(alpha, view.camera.position);
    view.setDaylight(params.expression.daylight);
    view.setShadows(params.expression.shadows);

    const heading = carHeading();
    const lv = car.body.linvel();
    camera.rotate(input.state.cameraRotate * 90 * frameDelta);
    camera.update(
      carView.group.position,
      new THREE.Vector3(lv.x, 0, lv.z),
      heading,
      frameDelta,
    );

    speedo.update(car, params.drivetrain.limiterRPM);
    minimap.update(carView.group.position, heading);
    telemetry.update(car, loop.stats.fps, loop.stats.stepsLastFrame, physics.world.bodies.len());
    frictionCircles.update(car);
    debugDraw.update(car);

    let scrub = 0;
    let load = 0;
    for (const w of car.wheels) {
      if (!w.grounded) continue;
      const over = Math.max(0, w.utilisation - 0.55);
      scrub += over;
      load += over > 0 ? w.load : 0;
    }
    audio.update(
      car.drivetrain.rpm,
      input.state.throttle,
      scrub,
      load,
      collisions.scrapeIntensity,
    );

    view.render();
  };

  const loop = new FixedLoop({ step, render }, PHYSICS_HZ);

  // --- controls -----------------------------------------------------------

  /** Put the opponents back on their grid slots behind the start line. */
  const gridUp = (): void => {
    for (const opponent of opponents) {
      const slot = spawnOnCentreline(track.centreline, opponent.gridIndex);
      const heading = slot.heading;
      // Offset into their own lane, square to the track.
      const across = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
      opponent.car.respawn(slot.position.clone().addScaledVector(across, opponent.lane), heading);
      opponent.driver.index = opponent.gridIndex;
      opponent.driver.stuckFor = 0;
      opponent.driver.laps = 0;
      opponent.view.capture();
      opponent.view.capture();
    }
  };

  const respawn = (): void => {
    car.respawn();
    carView.capture();
    carView.capture();
    gridUp();
  };

  const fullReset = (): void => {
    respawn();
    props.reset();
    skidMarks.clear();
    particles.clear();
    carView.resetDeformation();
    for (const opponent of opponents) opponent.view.resetDeformation();
  };

  const teleport = (position: THREE.Vector3, heading: number): void => {
    car.respawn(new THREE.Vector3(position.x, position.y + 1.1, position.z), heading);
    carView.capture();
    carView.capture();
  };

  const panel = new DebugPanel(params, loop, {
    onChassisChanged: () => car.applyMassProperties(),
    onSuspensionGeometryChanged: () => {
      car.refreshGeometry();
      carView.applyWheels();
    },
    onHullChanged: () => {
      carView.applyHull();
      car.applyHullShape();
    },
    onCarModelChanged: () => void selectCarModel(params.expression.carModel),
    onPropMassChanged: () => props.refreshAllMassProperties(),
    onSolverChanged: () => {
      physics.applySolverConfig();
      physics.world.integrationParameters.contact_natural_frequency =
        params.collision.contactFrequency;
    },
    onPresetApplied: () => {
      // The model comes back with the preset, and it is what decides the whole
      // vehicle, so the setup runs again from it.
      void selectCarModel(params.expression.carModel);
      props.refreshAllMassProperties();
      physics.applySolverConfig();
    },
    respawn,
    fullReset,
    resetProps: () => props.reset(),
    clearMarks: () => skidMarks.clear(),
    teleportSkidPad: () => teleport(SKIDPAD_CENTRE, 0),
    teleportSurfaceStrip: () => teleport(SURFACE_STRIP_START, 0),
    toggleTelemetry: () => telemetry.toggle(),
    toggleFrictionCircles: () => frictionCircles.toggle(),
    toggleDebugDraw: () => debugDraw.toggle(),
    toggleMiniMap: () => minimap.toggle(),
    singleStep: () => loop.singleStep(1),
    startAudio: () => {
      audio.start();
      audio.resume();
    },
  });
  panelRef = panel;

  // The car sits in the middle of the window, with the panel overlapping the
  // view rather than the framing being pushed out of the way of it.
  view.viewOffsetX = 0;
  view.updateProjection();

  input.onAction = (action) => {
    switch (action) {
      case 'respawn':
        respawn();
        break;
      case 'reset':
        fullReset();
        break;
      case 'resetProps':
        props.reset();
        break;
      case 'pause':
        loop.paused = !loop.paused;
        break;
      case 'singleStep':
        loop.singleStep(1);
        break;
      case 'toggleTelemetry':
        telemetry.toggle();
        break;
      case 'toggleDebugDraw':
        debugDraw.toggle();
        break;
      case 'toggleCameraMode':
        params.camera.mode = params.camera.mode === 'B-follow' ? 'A-fixed' : 'B-follow';
        panel.refresh();
        break;
      case 'slowMotion':
        slowMotionLatch = slowMotionLatch === 1 ? 0.2 : 1;
        loop.timeScale = slowMotionLatch;
        break;
      default:
        break;
    }
  };

  // Crash time dilation rides on top of whatever the slow-motion latch is set
  // to, so a heavy hit reads as a moment of weight without fighting the panel.
  const applyDilation = (): void => {
    const target = dilationTimer > 0 ? params.collision.timeDilation : 1;
    loop.timeScale = Math.min(slowMotionLatch, target);
    requestAnimationFrame(applyDilation);
  };
  applyDilation();

  // Handle for headless verification and for poking at state from the console.
  (window as unknown as Record<string, unknown>).rp2 = {
    car,
    carView,
    opponents,
    // The computer driver, so a test can step the opponents at the fixed rate
    // instead of at whatever a software rasteriser manages to render.
    driveAlong,
    rescue,
    carModels: CAR_MODELS,
    selectCarModel,
    fullReset,
    params,
    physics,
    loop,
    props,
    input,
    collisions,
    camera,
    skidMarks,
    audio,
    track: track.centreline,
    view,
  };

  loop.start();
}

boot().catch((err) => {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;left:12px;top:12px;color:#ff8a7a;font:12px ui-monospace,monospace;white-space:pre-wrap';
  el.textContent = `boot failed: ${String(err)}\n${err instanceof Error ? err.stack : ''}`;
  document.body.appendChild(el);
  console.error(err);
});

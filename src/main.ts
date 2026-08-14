import * as THREE from 'three';
import { initRapier, PhysicsWorld, defaultPhysicsConfig } from './physics/world';
import { SceneView, defaultIsoCamera } from './render/scene';
import { FixedLoop } from './core/loop';
import { defaultParams } from './core/params';
import { Input } from './core/input';
import { Car } from './vehicle/car';
import { CarView } from './vehicle/carView';
import {
  buildTrack,
  spawnOnCentreline,
  SKIDPAD_CENTRE,
  SURFACE_STRIP_START,
} from './world/track';
import { PropWorld } from './world/props';
import { placeProps } from './world/layout';
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

  const props = new PropWorld(physics, view.scene, params);
  placeProps(props, view.scene, track.centreline);

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
    collisions.beforeStep();
    physics.step();
    collisions.afterStep(dt);
    props.enforceBudget();

    carView.capture();
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

  const respawn = (): void => {
    car.respawn();
    carView.capture();
    carView.capture();
  };

  const fullReset = (): void => {
    respawn();
    props.reset();
    skidMarks.clear();
    particles.clear();
    carView.resetDeformation();
  };

  const teleport = (position: THREE.Vector3, heading: number): void => {
    car.respawn(new THREE.Vector3(position.x, position.y + 1.1, position.z), heading);
    carView.capture();
    carView.capture();
  };

  const panel = new DebugPanel(params, loop, {
    onChassisChanged: () => car.applyMassProperties(),
    onSuspensionGeometryChanged: () => car.refreshGeometry(),
    onHullChanged: () => carView.rebuildHull(),
    onPropMassChanged: () => props.refreshAllMassProperties(),
    onSolverChanged: () => {
      physics.applySolverConfig();
      physics.world.integrationParameters.contact_natural_frequency =
        params.collision.contactFrequency;
    },
    onPresetApplied: () => {
      car.applyMassProperties();
      car.refreshGeometry();
      carView.rebuildHull();
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

  // Keep the car centred in the part of the window the panel is not covering.
  const syncViewOffset = (): void => {
    view.viewOffsetX = panel.gui.domElement.getBoundingClientRect().width / 2;
    view.updateProjection();
  };
  syncViewOffset();
  window.addEventListener('resize', syncViewOffset);

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

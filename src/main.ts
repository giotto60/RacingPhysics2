import * as THREE from 'three';
import { RAPIER, initRapier, PhysicsWorld, defaultPhysicsConfig } from './physics/world';
import { createGround } from './physics/ground';
import { SceneView, defaultIsoCamera } from './render/scene';
import { InterpolatedBody } from './render/interpolated';
import { FixedLoop } from './core/loop';
import { DebugPanel } from './debug/panel';

const PHYSICS_HZ = 120;

async function boot(): Promise<void> {
  await initRapier();

  const container = document.getElementById('app')!;
  const statsEl = document.getElementById('stats')!;

  const view = new SceneView(container, { ...defaultIsoCamera });
  const physics = new PhysicsWorld({ ...defaultPhysicsConfig }, 1 / PHYSICS_HZ);
  createGround(physics, view.scene);

  // Placeholder dynamic bodies: they exist only to prove the fixed-step loop,
  // interpolation and solver are all live. The car replaces them at Milestone 2.
  const bodies: InterpolatedBody[] = [];
  const spawnBox = (x: number, y: number, z: number, size: number, colour: number): void => {
    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setCcdEnabled(true),
    );
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size, size, size).setFriction(0.9).setRestitution(0.15),
      body,
    );
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size * 2, size * 2, size * 2),
      new THREE.MeshLambertMaterial({ color: colour }),
    );
    view.scene.add(mesh);
    bodies.push(new InterpolatedBody(body, mesh));
  };

  const spawnSet = (): void => {
    for (const b of bodies) {
      physics.world.removeRigidBody(b.body);
      view.scene.remove(b.object);
    }
    bodies.length = 0;
    for (let i = 0; i < 6; i += 1) {
      spawnBox(
        Math.cos(i * 1.05) * 3,
        1.2 + i * 1.5,
        Math.sin(i * 1.05) * 3,
        0.5,
        [0xd35f4f, 0x4f9dd3, 0xd3c14f, 0x6ad34f, 0xa14fd3, 0xd38f4f][i],
      );
    }
  };
  spawnSet();

  const camTarget = new THREE.Vector3();
  const scratch = new THREE.Vector3();

  const loop = new FixedLoop(
    {
      step: () => {
        physics.step();
        for (const b of bodies) b.capture();
      },
      render: (alpha) => {
        camTarget.set(0, 0, 0);
        for (const b of bodies) {
          b.apply(alpha);
          camTarget.add(b.getInterpolatedPosition(alpha, scratch));
        }
        if (bodies.length > 0) camTarget.multiplyScalar(1 / bodies.length);
        view.target.lerp(camTarget, 0.08);
        view.updateCamera();
        view.render();
      },
    },
    PHYSICS_HZ,
  );

  // --- Debug panel -------------------------------------------------------
  const panel = new DebugPanel();

  const sim = panel.folder('Simulation');
  sim.open();
  sim.add(loop, 'paused').name('pause');
  sim.add({ step: () => loop.singleStep(1) }, 'step').name('single step');
  sim.add(loop, 'timeScale', 0.05, 1, 0.05).name('time scale');
  sim.add({ reset: spawnSet }, 'reset').name('reset props');

  const phys = panel.folder('Physics');
  phys
    .add(physics.config, 'gravity', -30, 0, 0.01)
    .name('gravity')
    .onChange(() => physics.applySolverConfig());
  phys
    .add(physics.config, 'numSolverIterations', 1, 24, 1)
    .name('solver iterations')
    .onChange(() => physics.applySolverConfig());
  phys
    .add(physics.config, 'numAdditionalFrictionIterations', 0, 24, 1)
    .name('friction iterations')
    .onChange(() => physics.applySolverConfig());

  const cam = panel.folder('Camera');
  cam
    .add(view.cameraConfig, 'viewHeight', 8, 80, 0.5)
    .name('view height')
    .onChange(() => view.updateProjection());
  cam.add(view.cameraConfig, 'yaw', -Math.PI, Math.PI, 0.01).name('yaw');
  cam.add(view.cameraConfig, 'pitch', 0.15, 1.5, 0.01).name('pitch');

  // --- Stats readout -----------------------------------------------------
  setInterval(() => {
    const s = loop.stats;
    statsEl.textContent =
      `fps      ${s.fps.toFixed(0)}\n` +
      `steps/fr ${s.stepsLastFrame}\n` +
      `sim      ${s.simSeconds.toFixed(1)}s @ ${PHYSICS_HZ}Hz\n` +
      `phys ms  ${s.physicsMs.toFixed(2)}\n` +
      `rend ms  ${s.renderMs.toFixed(2)}\n` +
      `bodies   ${physics.world.bodies.len()}`;
  }, 200);

  loop.start();
}

boot().catch((err) => {
  const el = document.getElementById('stats');
  if (el) el.textContent = `boot failed: ${String(err)}`;
  console.error(err);
});

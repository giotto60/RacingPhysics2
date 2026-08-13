# TODO

## Milestones

- [x] 1. Scaffold — Vite + TS + Three.js + Rapier, 120 Hz fixed loop with
      interpolated rendering, ground plane, Pages deploy verified live.
- [x] 2. Tier 1 car — authored mass, CoM and inertia tensor, drive, brake,
      reverse, speed-sensitive steering, drag, rolling resistance.
- [x] 3. Suspension and weight transfer — four-raycast suspension, springs,
      dampers, anti-roll bars, per-wheel load, emergent pitch and roll.
- [x] 4. Tyre model — slip angle and ratio, load-sensitive curve, load
      sensitivity, combined slip, grip recovery, surface types.
- [x] 5. Drivetrain and steering feel — torque curve, gearbox, LSD with open
      diff toggle, drive layouts, Ackermann, steering actuator, drift assist,
      airborne handling.
- [x] 6. Test circuit — figure-8 with a flat crossing, skid pad, surface strip,
      all prop classes placed.
- [x] 7. Collisions — authored prop inertia, mass ladder, CCD, physics
      materials, wall impulse decomposition, car-car exceptions, persistent
      debris with freeze-on-budget.
- [x] 8. Expression layer — skid marks, dust, scrub and engine audio, wheel
      mesh rotation, exaggerated visual roll, camera lead and both orientation
      modes, collision feedback tiers, cosmetic deformation.
- [x] 9. Tuning harness — full parameter panel, presets, telemetry, friction
      circle visualiser, debug draw, slow motion and single step.

## Open questions

- The sandbox this project is built in blocks outbound requests to
  `giotto60.github.io`, so the deployed page can only be verified from the
  Actions deployment result, not by fetching it. The build is verified in a
  real headless Chromium against the production bundle before every push.
- Camera orientation: mode B (damped yaw follow) is the default and the
  expected winner, but the toggle is live so both can be compared. The answer
  is still open until it has been driven properly.

## Deferred / out of scope requests

Nothing from the excluded list has been built. Candidates that came up while
building and were deliberately left out:

- **Engine braking.** Off-throttle deceleration currently comes only from
  rolling resistance and drag, so coasting is floatier than a real car. Adding
  engine braking would fix it but it is on the excluded list.
- **Self-aligning torque.** Would give the steering rack a natural
  return-to-centre that varies with load instead of a fixed rate. Excluded.
- **Tyre relaxation length.** Would remove the last of the low-speed slip
  noise more elegantly than the implicit wheel integrator does. Excluded as
  hardcore-simulation tier; the integrator handles it adequately.

## Known rough edges

- Driving over a Class C barrier lifts the car about half a metre as it climbs
  the collider. It is geometric ride-up rather than an impulse launch, so the
  vertical impulse suppression does not catch it.

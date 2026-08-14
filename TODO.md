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

## Driving pass

- [x] Reverse on a held brake, with the pedals swapping while reversing.
- [x] Car framed in the middle of the window the panel does not cover.
- [x] Arbitrary camera angle in both orientation modes, on sliders and on keys.
- [x] Steering car-relative in every camera mode.
- [x] Four launch ramps on the racing line.
- [x] Racing surface flush with the surrounding ground.
- [x] Cones, barrels, tyre stacks, crates, barriers and dumpsters on the road.
- [x] Corner map with the start line and a car marker.
- [x] Headlights that light the road, plus brake and reverse lights.
- [x] Rolling resistance an order of magnitude higher, with far more range.
- [x] Textured road with lane markings, and textured ground.
- [x] Parked cars in three sizes.
- [x] Screen reduced to a speedometer and the map; diagnostics are opt-in.

## Fault pass

Reported after driving it. Each one measured before and after, in headless
Chromium against the production bundle.

- [x] Light passes through solid objects. Nothing cast a shadow and the
      headlight beam lit the road behind a row of crates as if they were not
      there. Sun and headlights now cast; both are switchable. Measured in a
      software rasteriser the sun's map costs about a quarter of the frame and
      the two headlight maps add almost nothing on top of it, which is the
      pessimistic end of what a real GPU will charge.
- [x] Road markings flicker at the crossing. The figure-8 overlaps itself and
      two coplanar strips of road fought over every pixel. The second pass is
      lifted 3.5 cm, ramped in over the approach.
- [x] Rolling resistance slider does nothing, and is too weak at maximum. It was
      cancelling itself inside the wheel integrator. Coast-down across the
      slider's range went from 0.035 / 0.038 / 0.050 to 0.00 / 1.07 / 5.32
      m/s^2.
- [x] Car creeps backwards when left alone, and throws gravel doing it. Drift
      over five seconds went from 1.21 m at 0.30 m/s to zero; dust and skid
      marks now need real sliding speed rather than grip utilisation.
- [x] Gearbox flutters between first and second on a start or a slippery
      surface. A full-throttle run read `1 2 1 2 1 2 1 2 1 2 3 4 5 6` before and
      reads `1 2 3 4` now; on low grip it reached sixth at 4 km/h before and
      holds first until 68 km/h now.
- [x] Wheels and chassis clip through the floor on hard landings. On a 9 m drop
      the wheels were drawn 27 cm below the surface and the hull reached the
      road itself; the wheels now stay on the surface and the hull keeps 21 cm.
- [x] Chassis floats when upside down. The drawn car sat 135 degrees away from
      the physics body with a corner through the floor; it now rests on its roof
      to the millimetre, and the exaggeration still reads upright.

## Verified behaviour

Measured in headless Chromium against the production bundle. These are the
numbers to compare against if a change makes the car feel different.

| Check | Result |
|---|---|
| Wall graze at 5 degrees, 30 m/s, exceptions on | 26.9 m/s out, 28.7 with rolling resistance zeroed |
| Same graze, exceptions off | 0.7 m/s out |
| Head-on wall at 30 m/s | 0.0 m/s out |
| Cone / tyre stack / barrier / dumpster at 30 m/s | 3.7 / 6.2 / 16.2 / 18.7 m/s lost |
| LSD locked vs open, full throttle on low grip | rear wheel spread 1 vs 112 rad/s |
| Combined slip on vs off, same corner entry | 6 deg vs 88 deg of body slip |
| Braking load transfer, front vs rear | 8316 N front / 3546 N rear |
| Debris settled, then left alone | 0.09 m of drift, returns exactly on reset |
| Pause and single step | sim frozen, one step advances 0.0083 s |
| Presets | Grippy / Loose / Heavy apply live, including chassis mass |
| Reverse from a standstill, brake held | in reverse gear at 0.5 s, -3.1 m/s at 6 s |
| Coast-down from 38 m/s | 2.8 m/s^2, top speed 201 km/h |
| Big ramp, entered at 30 m/s | 2.43 s airborne, 4.2 m peak |
| Square hit on a parked saloon at 30 m/s | 17.2 m/s lost |
| Surface strip, one run | tarmac, dirt, grass, gravel, kerb, all five |
| Standing start, full throttle, clean surface | one shift, `1 2 3 4` at 69 / 104 / 145 km/h |
| Same start with grip pulled to a third | one shift, `1 2` at 68 km/h |
| Left alone for five seconds | no drift, no dust, no marks |
| 9 m drop onto the flat | hull keeps 0.21 m, settles back to 0.802 m ride height |
| Back of the jump lip at 50 and 70 m/s | stays on top of the road, 0.79 m minimum |
| Upside down, on its side | rests on roof and on flank, mesh matches body to 0.1 deg |

## Open questions

- The sandbox this project is built in blocks outbound requests to
  `giotto60.github.io`, so the deployed page can only be verified from the
  Actions deployment result, not by fetching it. The build is verified in a
  real headless Chromium against the production bundle before every push.
- Camera orientation: mode B (damped yaw follow) is the default and the
  expected winner, but the toggle is live so both can be compared, now from
  any angle. The answer is still open until it has been driven properly.

## Deferred / out of scope requests

Nothing from the excluded list has been built. Candidates that came up while
building and were deliberately left out:

- **Engine braking.** Off-throttle deceleration still comes only from rolling
  resistance and drag. That is much less floaty now that rolling resistance
  actually reaches the chassis, but it does not vary with gear the way engine
  braking would. On the excluded list.
- **Self-aligning torque.** Would give the steering rack a natural
  return-to-centre that varies with load instead of a fixed rate. Excluded.
- **Tyre relaxation length.** Would remove the last of the low-speed slip
  noise more elegantly than the implicit wheel integrator does. Excluded as
  hardcore-simulation tier; the integrator handles it adequately.

## Known rough edges

- Driving over a Class C barrier lifts the car about half a metre as it climbs
  the collider. It is geometric ride-up rather than an impulse launch, so the
  vertical impulse suppression does not catch it.
- First gear runs to 68 km/h on the authored ratios, so a clean standing start
  holds first for a long time before the only upshift a short run ever sees.
  The gearing is a slider set, not a bug, but it is the first thing to try if
  the box feels lazy.
- Hitting the back of the jump's lip at speed is now a wall rather than
  something to fall through, which means it stops the car dead. That is the
  honest outcome for a 1.7 m step taken the wrong way round.

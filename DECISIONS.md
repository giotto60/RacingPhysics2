# Decisions

Assumptions and choices made without asking. Newest first.

## Driving pass — controls, framing, circuit and lighting

- **Reverse is the pedal-swap convention**, not a modifier key: hold the brake
  once the car has stopped and it backs up; a dab of throttle brakes and hands
  control back to first gear. The explicit reverse button still forces it. The
  old modifier-only binding worked but nobody would ever find it.
- **Steering is car-relative in every camera mode.** The fixed camera used to
  read the input as a screen direction and steer toward it, which meant the
  steering went dead once the car was already pointed that way and reversed
  when the target lay behind. Left now turns the car left in both modes; the
  camera choice no longer changes what the controls mean.
- **Both camera modes take an arbitrary angle.** The fixed mode has a world
  angle and the follow mode has an offset off the car's heading, both bound to
  the panel and to a pair of keys, so any viewpoint can be compared without a
  code change.
- **The camera frames the car in the part of the window the panel is not
  covering**, by sliding the orthographic frustum sideways by half the panel
  width rather than by moving the look-at target, so the framing survives the
  speed pull-back.
- **The racing surface is the zero datum and the grass collider is sunk five
  centimetres below its own mesh.** The step that used to disambiguate a
  suspension ray was visible all the way round the circuit; sinking the
  collider keeps the ray unambiguous while the two surfaces look flush.
- **Textures are drawn into canvases at boot**, never loaded, so the build
  stays one self-contained bundle. The road ribbon's u axis spans the track
  width, which is what lets edge lines and centre dashes be baked into the
  texture and follow the curve for nothing.
- **Materials moved from Lambert to Phong.** Lambert shades per vertex, and the
  road is a two-vertices-wide ribbon, so a headlight would have had nothing to
  land on. Phong shades per fragment at a cost that does not register here.
- **Default daylight is below full.** Headlights that cannot be seen are not
  headlights; the scene sits slightly overcast so the beam reads, and the
  brightness is a slider for anyone who disagrees.
- **Rolling resistance defaults roughly ten times a real tyre's**, and its
  range goes far higher still. Engine braking is on the excluded list, so
  rolling resistance is the only honest lever left for off-throttle
  deceleration; it now gives about 2 m/s^2 of coast-down at speed.
- **Props that are meant to be hit are placed on the racing line** by lap
  fraction rather than by hand-typed coordinates, so they stay on the road if
  the layout moves. Only the immovable class stays off it.
- **Parked cars come in three sizes** with authored inertia each, because one
  car-shaped mass says nothing about whether the mass ladder reads correctly
  between vehicles.

## M2-M9 — Vehicle, circuit, collisions, expression, harness

### Conventions

- **Axes.** +Y is up; the car's forward is local -Z and its right is local +X,
  matching the Three.js default orientation. So the longitudinal axis is Z,
  the lateral axis is X, and yaw is about Y. Positive steering is a left turn.
- **Wheel order** is FL, FR, RL, RR everywhere.

### Physics

- **Rapier user forces persist until cleared.** Every force applied to the
  chassis is reset at the top of each vehicle step; without this the
  suspension forces accumulate and the car launches into orbit within a
  second. This cost most of the debugging time on the vehicle and is the
  single most important thing to remember about this engine.
- **Wheel spin uses a semi-implicit step.** Near zero slip the tyre is far too
  stiff for an explicit integrator at 120 Hz: the wheels ring at a standstill
  and swallow the drive torque. The local slope of the tyre curve is folded
  into the integrator's denominator. The forces applied to the chassis are
  unchanged, so this is a stability measure and not a physics fudge.
- **The differential's torque transfer is capped** at the value that would
  exactly equalise the two driven wheels within one step. A locking diff is
  stiff enough to oscillate at 120 Hz otherwise, which shows up as the two
  driven wheels visibly trading grip several times a second.
- **The racing surface sits 5 cm proud of the grass.** Coplanar colliders make
  a suspension ray pick whichever it reaches first, so wheels reported grip at
  random. The step is small enough that the suspension absorbs it.
- **Suspension and tyre forces are applied at the contact point**, not at the
  hardpoint, so weight transfer emerges from the moment arm between the
  contact patch and the authored centre of mass rather than being scripted.
- **The suspension ray excludes the chassis rigid body** rather than filtering
  by collision group, so the car can never catch its own hull.

### Collisions

- **The wall exception restores tangential speed, not tangential impulse.**
  Correcting the velocity *delta* did not work: most of the speed is actually
  lost in the following steps as the induced spin makes the tyres scrub. The
  working version decomposes the car's velocity, keeps the solver's normal
  component, and rescales the tangential component back toward what the car
  arrived with. Measured at a five degree graze into a wall at 30 m/s: 28.8
  m/s out with the exception layer on, 8.2 m/s with it off.
- **Induced yaw is clamped as a delta**, not as an absolute rate, so ordinary
  cornering is untouched and only the spin an impact adds is capped.
- **Prop inertia is authored at the default mass and scaled with it**, so
  retuning a class's mass in the panel keeps the tumble character intact.

### Expression and harness

- **`lil-gui`** for the panel: folders, live binding, value readout, no build
  step.
- **Audio is entirely synthesised** through the Web Audio API and needs a user
  gesture, so the panel carries an explicit "enable audio" button as well as
  starting on the first key press.
- **The debug handle `window.rp2`** exposes the car, params, physics world and
  props. It is what the headless verification drives, and it is useful from
  the browser console.

## M1 — Scaffold

- **Debug UI library: `lil-gui`.** Folders, live binding and value readout are
  all supported and it has no build-step requirements.
- **Physics rate: 120 Hz fixed accumulator**, catch-up capped at 0.25 s of
  simulation per frame so a slow machine degrades rather than spiralling.
  Rendering interpolates position and rotation between the last two steps.
- **Vite `base`** is `/RacingPhysics2/` for production builds only, so `npm run
  dev` still serves from root.
- **Deploy trigger** fires on `main` and on `claude/**` branches, because the
  repository had no default branch when the scaffold was created and the work
  lives on a `claude/` branch.
- **Rapier version pinned to the 0.14 line** (`@dimforge/rapier3d-compat`), the
  `compat` build so the WASM is inlined and no separate asset fetch is needed
  on GitHub Pages.
- **No declared `github-pages` environment on the deploy job.** With it, the
  job was rejected before it could schedule by an environment protection gate;
  `deploy-pages` publishes correctly without the declaration.

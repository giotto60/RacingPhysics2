# Decisions

Assumptions and choices made without asking. Newest first.

## Framing and rollover

- **The centre of mass is capped so every vehicle slides before it tips.** A car
  tips when the cornering force exceeds half its track divided by the height of
  its mass, and at the grip these cars now have, the height that follows is low:
  0.29 m for a saloon. That is the honest consequence of asking two g out of a
  road car -- the alternative is a car that rolls over the first time it is asked
  to corner properly, which is what it did. The cap is derived from each
  vehicle's own track and grip with a 25% margin, so it holds for a kart and for
  a nine-tonne fire engine without either being given a number of its own.
- **The camera no longer leads the car.** The lead was 0.32 m per m/s, and
  because the rig's yaw lags the car's through a corner it moved the car
  sideways across the screen as well as backwards: measured at 27 px right and
  51 px below centre mid-corner. It is zero by default, the car sits within a
  pixel of the middle of the window in every state, and the slider is still
  there for anyone who wants the extra road ahead.
- **`camera.framingX` moves the car across the screen**, as a fraction of the
  window's width. Zero is the middle of the window; about -0.13 is the middle of
  the part the tuning panel is not covering, which is the other thing "the
  middle of the screen" can reasonably mean.
- **The gearbox is geared from the wheel it turns.** A fixed final drive is fine
  for one wheel size and wrong for every other: on a truck's half-metre wheel it
  left the engine below idle at walking pace, so a nine-tonne fire engine pulled
  away on the weakest torque it has and reached 1 km/h in six seconds. The final
  drive now comes from the wheel radius and the class's top speed, which puts
  0-100 km/h at 2.6 s for a kart, 4.5 for a saloon, 12.6 for a truck, and never
  for the fire engine.

## Racing pass — a real circuit, opponents, and a vehicle per model

- **Every vehicle is derived, not tuned.** The class table in `models.ts` says
  what a vehicle *is* -- how long, how wide, how heavy, driven where, how much
  power and grip relative to the defaults -- and `setup.ts` derives the rest:
  inertia from the body box, wheelbase and tyre size from the hubs the artist
  placed, spring rates, bump stops and brake torque from the mass, steering lock
  from the length, drag from the frontal area. Adding a vehicle is one row.
- **Power and grip multipliers never drop below 1.** Every car got the rise that
  was asked for; a fire engine is slow because it weighs nine tonnes and a
  tractor because it is a tractor, not because either was handed a weaker
  engine than the defaults.
- **Wheels keep the size they were drawn at**, scaled with the body's width
  rather than its length, and the simulation takes that as its wheel radius. A
  fixed radius on a body stretched to a class length is what made the wheels
  look wrong; the mean of the four is used, because the simulation runs one
  wheel size and a tractor's rear tyres are half again its fronts.
- **Track width is floored at 85% of the body.** Kenney's kit tucks its hubs
  0.6 units apart inside a 1.5 unit shell -- a 40% track. At the grip the cars
  now have, a 40% track does not slide when pushed, it tips over, and that was
  precisely what was throwing the computer drivers into the air: they were
  rolling onto two wheels in the fast corners and catching a hull edge.
- **The computer drivers know their own rollover limit.** Cornering speed is
  taken from the lower of what the tyres can hold and what the track width and
  centre-of-mass height allow, so a van is driven like a van and a race car like
  a race car with nothing authored per vehicle to say so. They also look further
  ahead the straighter the road is, because a pursuit driver aiming at a distant
  point cuts the apex off a tight corner -- which is how they kept finding the
  kerbs.
- **An opponent is an ordinary `Car` with an ordinary `CarView`,** driven by
  inputs of the same shape the keyboard produces. There is no second physics
  path and no cheat: they share the player's parameters, which is why picking a
  car changes all three of them.
- **Opponents are recoloured by rotating the hue of the texture**, not by
  tinting the material. Both kits put their colour in the image -- Kenney's
  whole catalogue shares one palette -- so a material tint only darkens the
  paint towards the tint instead of changing it.
- **The circuit is a lemniscate of Bernoulli**, sampled directly rather than
  splined through hand-placed points. Its curvature varies smoothly all the way
  round, so the lobes are honest constant-radius sweepers, and its branches
  cross at right angles, which is what makes the crossing a crossing.
- **The ramps ease in and then run straight.** A plain wedge has a corner at the
  bottom that drives the suspension through its travel and throws the car off
  the end; rounding the whole profile fixes that but replaces it with a rotation
  rate, because a car following a curve is being pitched nose-up all the way
  along and keeps that rotation when the road stops. Easing in and then running
  straight has neither problem: measured over the big ramp at 30 m/s, the car
  now leaves at 1.8 degrees and lands at 2.2.
- **Wheel angular momentum is fed back into the chassis.** Spinning a wheel up
  takes a torque and that torque has to come from the body it hangs off, which
  the simulation was simply not telling it. On the ground the tyre force
  supplies it and the term is near zero, so nothing about driving changes; in
  the air the whole of it lands on the body, so the throttle pitches the nose up
  and the brake brings it down exactly as they do on a real car. That is the
  answer to a car rotating backwards off a jump: not a correction bolted on top
  of the physics, but a piece of the physics that was missing.
- **The ramps sit against one edge of the road, not across it.** Clipping a jump
  with the wheels down one side only is what rolls a car, so a ramp that
  overlaps a driving line is worse than no ramp at all. They are there to be
  aimed at.
- **The circuit is flat, and the crest is left in the code at zero height.** The
  road is a solid slab, so where it is raised its edges are cliffs: a car
  running wide on a raised section drops off the side and catches the slab wall
  on the way past. Elevation needs shoulders that rise with the road before it
  earns its place; the ramps carry the jumping in the meantime.
- **Kerbs are three centimetres proud and on the inside of the corners.** On the
  outside they are a trap for anyone who has already run wide, and any real
  height turns them into a launch ramp for whatever clips them at speed.
- **Nothing is placed on the circuit.** The prop world, the mass ladder and the
  freeze-on-budget debris all remain and can still be driven from the console;
  the racing surface is simply clear.
- **The car sits in the middle of the window**, with the panel overlapping the
  view rather than the framing being pushed sideways out of its way.

## Car models — a picker for the two supplied kits

- **The model is fitted to the car, never the car to the model.** Mass, centre
  of mass, inertia, wheelbase, track, springs, tyres and drivetrain are the
  tuning; a paint job does not get to overwrite them. A scripted stint --
  standing start, corner, brake to a stop -- lands on the same speed, the same
  body slip and the same final position to the millimetre whichever of the
  twenty-seven models is drawn.
- **The hull collider is the drawn body's box.** The one thing a model does
  change is the shape you crash with, because a drawn body that is not what the
  car collides with is exactly the sort of lie this project avoids: the race car
  is 0.95 m tall and the ambulance 1.92 m, and both hit things as they look.
  Picking "Blocks (built-in)" restores the authored 0.8 m box, which is what
  every number in the verified table was measured against.
- **This also gave the four hull sliders their first effect on anything.** They
  moved the drawn box and left the collider at its construction size, because
  nothing ever resized it. `Car.applyHullShape` now does.
- **Length and width come from the tuning, height from the model.** A model is
  stretched to the hull's footprint, so its wheel arches sit near the simulated
  wheels, and its height is scaled with the *width* so the view a car is mostly
  seen from keeps the proportions it was modelled with. Scaling height with the
  length instead turns a kart into a three-metre tower.
- **Ground clearance is 0.24 m, chosen by measurement rather than by eye.** The
  drawn body sits on the hull box, so the box's underside is the car's ground
  clearance -- but it is a square-cornered box where the real thing has a
  rounded nose, and it catches a ramp earlier than the shape suggests. Swept
  against the big ramp at 30 m/s: 0.16 m costs 1.4 m/s of entry speed and twelve
  scrape events, 0.24 m costs half that and five, and past 0.28 m nothing
  improves.
- **Wheels are the model's own where it has them.** Both kits name them, so they
  are lifted out of the hierarchy, re-centred on their hubs, scaled to the
  simulated wheel radius and hung on the suspension -- which means they carry
  the real compression, the real rack angle and the real spin. The Pony is a
  single welded mesh with no separable wheels, so it keeps the built-in ones.
- **Models are fetched at runtime, not bundled.** The textures in this project
  are drawn into canvases at boot precisely so the build stays one file, and
  5 MB of geometry does not belong in a JavaScript bundle. Only the chosen model
  is ever fetched, and each is cached after its first load.
- **The picker sits at the top level of the panel**, not in a folder: it is the
  only control there that changes what the player is looking at.
- **The nose marker is drawn only in blocks mode.** It exists so heading is
  readable at a glance in an isometric view; a car-shaped car does that by
  itself, and the wedge just looks like a wart on one.

## Fault pass — lighting, markings, resistance, gearbox, ground contact

- **Rolling resistance is a torque at the wheel, not a force at the contact
  patch.** As a force it was subtracted from the tyre force and then handed
  straight back to the wheel's own equation of motion, so the wheel simply spun
  a fraction faster until the tyre cancelled it exactly and the chassis felt
  nothing: measured coast-down was 0.035 m/s^2 at a coefficient of zero and
  0.050 m/s^2 at the slider's maximum. As a torque it has to reach the car
  through the contact patch like everything else, and the same three settings
  now give 0.0, 1.07 and 5.32 m/s^2.
- **That torque goes through the same denominator as the drive torque.** The
  wheel integrator is semi-implicit, so a torque applied outside its denominator
  is not damped by the tyre force opposing it. Left outside, rolling resistance
  came out several times its coefficient at walking pace -- enough that the car
  could not pull away at all -- and near its nominal value at speed.
- **Suspension force follows the contact normal, not the chassis up axis.**
  Tied to the chassis it gains a horizontal component the instant the car
  pitches, and at a standstill there is nothing to oppose it: the car settles
  nose-up on its springs and creeps backwards at 0.3 m/s for ever. This is also
  what Bullet's raycast vehicle does, for the same reason.
- **The shift schedule runs off road speed, not engine speed.** Engine speed
  follows the driven wheels, so wheelspin asked for a gear the car was not
  travelling fast enough to hold, the upshift killed the wheelspin, and the box
  asked for the old gear back several times a second. A standing start used to
  read `1 2 1 2 1 2 1 2 1 2 3` between 38 and 44 km/h; on a slippery surface it
  reached sixth gear at 4 km/h.
- **The shift guard bands are derived from the ratios rather than fixed.** A
  shift is allowed only if the gear it lands in would not immediately ask to
  shift back, which is a property of the ratio set, so any gearing stays stable
  without retuning. The limiter and the idle floor override the guard, because
  sitting on either is worse than one shift the guard would rather not have
  made, and a minimum dwell keeps that from becoming a new oscillation.
- **The road is a solid slab, not a ribbon of triangles.** A surface with no
  thickness is something a car can be pushed through, most obviously at the
  jump's lip, which is a vertical wall one triangle thick. The underside is
  buried below the grass, so on the flat none of it shows; where the road stands
  proud, at the crest and the jump, the sides are exactly the visible depth the
  raised road always should have had.
- **The second pass through a self-crossing is lifted 3.5 cm.** Two coplanar
  strips of road have no stable answer to which is in front, which is what made
  the lane markings flicker in and out at the crossing. Crossings are found by
  looking for samples far apart around the lap but close together in the world,
  so the lift follows the layout rather than a hard-coded coordinate, and it is
  ramped in over the whole approach so there is no step to drive over.
- **The suspension has a bump stop, and a positional guard behind it.** Past
  full travel the spring saturated and the chassis kept descending until the
  hull collider was inside the road; the wheels were drawn 27 cm under the
  surface on a 9 m drop and the hull reached the road itself. The bump stop
  carries an ordinary heavy landing, and beyond a 6 cm allowance the body is
  lifted clear and the velocity driving it into the ground is removed.
- **A ray only counts as ground if the surface faces up.** Otherwise a ray that
  catches a wall reports a grounded wheel and the suspension pushes the car
  sideways off it.
- **Dust and skid marks need real sliding speed, not just grip utilisation.**
  Utilisation is normalised, so it reads high at a crawl: a car creeping at
  0.3 m/s was throwing gravel. Sliding speed at the contact patch is the honest
  quantity and both channels now gate on it.
- **The visual roll exaggeration fades out away from upright.** Multiplying a
  roll angle works while the car is on its wheels, but an inverted car
  decomposes to roughly 180 degrees, and 180 x 1.75 is a completely different
  orientation -- the drawn car sat 135 degrees away from the physics body, one
  corner through the floor and the rest hanging over it. Upright behaviour is
  unchanged.
- **Shadow maps are always enabled and the switch moves `castShadow` on the
  lights.** Toggling `shadowMap.enabled` at runtime forces every material in the
  scene to recompile; toggling a light does not. The sun's shadow frustum tracks
  the camera target and is sized from the visible width, so a 2k map covers the
  screen instead of being spread over a kilometre of track nobody is looking at.
- **Headlights cast shadows too.** A beam that shines through a parked car reads
  as painted-on light rather than as a headlight. It costs two more shadow
  passes, and there is a switch for anyone who would rather have the frames.

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

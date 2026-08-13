# Decisions

Assumptions and choices made without asking. Newest first.

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
- **Ground is a 2 m thick box collider**, not a plane, so nothing can tunnel
  through it at speed.
- **Rapier version pinned to the 0.14 line** (`@dimforge/rapier3d-compat`), the
  `compat` build so the WASM is inlined and no separate asset fetch is needed
  on GitHub Pages.
- **No declared `github-pages` environment on the deploy job.** With it, the
  job was rejected before it could schedule by an environment protection gate;
  `deploy-pages` publishes correctly without the declaration.
- **Placeholder falling boxes** exist in the scaffold purely to prove the loop,
  interpolation and solver are live. They are removed at Milestone 2 when the
  car chassis lands.

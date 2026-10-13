# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A real-time 3D music visualizer built with Three.js, inspired by the classic iTunes Magnetosphere visualizer. A small n-body system of glowing planets orbits under gravity while charged particles stream along magnetic field lines, reacting to audio frequencies.

## Running locally

No build step, no dependencies to install. Serve the folder and open in a browser:
```
python3 -m http.server 8080
# open http://localhost:8080
```
Three modes: "Capture System Audio" (Chrome/Edge), "Load Audio File", or "Demo Mode" (synthetic audio).

After editing `visualizer.js`, bump the `?v=N` cache-buster on the script tag in `index.html` so the browser doesn't serve a stale copy.

## Project structure

Two files plus headless tests:
- `index.html`: entry point, overlay UI, keyboard help panel, Three.js CDN imports (via importmap)
- `visualizer.js`: all logic (~2300 lines, single monolithic file)
- `test/`: headless smoke suites (see Testing changes)

No build system, no bundler, no linter. Three.js 0.162 is loaded from CDN.

## Architecture (visualizer.js)

| Class | Role |
|-------|------|
| `AudioAnalyzer` | Web Audio FFT (fftSize 2048) plus the waveform. Bands by real frequency (bass 30-200 Hz, mid 200 Hz-2 kHz, treble 2-10 kHz, laid out from `ctx.sampleRate`), loudness from time-domain RMS. Each band normalizes against its own running peak (auto-leveler, ~30 s memory: it adapts to the source's level, not to a breakdown) so any source fills 0..1. Envelopes: 20 ms attack, 200 ms release (400 ms for loudness). Per-band onsets set `getOnset(band)` for one frame and fire `getHit(band)`, which jumps to the band's level (floor 0.35) and decays over ~250 ms. `getFreqAt(hz)` gives a particle its own leveled bin. Knobs in `AUDIO_TUNING`. |
| `DemoAnalyzer` | Synthetic 120 BPM track (kick, snare on 2 and 4, off-beat hats, 8-bar pad swell, a breakdown every fourth phrase) written into the FFT bytes and waveform, then run through the same `_analyze` as live audio. |
| `Core` | A planet. Owns a hidden ray fan (`rays`, a `LineSegments` on a shared unit fan; the Starburst look turns it on through `extras`). Has a `role` (`central`, `satellite` or `partner`), `mass`, `charge`, `radius`, lifecycle (`spawning -> alive -> collapsing -> dead`), and a custom GLSL shader (hot nucleus, halo, rim, drifting value-noise atmosphere). Keeps a 32-slot ring buffer of surface events (`addSurfaceEvent`: kind 0 flare spot, 1 ripple, 2 landing spot with the comet's colour) in object space; the nebula skin draws kinds 0 and 1 as a quick flare ring or a raindrop ripple, the glass skin draws kind 2 as a lingering lit spot. The ring is cleared when the skin changes. `applyLook` sets visibility, wireframe and the skin index (`uSkin`). Physics state (`position`, `velocity`, `acceleration`) is integrated by the Visualizer, not by the Core. |
| `MagneticParticles` | Up to 5000 particles thrown off source cores, mostly on bass hits. A hit grows 2-4 flare spots per source and the burst erupts from them; a low trickle runs between hits. Each particle's launch energy comes from its own frequency's level at that instant. Launches are lofted: most near-vertical, a tail down to ~25 degrees above the horizon (`launchElevMin`/`launchElevBias`), with a flare's burst leaning along the spot's jet direction. Near its source it is ballistic under the source's gravity (escape speed is the same on every body): a sub-escape launch rises as far as its speed allows, falls back, bounces once and lands; an unbound one hands over to the magnetic field once it is clear of the surface (`escapeRadii`). Escape is decided by energy, never by distance, so a lone sun gets fountains of different heights plus escapees rather than a hovering shell. Every alive core is a monopole with its `effectiveCharge`; escapees keep their momentum, feel gravity from every core for the whole flight, and are only nudged (`steer`, ~0.7 s to bend) along the summed field from positive cores to negative ones, where they land (if no positive core is alive the survivors emit outward instead). Landings and bounces register ripples on the surface. Under a look with `sim.charge` set, each particle carries a signed charge (magnitude from its live level) with Coulomb forces against the cores and grid-based separation between particles. All motion is `dt`-scaled. Knobs live in `PARTICLE_TUNING`. Rendered as a `Points` cloud plus a trail ring buffer (`TRAIL_POINTS` = 200 slots per particle, written at most 60 times a second so it holds 3.3 s at any refresh rate; slot-major, indexed `LineSegments`, fade by age in the shader so trail length is seconds). |
| `Nebula` | 12 procedural sprite blobs with additive blending. Off by default, toggled with B; a look can force it on or off. |
| `Visualizer` | Main orchestrator: scene, camera, bloom post-processing, system spawning, n-body physics, core lifecycle, camera drift. |

## Planet systems and physics

`_spawnSystem()` picks one of three configurations at random and gives each body initial conditions for a stable, mildly elliptical orbit (1.05x circular velocity):

- **solar** (40%): one heavy `central` body (mass 7-10, radius ~2, charge +1) with 2-3 small `satellite` bodies (charge -0.8) at increasing orbital radii
- **binary** (35%): two `partner` bodies of similar mass orbiting their barycenter (charges +1 / -1), with a 50% chance of a distant outer `satellite` (charge +0.5)
- **trinary** (25%): three `partner` bodies at 120 degrees (charges +1, -1, +0.8)

`_updatePhysics()` runs a symplectic Euler n-body step every frame: gravitational attraction between all alive cores (`PHYSICS_G = 1.4`, scaled up to 1.4x by bass), softening 0.8, very light damping, then a mass-weighted pull of the center of mass back toward the origin (~95%/s) so the system never drifts offscreen. `effectiveMass` fades to zero across a body's collapse so the barycenter shifts smoothly when a body dies. `dt` is clamped to 1/30 s so a tab switch doesn't blow up the integration.

Charges are only used for the particle <-> core interaction. Gravity is mass-based and always attracting.

Lifecycle: spawn (2-3.5 s elastic scale-in), alive (35-85 s), collapse (2.5-4 s scale-out), dead (mesh destroyed). When the last body of a system dies, a new system spawns. With a planet count locked (`targetBodies`, keys 1-5) the system is kept at that size instead: extra bodies collapse lightest-and-outermost first, missing ones are added as satellites on a circular orbit outside the outermost body (or a new sun at the barycenter if nothing heavy is left), and a fresh system is built at that size (1 lone sun, 2 binary, 3 solar or trinary, 4-5 solar). A collapsing core pulls nearby particles in (and stops absorbing them past 30% collapse so they pile up), then releases them in an outward burst on the frame it dies.

## Camera

One continuous slow drift around the system barycenter: azimuth advances ~one revolution per 100 s, elevation and distance breathe on different slow periods, and distance scales with the system's current extent so every body stays framed. Position and look-at are lerped.

**Design rule: camera movement must always be smooth and gentle.** No sudden jumps, shakes, or beat-synced camera motion. It causes motion sickness. (Particles can be snappy; the camera cannot.)

## Looks & palettes

A visual mode is a "look": a declarative object built with `makeLook(name, overrides)` over `LOOK_DEFAULTS`, in the `LOOKS` array (M/N cycle it). Each subsystem reads its own section in `applyLook(look, palette)`:

- `planet`: `skin` (index into `PLANET_SKINS`: `nebula`, `glass`, `rings`, `silhouette`; branches in the planet fragment shader), `visible`, `wireframe`, `landing` (`ripple` / `spot`: what a landing registers on the surface), `spotLife`
- `particles`: `sprite` (index into `SPRITES`: `disc`, `comet`, `star`; branches in the point shaders, comet orients by the velocity attribute, star draws a lens cross on the bigger bright points), `size`, `hueScatter` (per-particle hue offset), `countMul` (keep at 1 unless density is the look's point, as in Dense: Joseph wants the pool to stay at the count he set, so the machine isn't taxed)
- `trails`: `style` (`line` / `comet` / `hair` / `none`; comet is a cubic brightness taper with a hot tip, hair an even strand with a soft root), `seconds`, `opacity`, `drain` (a landed particle's strand stays and fades from the root instead of vanishing; the particle's slot is held until it has faded)
- `sim`: `charge` (`none` / `frequency` / `random`), `coulomb`, `separation`, `chargeGain`, `emission` (`spots` / `even`: bursts from flare spots or from the whole surface), `energy` / `speed` / `trickle` (multipliers on `PARTICLE_TUNING`, 1.0 = as tuned), `poolQuiet` (null = `PARTICLE_TUNING.poolQuiet`)
- `scene`: `nebula` (`auto` / `on` / `off`), `nebulaGain`, `bloom` multiplier, `fog`, `background` (`dark` / `light`), `stars`, `haze` (0..1, lifts the background toward the palette's outer colour)
- `extras`: names of extra passes a look owns. Live: `links` (MagneticParticles: a web of segments between stars within `links.radius`, up to `links.perParticle` each counting both ends, `links.maxPairs` a frame in a fixed `LineSegments` buffer drawn through its draw range, rebuilt from the spatial grid after the move; `links.opacity`) and `rays` (each Core: a fan of `rays.count` straight rays of `rays.length` world units at radius 1, breathing with the bass, spinning at `rays.spin` rad/s about a tilted axis, `rays.opacity`; nothing uploaded per frame). `labels`, `streamlines` are for later looks

Unknown skin, sprite or style names fall back to today's, so a look can be added one section at a time. The original eight (Classic, Wireframe, Rays Only, Points, Long Trails, Wire Rays, Ghost, Dense) are expressed in this schema with their old values. Comets is the ninth: glass skin, comet sprite and trail style, hue scatter 0.2, landings register lingering spots. Anemone is the tenth: ring-nucleus skin, hair trails that drain on landing, bursts from the whole surface, capped launches, separation, nebula on, stars off; Aurora is the palette of the reference frame. Starburst is the eleventh: silhouette skin (a near-black body carrying the glass skin's landing spots), star sprites, no trails, the `links` and `rays` passes, even emission with capped launches, nebula on, stars off, a lifted violet background; Amethyst is the palette of the reference frame. All three run at the chosen particle count; `A` adds more.

8 colour palettes in `PALETTES`, cycled with P. "Palette from Image" on the start panel, or dropping an image anywhere, runs `paletteFromPixels` (dominant colours, assigned by brightness and saturation) and appends a palette named after the file; `bg` is dimmed near black for dark looks, `bgLight` keeps the raw colour for a light look.

## Keyboard shortcuts

`M`/`N` cycle modes, `P` cycle palettes, `F` freeze (stops core physics and shader time; particles and camera keep moving), `B` toggle nebula, `A`/`S` add/remove 200 particles, `1`-`5` set and hold the number of planets (`0` back to random systems), `?` help, `Esc` close help. Drop an image on the page for a palette.

## Testing changes

Headless first: `node test/run.mjs` (Node 18+, no install). `test/harness.mjs` loads `visualizer.js` under a stub `THREE` with no DOM or WebGL and exports the classes; the suites drive them for simulated seconds and check behaviour, not pixels:
- `smoke-particles.mjs`: emission, bounce vs escape by energy, the loudness and kick balance, surface rings, collapse and death burst, lone sun (no hover shell), lone sink
- `smoke-audio.mjs`: band layout, silence, the demo track through the real `_analyze` (hits at 2/s, none in the breakdown, accents, leveler range), particle bursts on hits
- `smoke-planets.mjs`: a `Visualizer` built from its prototype (no renderer): locked spawns 1-5, lock up and down, refill, sun replacement, 60 s of physics under a lock
- `smoke-looks.mjs`: looks schema, every look applied across every palette, `paletteFromPixels` on a synthetic image

Each suite prints the numbers it measured next to PASS/FAIL, which is the fastest way to see what a tuning change did.

Shaders and pixels: `sh test/screenshots.sh [Look ...]` (default: every look) serves the folder and drives headless Chrome with SwiftShader through `?demo&look=<name>&planets=3`, writing `test/.generated/shots/<look>.png` and the page console to `console.log`, so a GLSL compile error or a JS exception shows up without a hand on the browser, and the frames can be compared by eye. `BUDGET=20000` runs longer before the capture; `PALETTE=Aurora` picks the palette. URL parameters for any scripted run: `?demo` (start Demo Mode), `look=`, `palette=` (name or index), `planets=1..5`, `nebula=1`.

Then in the browser:
1. `python3 -m http.server 8080`, open localhost:8080
2. Click "Demo Mode" for quick iteration (no audio source needed)
3. Use `F` (freeze) to inspect planets at rest
4. Use `M`/`N` to verify changes look good across all visual modes
5. Let it run through at least one full system lifecycle (a few minutes) to see a spawn, collapse and respawn
6. Judge audio reactivity on a real track ("Load Audio File"), not only Demo Mode
7. A JS error or a lost GPU context is written in red into the info corner (and a lost context reloads the page), so a black screen with no red text was not one of those

## What reacts to what

- Bass envelope: planet glow, central light, gravity (`G` up to 1.3x)
- Bass hit: planet flash and ~5% swell, light and bloom spike, flare spots on each source and a burst of particles from them. Kick strength scales the flash, the burst size and every launched particle's energy, so a hard kick throws particles faster and farther and more of them escape
- Mid envelope: planet glow (lightly)
- Treble envelope: particle shimmer
- Loudness (RMS): how many particles may be in flight (`poolQuiet` of the pool at silence, all of it at full loudness), the slider between falling back and interchange (launch energy gain), how hard hits land on the planets and in the burst size, particle trickle rate and field speed, particle brightness floor, bloom, nebula opacity
- Each particle's own frequency: its launch energy (fall back and bounce vs escape to another planet), which is also its cruising speed for the whole trip, plus its brightness
- Camera: nothing. It never reacts to audio

## Project tracker

### Completed themes
- **Foundation**: initial visualizer -> Magnetosphere rewrite with magnetic field physics
- **Planet rendering**: explored vertex displacement and GPU shaders, settled on static spheres with a nucleus/halo/rim shader and drifting atmosphere noise
- **Smoothness & feel**: iterative removal of beat-reactive jerkiness; asymmetric smoothing (fast rise, slow decay)
- **Camera & composition**: single smooth drift around the barycenter, extent-aware framing, smooth-only rule
- **Orbital dynamics**: cores rewritten as an n-body gravity sim with solar / binary / trinary system types and smooth barycenter handoff on collapse
- **Field-line particles**: particles trace the monopole field from positive to negative cores, `dt`-scaled, with emission that thins out when quiet, collapse pull and death burst
- **Audio analysis**: real-frequency bands, RMS loudness, auto-leveler, musical envelopes, per-band onsets with a decaying hit, log-spaced particle listeners, a demo track with beats and a breakdown
- **Emission and surface**: beat-driven bursts from flare spots, launch energy by frequency (bounce vs escape under source gravity), flare and ripple rings on the planet surface
- **Looks plumbing**: declarative looks per subsystem, trail ring buffer with shader fade, signed particle charge with Coulomb and separation, palette from an image
- **Comets look**: dark glass planets lit by lingering landing spots, oriented comet sprites, cubic-taper trails with a hot tip, hue scatter
- **Anemone look**: ring-nucleus skin, hair trails that drain on landing, even emission, launch energy cap, separation walk visits the home cell first
- **Starburst look**: silhouette skin, star sprites with a lens cross, the first extras passes (a neighbour web from the spatial grid in a fixed capped buffer, a ray fan per body on a shared geometry), background haze
- **UI polish**: help overlay, keyboard shortcuts, mode/palette cycling, overlay z-index fixes

### Open work areas

1. **Particle feel**: tune `PARTICLE_TUNING` by eye (burst size, spots, launch speeds, `srcGravity` for the bounce/escape split, shimmer, pull)
   - Ring sizes and lives are constants in the planet fragment shader (angular, so small bodies get small ripples)
   - Trails are JS arrays with `splice`, GC churn at 5000 particles
   - Draining is per look (`trails.drain`); the eight originals and Comets still pop their short trails on landing
   - Particles ignore `role` beyond the sign of the charge

2. **Audio feel**: tune `AUDIO_TUNING` on real tracks across genres (onset ratios, leveler memory, hit decay)
   - Mid and treble hits are computed but nothing uses them yet (snare flash, hat sparkle)
   - Palette or hue could follow the spectral balance

3. **New looks** (Magnetosphere 1.0 vocabulary, in this order): Ribbons (flat Processing era, ribbon strips, light background), Attractor (the "inner logic" view: labels, orbit rings, drawn field lines)
   - Starburst is in; tune by eye on a real display: `links.radius` / `links.opacity` (web density), `rays.length` / `rays.opacity`, `scene.haze` and `nebulaGain` (the violet bath)
   - Each look adds its skin / sprite / extras under the schema above; shaders branch on `uSkin` / `uSprite`

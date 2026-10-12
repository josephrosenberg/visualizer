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

Two files, that's it:
- `index.html`: entry point, overlay UI, keyboard help panel, Three.js CDN imports (via importmap)
- `visualizer.js`: all logic (~1400 lines, single monolithic file)

No build system, no bundler, no tests, no linter. Three.js 0.162 is loaded from CDN.

## Architecture (visualizer.js)

| Class | Role |
|-------|------|
| `AudioAnalyzer` | Web Audio FFT (fftSize 2048) plus the waveform. Bands by real frequency (bass 30-200 Hz, mid 200 Hz-2 kHz, treble 2-10 kHz, laid out from `ctx.sampleRate`), loudness from time-domain RMS. Each band normalizes against its own running peak (auto-leveler, ~30 s memory: it adapts to the source's level, not to a breakdown) so any source fills 0..1. Envelopes: 20 ms attack, 200 ms release (400 ms for loudness). Per-band onsets fire `getHit(band)`, which jumps to 1 and decays over ~250 ms. `getFreqAt(hz)` gives a particle its own leveled bin. Knobs in `AUDIO_TUNING`. |
| `DemoAnalyzer` | Synthetic 120 BPM track (kick, snare on 2 and 4, off-beat hats, 8-bar pad swell, a breakdown every fourth phrase) written into the FFT bytes and waveform, then run through the same `_analyze` as live audio. |
| `Core` | A planet. Has a `role` (`central`, `satellite` or `partner`), `mass`, `charge`, `radius`, lifecycle (`spawning -> alive -> collapsing -> dead`), and a custom GLSL shader (hot nucleus, halo, rim, drifting value-noise atmosphere). Keeps a 32-slot ring buffer of surface events (`addSurfaceEvent`: flare spots, landings, bounces) in object space; the shader draws them as a quick flare ring or a raindrop ripple. Physics state (`position`, `velocity`, `acceleration`) is integrated by the Visualizer, not by the Core. |
| `MagneticParticles` | Up to 5000 particles thrown off source cores, mostly on bass hits. A hit grows 2-4 flare spots per source and the burst erupts from them; a low trickle runs between hits. Each particle's launch energy comes from its own frequency's level at that instant. Near its source it is ballistic under the source's gravity (escape speed is the same on every body): low energy rises, bounces once and lands; high energy clears ~2 radii and hands over to the magnetic field. Every alive core is a monopole with its `effectiveCharge`, escapees follow the summed field from positive cores to negative ones and land there (if no positive core is alive the survivors emit outward instead). Landings and bounces register ripples on the surface. All motion is `dt`-scaled. Knobs live in `PARTICLE_TUNING`. Rendered as a `Points` cloud plus a `LineSegments` trail buffer. |
| `Nebula` | 12 procedural sprite blobs with additive blending. Off by default, toggled with B. |
| `Visualizer` | Main orchestrator: scene, camera, bloom post-processing, system spawning, n-body physics, core lifecycle, camera drift. |

## Planet systems and physics

`_spawnSystem()` picks one of three configurations at random and gives each body initial conditions for a stable, mildly elliptical orbit (1.05x circular velocity):

- **solar** (40%): one heavy `central` body (mass 7-10, radius ~2, charge +1) with 2-3 small `satellite` bodies (charge -0.8) at increasing orbital radii
- **binary** (35%): two `partner` bodies of similar mass orbiting their barycenter (charges +1 / -1), with a 50% chance of a distant outer `satellite` (charge +0.5)
- **trinary** (25%): three `partner` bodies at 120 degrees (charges +1, -1, +0.8)

`_updatePhysics()` runs a symplectic Euler n-body step every frame: gravitational attraction between all alive cores (`PHYSICS_G = 1.4`, scaled up to 1.4x by bass), softening 0.8, very light damping, then a mass-weighted pull of the center of mass back toward the origin (~95%/s) so the system never drifts offscreen. `effectiveMass` fades to zero across a body's collapse so the barycenter shifts smoothly when a body dies. `dt` is clamped to 1/30 s so a tab switch doesn't blow up the integration.

Charges are only used for the particle <-> core interaction. Gravity is mass-based and always attracting.

Lifecycle: spawn (2-3.5 s elastic scale-in), alive (35-85 s), collapse (2.5-4 s scale-out), dead (mesh destroyed). When the last body of a system dies, a new system spawns. A collapsing core pulls nearby particles in (and stops absorbing them past 30% collapse so they pile up), then releases them in an outward burst on the frame it dies.

## Camera

One continuous slow drift around the system barycenter: azimuth advances ~one revolution per 100 s, elevation and distance breathe on different slow periods, and distance scales with the system's current extent so every body stays framed. Position and look-at are lerped.

**Design rule: camera movement must always be smooth and gentle.** No sudden jumps, shakes, or beat-synced camera motion. It causes motion sickness. (Particles can be snappy; the camera cannot.)

## Visual modes & palettes

8 visual modes (Classic, Wireframe, Rays Only, Points, Long Trails, Wire Rays, Ghost, Dense) in the `MODES` array. A mode sets core visibility, wireframe, ray style (`ribbon` / `line` / `point`), trail length and a particle multiplier. The `metalness` / `roughness` fields are set as uniforms but the planet shader does not read them. 8 color palettes in `PALETTES`. Cycled with M/N and P keys.

## Keyboard shortcuts

`M`/`N` cycle modes, `P` cycle palettes, `F` freeze (stops core physics and shader time; particles and camera keep moving), `B` toggle nebula, `A`/`S` add/remove 200 particles, `?` help, `Esc` close help.

## Testing changes

1. `python3 -m http.server 8080`, open localhost:8080
2. Click "Demo Mode" for quick iteration (no audio source needed)
3. Use `F` (freeze) to inspect planets at rest
4. Use `M`/`N` to verify changes look good across all visual modes
5. Let it run through at least one full system lifecycle (a few minutes) to see a spawn, collapse and respawn
6. Judge audio reactivity on a real track ("Load Audio File"), not only Demo Mode

## What reacts to what

- Bass envelope: planet glow, central light, gravity (`G` up to 1.3x)
- Bass hit: planet flash and ~5% swell, light and bloom spike, flare spots on each source and a burst of particles from them (bigger on a harder kick)
- Mid envelope: planet glow (lightly)
- Treble envelope: particle shimmer
- Loudness (RMS): how many particles may be in flight (`poolQuiet` of the pool at silence, all of it at full loudness), the slider between falling back and interchange (launch energy gain), how hard hits land on the planets and in the burst size, particle trickle rate and field speed, particle brightness floor, bloom, nebula opacity
- Each particle's own frequency: its launch energy (fall back and bounce vs escape to another planet), its speed along the line and its brightness
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
- **UI polish**: help overlay, keyboard shortcuts, mode/palette cycling, overlay z-index fixes

### Open work areas

1. **Particle feel**: tune `PARTICLE_TUNING` by eye (burst size, spots, launch speeds, `srcGravity` for the bounce/escape split, shimmer, pull)
   - Ring sizes and lives are constants in the planet fragment shader (angular, so small bodies get small ripples)
   - Trails are JS arrays with `splice`, GC churn at 5000 particles
   - A particle's trail vanishes with it on landing instead of draining into the core
   - Particles ignore `role` beyond the sign of the charge

2. **Audio feel**: tune `AUDIO_TUNING` on real tracks across genres (onset ratios, leveler memory, hit decay)
   - Mid and treble hits are computed but nothing uses them yet (snare flash, hat sparkle)
   - Palette or hue could follow the spectral balance

3. **New visual effects**: expanding the visual vocabulary
   - New visual modes or shader experiments
   - Post-processing effects (chromatic aberration, film grain, etc.)
   - Planet surface detail (procedural textures, atmosphere glow)

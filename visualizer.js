import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ─── Color Palettes ──────────────────────────────────────────────────────────

const PALETTES = [
  { name: 'Sapphire',  core: 0x8899cc, rayInner: 0x6699ff, rayOuter: 0x2244aa, bg: 0x000008 },
  { name: 'Ember',     core: 0xccaa88, rayInner: 0xff8844, rayOuter: 0xaa2211, bg: 0x080200 },
  { name: 'Amethyst',  core: 0xaa88cc, rayInner: 0xcc66ff, rayOuter: 0x6622aa, bg: 0x050008 },
  { name: 'Aurora',    core: 0x88ccaa, rayInner: 0x44ffaa, rayOuter: 0x118844, bg: 0x000805 },
  { name: 'Solar',     core: 0xcccc88, rayInner: 0xffdd44, rayOuter: 0xaa8811, bg: 0x080800 },
  { name: 'Ice',       core: 0xaabbcc, rayInner: 0x88ccff, rayOuter: 0x3366aa, bg: 0x000510 },
  { name: 'Rose',      core: 0xcc8899, rayInner: 0xff6688, rayOuter: 0xaa2244, bg: 0x080005 },
  { name: 'Monochrome',core: 0xbbbbbb, rayInner: 0xffffff, rayOuter: 0x666666, bg: 0x050505 },
];

// ─── Looks (visual modes) ────────────────────────────────────────────────────

// A look is declarative: each subsystem reads its own section in applyLook.
// Unknown skins, sprites or styles fall back to the defaults, so a new look
// can be added one section at a time. Palettes are separate (P key).
//
//   planet:    { skin, visible, wireframe, landing: 'ripple' | 'spot', spotLife }
//   particles: { sprite, size, hueScatter, countMul }
//   trails:    { style: 'line' | 'comet' | 'hair' | 'ribbon' | 'none', seconds, opacity, drain }
//                // ribbon: the strand drawn as a flat strip by the ribbon renderer (Ribbons, Paper); dials in `ribbons`;
//                // a landed strand always stays and fades by age (drain is implied), seconds caps at (RIBBON_POINTS - 2) / 60
//   sim:       { charge: 'none' | 'frequency' | 'random', coulomb, separation, chargeGain,
//                emission: 'spots' | 'even', energy, speed, trickle, poolQuiet }
//                // energy, speed, trickle multiply PARTICLE_TUNING (1.0 = as tuned);
//                // poolQuiet null = PARTICLE_TUNING.poolQuiet
//   scene:     { nebula: 'auto' | 'on' | 'off', nebulaGain, bloom, fog, background: 'dark' | 'light', stars, haze }
//                // haze 0..1 lifts the background toward the palette's outer colour (0 = as the palette says)
//   extras:    []   // passes a look owns: 'links', 'rays' (Starburst), 'shards' (Ribbons, Paper), dials below; 'orbits', 'streamlines', 'labels' (Attractor, dials below)
//   links:     { radius, perParticle, maxPairs, opacity }   // the web between neighbouring stars, read only when extras has 'links'
//   rays:      { count, length, spin, opacity }             // the ray fan per body, read only when extras has 'rays'
//   orbits:    { ringRadius, dots, dotSize, spin, circleRadius, tilt, precess, opacity, circleOpacity }
//                // per body: a ring of dots on the world equator and a thin leaning circle, read only when extras has 'orbits'
//   streamlines: { perBody, steps, step, every, opacity, flow }   // field lines seeded round every body, re-integrated every `every` frames,
//                // read only when extras has 'streamlines'
//   labels:    { count, scale, bodyScale, opacity }   // "PARTICLE 0183" tags on a fixed subset of particles and the role in caps beside
//                // each body, read only when extras has 'labels'
//   ribbons:   { width, speedRef, twist, roll, taper: 'tip' | 'bulge', shade: 'lit' | 'flat', tint, accentHue }
//                // the strip renderer, read only when trails.style is 'ribbon': width in world units at full share, speedRef the
//                // speed at full width, twist = roll per radian of turn, roll in rad/s of the strand's own, tint 0 grey .. 1 palette,
//                // accentHue the hue shift of the third flat colour
//   shards:    { perHit, speed, life, length, width, opacity }   // angular slivers thrown off every source on a bass hit, read only when extras has 'shards'
const LOOK_DEFAULTS = {
  planet:    { skin: 'nebula', visible: true, wireframe: false, landing: 'ripple', spotLife: 3.0 },
  particles: { sprite: 'disc', size: 1.0, hueScatter: 0, countMul: 1.0 },
  trails:    { style: 'line', seconds: 0.5, opacity: 0.6, drain: false },
  sim:       { charge: 'none', coulomb: 0, separation: 0, chargeGain: 1.0,
               emission: 'spots', energy: 1.0, speed: 1.0, trickle: 1.0, poolQuiet: null },
  scene:     { nebula: 'auto', nebulaGain: 1.0, bloom: 1.0, fog: true, background: 'dark', stars: true, haze: 0 },
  extras:    [],
  links:     { radius: 1.5, perParticle: 3, maxPairs: 7500, opacity: 0.35 },   // no-op: nothing reads it unless extras has 'links'
  rays:      { count: 192, length: 6.0, spin: 0.06, opacity: 0.5 },            // no-op: nothing reads it unless extras has 'rays'
  orbits:      { ringRadius: 1.12, dots: 160, dotSize: 1.0, spin: 0.25, circleRadius: 1.5, tilt: 0.35, precess: 0.05, opacity: 0.9, circleOpacity: 0.35 },   // no-op: nothing reads it unless extras has 'orbits'
  streamlines: { perBody: 20, steps: 120, step: 0.12, every: 2, opacity: 0.22, flow: 1.0 },   // no-op: nothing reads it unless extras has 'streamlines'
  labels:      { count: 48, scale: 1.0, bodyScale: 1.6, opacity: 0.8 },                       // no-op: nothing reads it unless extras has 'labels'
  ribbons:   { width: 0.14, speedRef: 4.0, twist: 1.0, roll: 0.5, taper: 'tip', shade: 'lit', tint: 0.35, accentHue: 0.3 },   // no-op: nothing reads it unless trails.style is 'ribbon'
  shards:    { perHit: 6, speed: 3.5, life: 0.6, length: 0.8, width: 0.12, opacity: 0.45 },                                  // no-op: nothing reads it unless extras has 'shards'
};

function makeLook(name, overrides = {}) {
  const look = { name };
  for (const key of Object.keys(LOOK_DEFAULTS)) {
    look[key] = Array.isArray(LOOK_DEFAULTS[key])
      ? [...(overrides[key] || LOOK_DEFAULTS[key])]
      : { ...LOOK_DEFAULTS[key], ...(overrides[key] || {}) };
  }
  return look;
}

// The original eight, in the new schema with the same values. Trail seconds
// replace point counts: the old lengths were points at 60 fps, 30 = 0.5 s.
const LOOKS = [
  makeLook('Classic',     { trails: { seconds: 0.5 } }),
  makeLook('Wireframe',   { planet: { wireframe: true }, trails: { seconds: 0.67 } }),
  makeLook('Rays Only',   { planet: { visible: false }, trails: { seconds: 0.58 } }),
  makeLook('Points',      { trails: { style: 'none' } }),
  makeLook('Long Trails', { trails: { seconds: 1.0 } }),
  makeLook('Wire Rays',   { planet: { wireframe: true }, trails: { seconds: 0.42 } }),
  makeLook('Ghost',       { planet: { visible: false }, trails: { seconds: 0.83 } }),
  makeLook('Dense',       { particles: { countMul: 2.5 }, trails: { seconds: 0.83 } }),
  // iTunes-era comets: every particle is a white-hot head with a tapered
  // streak, hues scattered so a burst reads multi-colour, and the planets
  // are dark glass that light up where the comets land.
  makeLook('Comets', {
    planet:    { skin: 'glass', landing: 'spot', spotLife: 3.0 },
    particles: { sprite: 'comet', size: 2.2, hueScatter: 0.2 },
    trails:    { style: 'comet', seconds: 1.0, opacity: 0.7 },
    scene:     { bloom: 1.25 },
  }),
  // Hodgin's Magnetosphere anemones: dark bodies with a ring nucleus (a
  // white-hot centre, a bright ring, a dark gap, faint outer rings) and
  // thousands of hair-thin strands that mostly hug their body. Launches are
  // capped low (fountains and slow escapes, no comets), bursts erupt from the
  // whole surface, separation fans the strands, every strand ends in a small
  // bright dot and drains into the body when it lands, and the nebula fills
  // the frame. Aurora is the palette of the reference frame.
  makeLook('Anemone', {
    planet:    { skin: 'rings' },
    particles: { sprite: 'disc', size: 0.6, hueScatter: 0.08 },
    trails:    { style: 'hair', seconds: 3.0, opacity: 0.3, drain: true },
    sim:       { charge: 'random', coulomb: 0, separation: 1.0, emission: 'even', energy: 0.6, speed: 0.5, trickle: 2.5, poolQuiet: 0.5 },
    scene:     { nebula: 'on', nebulaGain: 1.6, bloom: 1.1, stars: false },
  }),
  // Hodgin's starburst: every particle a star (a white-hot point in a soft
  // halo, a faint lens cross on the bright ones), long straight rays fanning
  // out of every body that breathe with the bass and turn slowly, a web of
  // fine lines between stars that are near each other, planets as dark
  // silhouettes carrying the lit dots of what has landed (the glass skin's
  // spots on a near-black body), and a violet haze. Bursts leave the whole
  // surface and launches are capped, so most stars hover in a shell around
  // their body and some stream on to the sinks. No trails: the rays and the
  // web are the line work. Links and rays are passes the look owns, named
  // in extras and dialled in their own sections. Amethyst is the palette of
  // the reference frame.
  makeLook('Starburst', {
    planet:    { skin: 'silhouette', landing: 'spot', spotLife: 3.0 },
    particles: { sprite: 'star', size: 1.8, hueScatter: 0.15 },
    trails:    { style: 'none' },
    sim:       { emission: 'even', energy: 0.7, speed: 0.7, trickle: 2.0, poolQuiet: 0.5 },
    scene:     { nebula: 'on', nebulaGain: 1.6, bloom: 1.3, stars: false, haze: 0.08 },
    extras:    ['links', 'rays'],
    links:     { radius: 2.0, perParticle: 3, maxPairs: 7500, opacity: 0.35 },
    rays:      { count: 192, length: 6.0, spin: 0.06, opacity: 0.5 },
  }),
  // Hodgin's "inner logic" frame, the ATTRACTOR still: a fiery, boiling body
  // with a bright equatorial glow, a dense ring of dots turning on its
  // equator and a thin leaning orbit circle outside it; the field drawn as
  // faint lines that leave the sources and bend into the sinks like a
  // magnetosphere diagram, with pulses running along them; particles as
  // short streaks along those lines; a sparse constellation web between
  // neighbours; tiny "PARTICLE 0183" tags on a fixed subset of them and the
  // body's role in caps beside each body. No trails: the field lines are
  // the line work. Launches are capped so most particles stay near their
  // body; the ring and the orbit are drawn, not simulated. Orbits,
  // streamlines and labels are passes the look owns, named in extras and
  // dialled in their own sections. Ember and Solar are the palettes of the
  // reference frame.
  makeLook('Attractor', {
    planet:      { skin: 'hot', landing: 'spot', spotLife: 1.2 },
    particles:   { sprite: 'streak', size: 2.0, hueScatter: 0.06 },
    trails:      { style: 'none' },
    sim:         { emission: 'even', energy: 0.65, speed: 0.8, trickle: 1.5, poolQuiet: 0.5 },
    scene:       { nebula: 'on', nebulaGain: 0.9, bloom: 1.15, stars: false, haze: 0.04 },
    extras:      ['orbits', 'streamlines', 'links', 'labels'],
    links:       { radius: 1.6, perParticle: 2, maxPairs: 7500, opacity: 0.18 },
    orbits:      { ringRadius: 1.12, dots: 160, dotSize: 1.0, spin: 0.25, circleRadius: 1.5, tilt: 0.35, precess: 0.05, opacity: 0.9, circleOpacity: 0.35 },
    streamlines: { perBody: 20, steps: 120, step: 0.12, every: 2, opacity: 0.22, flow: 1.0 },
    labels:      { count: 48, scale: 1.0, bodyScale: 1.6, opacity: 0.8 },
  }),
  // Hodgin's grey ribbons: every trail a thin flat strip of tape that widens
  // with speed, twists as its particle turns and catches a key light as it
  // does, radiating from white-hot bodies; soft glowing dots at the heads,
  // faint lines between neighbouring dots (the links pass) and angular
  // slivers thrown off the bodies on a kick (the shards pass). Additive on
  // black, colour pulled most of the way to grey so any palette reads as a
  // tint; Monochrome is the palette of the reference frame. A landed strand
  // stays and fades like tape settling.
  makeLook('Ribbons', {
    planet:    { skin: 'nebula' },
    particles: { sprite: 'disc', size: 1.3, hueScatter: 0 },
    trails:    { style: 'ribbon', seconds: 1.8, opacity: 0.55 },
    ribbons:   { width: 0.14, speedRef: 4.0, twist: 1.0, roll: 0.5, taper: 'tip', shade: 'lit', tint: 0.35 },
    sim:       { emission: 'even', energy: 1.0, speed: 1.0, trickle: 1.5, poolQuiet: 0.4 },   // full energy: the long ribbons are the tails of escapees
    scene:     { nebula: 'off', bloom: 1.3, stars: false },
    extras:    ['links', 'shards'],
    links:     { radius: 1.6, perParticle: 2, maxPairs: 7500, opacity: 0.18 },
    shards:    { perHit: 6, speed: 3.5, life: 0.6, length: 0.8, width: 0.12, opacity: 0.45 },
  }),
  // The 2004 Processing prototype: a flat light ground derived from the
  // palette, no lighting, no bloom, no fog, no stars. Planets are flat discs
  // with a drawn outline, particles flat circles of many sizes with an
  // outline, ribbons calligraphic strokes (thin at both ends, widest
  // mid-strand) in three flat palette colours (inner, outer and an accent
  // hue-shifted from the inner), and a kick throws thin hairlines. Sapphire
  // is the palette of the reference frame.
  makeLook('Paper', {
    planet:    { skin: 'paper' },
    particles: { sprite: 'flat', size: 3.0, hueScatter: 0 },
    trails:    { style: 'ribbon', seconds: 2.0, opacity: 0.92 },
    ribbons:   { width: 0.34, speedRef: 3.0, twist: 0.6, roll: 0.4, taper: 'bulge', shade: 'flat', tint: 1.0, accentHue: 0.3 },
    sim:       { emission: 'even', energy: 1.0, speed: 0.8, trickle: 1.2, poolQuiet: 0.4 },
    scene:     { nebula: 'off', bloom: 0, fog: false, background: 'light', stars: false },
    extras:    ['shards'],
    shards:    { perHit: 4, speed: 3.0, life: 0.9, length: 1.6, width: 0.03, opacity: 0.7 },
  }),
];
const MODES = LOOKS;

// Planet skins and particle sprites by name; the shaders branch on the index.
const PLANET_SKINS = { nebula: 0, glass: 1, rings: 2, silhouette: 3, paper: 4, hot: 5 };
const SPRITES = { disc: 0, comet: 1, star: 2, flat: 3, streak: 4 };

// ─── Palette from an image ───────────────────────────────────────────────────

// Dominant colours of an image, Hodgin's "colors pulled procedurally from
// input photography". A 4-bit-per-channel histogram, the most common bins
// with a minimum distance between picks, then assignment by brightness and
// saturation. `bg` is dimmed to near black for the dark looks; `bgLight` is
// the raw darkest colour for a flat look.
function paletteFromPixels(data, name = 'Image') {
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    let e = counts.get(key);
    if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; counts.set(key, e); }
    e.n++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2];
  }
  const bins = [...counts.values()]
    .map(e => ({ n: e.n, r: e.r / e.n / 255, g: e.g / e.n / 255, b: e.b / e.n / 255 }))
    .sort((a, b) => b.n - a.n);
  const picks = [];
  for (const b of bins) {
    if (picks.every(p => Math.hypot(p.r - b.r, p.g - b.g, p.b - b.b) > 0.18)) picks.push(b);
    if (picks.length >= 6) break;
  }
  while (picks.length < 3) picks.push({ n: 0, r: 0.5, g: 0.55, b: 0.7 });

  const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const sat = c => { const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b); return mx === 0 ? 0 : (mx - mn) / mx; };
  const scale = (c, k) => ({ r: c.r * k, g: c.g * k, b: c.b * k });
  const toHex = c => (Math.round(Math.min(1, c.r) * 255) << 16) | (Math.round(Math.min(1, c.g) * 255) << 8) | Math.round(Math.min(1, c.b) * 255);
  const mostSat = arr => arr.reduce((best, c) => (sat(c) > sat(best) ? c : best), arr[0]);

  const byLum = [...picks].sort((a, b) => lum(a) - lum(b));
  const bgRaw = byLum[0];
  const rest = byLum.slice(1);
  const midLum = lum(rest[Math.floor(rest.length / 2)]);
  const bright = rest.filter(c => lum(c) >= midLum);
  const dark = rest.filter(c => lum(c) < midLum);
  const inner = mostSat(bright.length ? bright : rest);
  const outer = dark.length ? mostSat(dark) : scale(inner, 0.45);
  const unused = rest.filter(c => c !== inner && c !== outer);
  const core = unused.length
    ? unused.reduce((best, c) => (Math.abs(lum(c) - 0.5) < Math.abs(lum(best) - 0.5) ? c : best), unused[0])
    : { r: (inner.r + outer.r) / 2, g: (inner.g + outer.g) / 2, b: (inner.b + outer.b) / 2 };
  const bgMax = Math.max(bgRaw.r, bgRaw.g, bgRaw.b, 0.01);
  const bgDark = scale(bgRaw, Math.min(1, 0.04 / bgMax));

  return { name, core: toHex(core), rayInner: toHex(inner), rayOuter: toHex(outer), bg: toHex(bgDark), bgLight: toHex(bgRaw), fromImage: true };
}

// The ground for a light look. An image palette carries its own (the raw
// darkest colour); a built-in palette gets a tint of its core colour: same
// hue, saturation capped at 0.30, lightness 0.47. That reads dull as a hex
// because the frame still goes through the bloom pass's ACES tone mapping
// at exposure 1.3, which lifts Sapphire's #54689a to the (101, 127, 184)
// periwinkle of the Processing frame and Monochrome to a light grey (the
// constants were solved by inverting Three's ACES fit). Plain integer HSL,
// so it runs under the headless stub (whose Color has no HSL).
function lightBackground(palette) {
  if (palette.bgLight !== undefined) return palette.bgLight;
  const c = palette.core;
  const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0, s = 0;
  if (d > 1e-6) {
    h = (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6;
    s = Math.min(0.30, d / (1 - Math.abs(mx + mn - 1)));
  }
  const l = 0.47, q = l + s - l * s, p = 2 * l - q;
  const ch = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return (Math.round(ch(h + 1 / 3) * 255) << 16) | (Math.round(ch(h) * 255) << 8) | Math.round(ch(h - 1 / 3) * 255);
}
// ─── Audio Analysis ──────────────────────────────────────────────────────────

// Bands are real frequencies, loudness is time-domain RMS, and every band
// normalizes against its own slowly decaying running peak (an auto-leveler)
// so quiet and loud sources both use the full 0..1 range. Envelopes use
// musical time constants, and per-band onsets fire a `hit` that jumps to 1
// and decays. The hit is what the visuals punch on.
//
// These are the knobs to turn with a real track playing.
const AUDIO_TUNING = {
  fftSize:           2048,
  analyserSmoothing: 0.5,    // the analyser's own smoothing; keep low, we smooth ourselves
  bands: { bass: [30, 200], mid: [200, 2000], treble: [2000, 10000] }, // Hz
  particleHz:        [40, 8000], // particles listen log-spaced across this range
  attack:            0.02,   // s, envelope rise time constant
  release:           0.20,   // s, band envelope fall time constant
  loudRelease:       0.40,   // s, loudness fall time constant (the body, not the pumping)
  levelerTau:        30,     // s, running-peak memory: adapts to the source, not to a breakdown
  levelerFloor:      0.22,   // running peak never drops below this (raw 0..1)
  noiseFloor:        0.10,   // raw band level treated as silence
  rmsFloor:          0.02,   // running RMS peak never drops below this
  onsetTau:          0.8,    // s, running-average memory for onset detection
  onsetRatio:        { bass: 1.45, mid: 1.4, treble: 1.35 }, // level / average to count as a hit
  onsetMinLevel:     0.25,   // leveled band must be at least this to hit
  onsetRefractory:   0.12,   // s between hits in one band
  hitTau:            0.09,   // s, hit decay time constant (~6% left after 250 ms)
  hitFloor:          0.35,   // the softest onset still fires a hit this big
};

const BAND_NAMES = ['bass', 'mid', 'treble'];

class AudioAnalyzer {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.audioElement = null;
    this.active = false;

    this.sampleRate = 44100;
    this.binCount = AUDIO_TUNING.fftSize / 2;
    this.binHz = this.sampleRate / AUDIO_TUNING.fftSize;
    this.dataArray = new Uint8Array(this.binCount);           // FFT bytes, 0..255
    this.timeData = new Float32Array(AUDIO_TUNING.fftSize);   // waveform, -1..1
    this.smoothBins = new Float32Array(this.binCount);        // per-bin envelope, 0..1
    this.bandOfBin = new Uint8Array(this.binCount);           // index into BAND_NAMES
    this.bandBins = {};                                       // name -> [lo, hi)

    const perBand = (v) => ({ bass: v, mid: v, treble: v });
    this.raw = perBand(0);                        // band mean this frame
    this.peak = perBand(AUDIO_TUNING.levelerFloor); // decaying running peak
    this.level = perBand(0);                      // raw normalized by peak
    this.env = perBand(0);                        // level with attack/release
    this.avg = perBand(0);                        // slow average of level, for onsets
    this.prevLevel = perBand(0);
    this.hit = perBand(0);                        // the band's level on an onset, decays
    this.onset = perBand(false);                  // true only on the frame of an onset
    this.sinceHit = perBand(99);

    this.rms = 0;
    this.rmsPeak = AUDIO_TUNING.rmsFloor;
    this.loud = 0;

    this._layoutBands();
  }

  _layoutBands() {
    this.binHz = this.sampleRate / AUDIO_TUNING.fftSize;
    const toBin = (hz) => Math.max(1, Math.min(this.binCount - 1, Math.round(hz / this.binHz)));
    for (const name of BAND_NAMES) {
      const [lo, hi] = AUDIO_TUNING.bands[name];
      const a = toBin(lo);
      this.bandBins[name] = [a, Math.max(a + 1, toBin(hi))];
    }
    // Every bin belongs to a band so a single bin can be normalized by that
    // band's running peak (particles read bins, not bands).
    for (let i = 0; i < this.binCount; i++) {
      const hz = i * this.binHz;
      let b = 2;
      if (hz < AUDIO_TUNING.bands.bass[1]) b = 0;
      else if (hz < AUDIO_TUNING.bands.mid[1]) b = 1;
      this.bandOfBin[i] = b;
    }
  }

  async captureSystemAudio() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      stream.getVideoTracks().forEach(t => t.stop());
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No audio track. Check "Share audio".');
      }
      this.ctx = new AudioContext();
      this.source = this.ctx.createMediaStreamSource(new MediaStream(audioTracks));
      this._setupAnalyser();
      this.active = true;
      return true;
    } catch (err) {
      console.error('System audio capture failed:', err);
      return false;
    }
  }

  async loadFile(file) {
    try {
      this.ctx = new AudioContext();
      this.audioElement = new Audio();
      this.audioElement.src = URL.createObjectURL(file);
      this.audioElement.crossOrigin = 'anonymous';
      this.audioElement.loop = true;
      this.source = this.ctx.createMediaElementSource(this.audioElement);
      this.source.connect(this.ctx.destination);
      this._setupAnalyser();
      await this.audioElement.play();
      this.active = true;
      return true;
    } catch (err) {
      console.error('File load failed:', err);
      return false;
    }
  }

  _setupAnalyser() {
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = AUDIO_TUNING.fftSize;
    this.analyser.smoothingTimeConstant = AUDIO_TUNING.analyserSmoothing;
    this.source.connect(this.analyser);
    this.sampleRate = this.ctx.sampleRate;
    this._layoutBands();
  }

  update(dt) {
    if (!this.active || !this.analyser) return;
    this.analyser.getByteFrequencyData(this.dataArray);
    this.analyser.getFloatTimeDomainData(this.timeData);
    this._analyze(dt);
  }

  // Shared by the live and demo analyzers: works from dataArray + timeData.
  _analyze(dt) {
    const T = AUDIO_TUNING;
    const aUp = 1 - Math.exp(-dt / T.attack);
    const aDown = 1 - Math.exp(-dt / T.release);
    const aLoudDown = 1 - Math.exp(-dt / T.loudRelease);
    const peakDecay = Math.exp(-dt / T.levelerTau);
    const avgA = 1 - Math.exp(-dt / T.onsetTau);
    const hitDecay = Math.exp(-dt / T.hitTau);
    const data = this.dataArray;

    // Per-bin envelopes for the particles
    const bins = this.smoothBins;
    for (let i = 0; i < this.binCount; i++) {
      const r = data[i] / 255;
      bins[i] += (r - bins[i]) * (r > bins[i] ? aUp : aDown);
    }

    // Loudness: RMS of the waveform against its own running peak
    const td = this.timeData;
    let sum = 0;
    for (let i = 0; i < td.length; i++) sum += td[i] * td[i];
    const rms = Math.sqrt(sum / td.length);
    this.rms = rms;
    this.rmsPeak = Math.max(rms, this.rmsPeak * peakDecay, T.rmsFloor);
    const loudTarget = Math.min(1, rms / this.rmsPeak);
    this.loud += (loudTarget - this.loud) * (loudTarget > this.loud ? aUp : aLoudDown);

    for (const name of BAND_NAMES) {
      const [lo, hi] = this.bandBins[name];
      let s = 0;
      for (let i = lo; i < hi; i++) s += data[i];
      const raw = s / ((hi - lo) * 255);
      this.raw[name] = raw;

      // Auto-leveler: normalize by a running peak that forgets over levelerTau.
      const peak = Math.max(raw, this.peak[name] * peakDecay, T.levelerFloor);
      this.peak[name] = peak;
      let level = (raw - T.noiseFloor) / (peak - T.noiseFloor);
      level = level < 0 ? 0 : level > 1 ? 1 : level;
      this.level[name] = level;

      this.env[name] += (level - this.env[name]) * (level > this.env[name] ? aUp : aDown);

      // Onset: a rising edge well above the recent average, not too soon
      // after the last one.
      this.sinceHit[name] += dt;
      const avg = this.avg[name];
      const rising = level > this.prevLevel[name];
      this.onset[name] = false;
      if (rising && level > T.onsetMinLevel && level > avg * T.onsetRatio[name]
          && this.sinceHit[name] > T.onsetRefractory) {
        this.onset[name] = true;
        this.hit[name] = Math.max(T.hitFloor, level);
        this.sinceHit[name] = 0;
      } else {
        this.hit[name] *= hitDecay;
      }
      this.avg[name] = avg + (level - avg) * avgA;
      this.prevLevel[name] = level;
    }
  }

  // Level (0..1) of the bin nearest `hz`, relative to its band's running peak.
  getFreqAt(hz) {
    if (!this.active) return 0;
    const bin = Math.max(0, Math.min(this.binCount - 1, Math.round(hz / this.binHz)));
    const band = BAND_NAMES[this.bandOfBin[bin]];
    const T = AUDIO_TUNING;
    const v = (this.smoothBins[bin] - T.noiseFloor) / (this.peak[band] - T.noiseFloor);
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  getBass()   { return this.active ? this.env.bass : 0; }
  getMid()    { return this.active ? this.env.mid : 0; }
  getTreble() { return this.active ? this.env.treble : 0; }
  getVolume() { return this.active ? this.loud : 0; }
  getHit(band = 'bass') { return this.active ? this.hit[band] : 0; }
  getOnset(band = 'bass') { return this.active ? this.onset[band] : false; }
  isBeat()    { return this.getHit('bass') > 0.5; }
}

// ─── Demo Analyzer ───────────────────────────────────────────────────────────

// A fake 120 BPM track written straight into the FFT bytes and the waveform
// buffer, then run through the real analysis. Kick on every beat, snare on
// 2 and 4, hats on the off-beats, a pad that swells over 8 bars, and a
// breakdown every fourth phrase so quiet passages exist.
class DemoAnalyzer extends AudioAnalyzer {
  constructor() {
    super();
    this.active = true;
    this.t = 0;
  }

  update(dt) {
    this.t += dt;
    const t = this.t;
    const beatLen = 0.5;                         // 120 BPM
    const beat = Math.floor(t / beatLen);
    const beatPhase = t - beat * beatLen;        // seconds into the beat
    const beatInBar = beat % 4;
    const bar = Math.floor(beat / 4);
    const phrase = Math.floor(bar / 8);
    const breakdown = (phrase % 4) === 3;
    const swell = 0.5 - 0.5 * Math.cos((t / 16) * Math.PI * 2); // 0 at phrase start, 1 mid-phrase

    // Accents: 1 hard, 3 medium, 2 and 4 soft, with a little per-beat jitter.
    const accent = beatInBar === 0 ? 1.0 : beatInBar === 2 ? 0.8 : 0.55;
    const jx = Math.sin(beat * 12.9898) * 43758.5453;
    const jitter = 0.85 + 0.3 * (jx - Math.floor(jx));
    const kick = breakdown ? 0 : Math.exp(-beatPhase / 0.1) * accent * jitter;
    const snare = (!breakdown && (beatInBar === 1 || beatInBar === 3)) ? Math.exp(-beatPhase / 0.11) : 0;
    const offbeat = beatPhase >= beatLen / 2;
    const eighth = offbeat ? beatPhase - beatLen / 2 : beatPhase;
    const hat = offbeat ? Math.exp(-eighth / 0.035) * (breakdown ? 0.4 : 1) : 0;
    const bassline = breakdown ? 0.25 : 0.55 + 0.25 * Math.sin(t * 2.5);
    const pad = (breakdown ? 0.45 : 0.3) + 0.5 * swell;
    const lead = (!breakdown && Math.sin(t * 0.37) > 0.2) ? 0.4 + 0.4 * Math.abs(Math.sin(t * 5.1)) : 0;

    const data = this.dataArray;
    for (let i = 0; i < this.binCount; i++) {
      const hz = i * this.binHz;
      let v = 0.08;                                            // floor hiss
      if (hz < 150)        v += 0.35 * bassline + 0.55 * kick;
      else if (hz < 400)   v += 0.2 * bassline + 0.25 * kick + 0.3 * snare + 0.1 * pad;
      else if (hz < 2000)  v += 0.3 * pad + 0.35 * snare + 0.3 * lead;
      else if (hz < 6000)  v += 0.1 * pad + 0.25 * snare + 0.35 * hat + 0.15 * lead;
      else if (hz < 12000) v += 0.3 * hat + 0.1 * snare;
      else                 v += 0.05 * hat;
      v *= 1 - 0.00004 * hz;                                   // gentle spectral tilt
      v += (Math.random() - 0.5) * 0.03;
      data[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }

    const amp = 0.04 + 0.22 * (kick + 0.6 * snare + 0.35 * pad + 0.15 * hat + 0.25 * bassline);
    const td = this.timeData;
    for (let i = 0; i < td.length; i++) td[i] = amp * Math.sin(i * 0.11);

    this._analyze(dt);
  }
}

// ─── Physics constants ───────────────────────────────────────────────────────

// Gravitational constant for the inter-core n-body sim. Tuned for visual
// orbits in the 10–30s period range at our scene scale (radii 1–3, separations
// 3–8). Audio bass scales this up to ~1.4× for "system breathes" on hits.
const PHYSICS_G = 1.4;

// Bodies at or above this mass count as a sun or partner; below it they're
// satellites. Satellites are 0.4-0.8, partners 1.5+, suns 7+.
const HEAVY_MASS = 1.2;

// ─── Core (Planet with shader-based surface) ─────────────────────────────────

// Recent surface events per planet (flare spots, landings, bounces), drawn by
// the fragment shader as rings. Stored in object space so they rotate with
// the body.
const MAX_SURFACE_EVENTS = 32;
const SPOT_MIN_GAP = 0.1;   // s between landing spots on one planet: 32 slots / 0.1 s holds 3.2 s, so a 3 s spot is rarely overwritten mid-fade

const PLANET_VERTEX = /* glsl */ `
  uniform float uBass;
  uniform float uHit;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying vec3 vObjNormal;
  varying vec3 vWorldNormal;

  void main() {
    vec3 pos = position;
    vObjNormal = normal;

    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;
    // View space. Against the world-space vViewDir this makes the nebula
    // skin's NdotV drift with the camera, which moves its hot spot around the
    // body; that drift is the look, so it stays. vWorldNormal is the correct
    // one, used by the glass skin.
    vNormal = normalize(normalMatrix * normal);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const PLANET_FRAGMENT = /* glsl */ `
  #define MAX_EVENTS ${MAX_SURFACE_EVENTS}

  uniform float uTime;
  uniform float uBass;
  uniform float uMid;
  uniform float uTreble;
  uniform float uHit;
  uniform vec3 uColorCore;
  uniform vec3 uColorInner;
  uniform vec3 uColorOuter;
  uniform float uSkin;        // PLANET_SKINS index: 0 nebula, 1 glass, 2 rings, 3 silhouette, 4 paper, 5 hot
  uniform float uSpotLife;    // seconds a landing spot (kind 2) lingers on the glass and silhouette skins
  uniform float uRadius;      // body radius, so a spot keeps its world size on a small body
  uniform vec4 uEvents[MAX_EVENTS];      // xyz: object-space direction, w: start time
  uniform float uEventKinds[MAX_EVENTS]; // 0 flare spot, 1 ripple, 2 landing spot
  uniform vec3 uEventColors[MAX_EVENTS]; // kind 2: the colour of the comet that landed

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying vec3 vObjNormal;
  varying vec3 vWorldNormal;

  // Hash-based 3D value noise — cheap, good enough for atmospheric texture.
  float hash3(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash3(i);
    float n100 = hash3(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash3(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash3(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash3(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash3(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash3(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash3(i + vec3(1.0, 1.0, 1.0));
    float nx00 = mix(n000, n100, f.x);
    float nx10 = mix(n010, n110, f.x);
    float nx01 = mix(n001, n101, f.x);
    float nx11 = mix(n011, n111, f.x);
    return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
  }

  // Skin 1, dark glass (Comets): a near-black body with a Schlick fresnel
  // rim, a thin limb line and a key-light highlight, lit by what has landed
  // on it. A landing spot (kind 2) keeps its comet's colour: it arrives with
  // a white flash, then glows and fades over uSpotLife. Spots are sized in
  // world units (chord length times the radius), so a satellite shows the
  // same dot a sun does. The look that uses this skin registers landings
  // only, so the ring is all spots.
  vec3 glassSkin(vec3 N, vec3 V, float NdotV) {
    float fres  = 0.04 + 0.96 * pow(1.0 - NdotV, 5.0);
    float limb  = pow(1.0 - NdotV, 14.0);
    float inner = pow(NdotV, 2.5);
    vec3 L = vec3(-0.356, 0.814, 0.458);                 // fixed key light, pre-normalised
    vec3 H = normalize(L + V);
    float NdotH = max(dot(N, H), 0.0);
    float spec = pow(NdotH, 120.0) * 0.5 + pow(NdotH, 10.0) * 0.05;
    float pulse = 1.0 + uBass * 0.3 + uHit * 0.6;

    vec3 color = uColorOuter * 0.03;                                    // dark glass, a hint of the palette
    color += uColorInner * inner * 0.035 * pulse;                       // faint glow from inside
    color += mix(uColorInner, vec3(1.0), 0.35) * fres * 0.22 * pulse;   // fresnel rim
    color += vec3(1.0) * limb * 0.35 * pulse;                           // limb line
    color += vec3(1.0) * spec;                                          // highlight, drifts with the camera

    vec3 on = normalize(vObjNormal);
    float lifeSpan = max(uSpotLife, 0.01);
    for (int i = 0; i < MAX_EVENTS; i++) {
      vec4 e = uEvents[i];
      float age = uTime - e.w;
      if (age < 0.0 || age > lifeSpan) continue;
      if (uEventKinds[i] < 1.5) continue;                  // flares and ripples belong to the nebula skin
      float c = dot(on, e.xyz);
      if (c < 0.85) continue;                              // more than ~0.55 rad away
      float life = age / lifeSpan;
      float d = length(on - e.xyz) * uRadius;              // chord length, world units
      float hot   = exp(-d * d * 900.0);                   // white-hot point, ~0.03 units
      float haze  = exp(-d * d * 70.0);                    // coloured halo, ~0.12 units
      float bleed = exp(-d * d * 9.0);                     // faint light into the glass, ~0.33 units
      float fade  = (1.0 - life) * (1.0 - life) + exp(-age * 6.0) * 1.2;   // linger, plus an arrival flash
      float win   = smoothstep(0.85, 0.95, c);             // the bleed dies before the cutoff, no seam
      vec3 sc = uEventColors[i];
      color += (sc * (haze * 0.9 + bleed * 0.12) + vec3(1.0) * hot * 1.2) * fade * win;
    }
    return color;
  }

  // Skin 2, ring nucleus (Anemone): a near-black body whose centre, as the
  // camera sees it, is a set of concentric rings: a white-hot core, a bright
  // palette ring where its glow ends, a dark gap and two faint outer rings.
  // Measured as the projected radius of the disc (sine of the angle between
  // the world normal and the view) so the rings face the camera, stay
  // concentric on any body and never spin with the mesh. The rest of the
  // body is a silhouette against the hair and the nebula. Surface events
  // are not drawn: hair lands without a mark.
  float ringBand(float x, float centre, float sharp) {
    float d = (x - centre) * sharp;
    return exp(-d * d);
  }
  vec3 ringSkin(float NdotV) {
    float rp = sqrt(max(0.0, 1.0 - NdotV * NdotV));      // 0 at the disc centre, 1 at the limb
    float pulse = 1.0 + uBass * 0.4 + uHit * 0.8;
    float hot   = exp(-rp * rp * 600.0);                   // white-hot centre, ~4% of the radius
    float core  = exp(-rp * rp * 90.0);                    // palette glow around it, ~10%
    float ring1 = ringBand(rp, 0.15, 30.0);                // bright ring where the glow ends
    float ring2 = ringBand(rp, 0.30, 45.0) * 0.18;         // faint ring past the dark gap
    float ring3 = ringBand(rp, 0.42, 55.0) * 0.08;         // fainter still
    float limb  = pow(max(0.0, 1.0 - NdotV), 12.0) * 0.06; // the faintest edge, so the silhouette has a rim
    vec3 color = uColorOuter * 0.02;                                   // near-black body
    color += vec3(1.0) * hot * 3.0 * pulse;
    color += mix(uColorInner, vec3(1.0), 0.4) * core * 1.2 * pulse;
    color += uColorInner * ring1 * 1.5 * pulse;
    color += uColorInner * (ring2 + ring3) * pulse;
    color += uColorInner * limb;
    return color;
  }

  // Skin 3, silhouette (Starburst): a near-black disc against the rays and
  // the haze, with the faintest drifting mottle and a hairline limb so it
  // reads as a body and not a hole, lit only by what has landed on it. The
  // glass skin's spot machinery is reused as is (kind-2 events in the star's
  // colour, uSpotLife, uRadius, the ring paced by SPOT_MIN_GAP, landing
  // 'spot' in the look); the loop here has its own constants (a pinpoint in
  // a small saturated halo, little bleed) and the glass skin is left
  // untouched so Comets stays pixel-identical. Kinds 0 and 1 are not drawn.
  vec3 silhouetteSkin(float NdotV) {
    vec3 p = vWorldPos * 0.9;
    float t = uTime * 0.05;
    float mottle = vnoise(p + vec3(t, 0.0, -t)) * 0.7 + vnoise(p * 2.3 - vec3(0.0, t, 0.0)) * 0.3;
    float limb  = pow(1.0 - NdotV, 8.0);
    float pulse = 1.0 + uBass * 0.2 + uHit * 0.4;
    vec3 color = uColorOuter * (0.012 + 0.02 * mottle);                  // near-black with a hint of the palette
    color += mix(uColorInner, vec3(1.0), 0.5) * limb * 0.08 * pulse;     // hairline edge

    vec3 on = normalize(vObjNormal);
    float lifeSpan = max(uSpotLife, 0.01);
    for (int i = 0; i < MAX_EVENTS; i++) {
      vec4 e = uEvents[i];
      float age = uTime - e.w;
      if (age < 0.0 || age > lifeSpan) continue;
      if (uEventKinds[i] < 1.5) continue;                  // landings only
      float c = dot(on, e.xyz);
      if (c < 0.85) continue;                              // more than ~0.55 rad away
      float life  = age / lifeSpan;
      float d     = length(on - e.xyz) * uRadius;          // chord length, world units
      float hot   = exp(-d * d * 1200.0);                  // pinpoint, ~0.03 units
      float halo  = exp(-d * d * 110.0);                   // small coloured dot, ~0.1 units
      float bleed = exp(-d * d * 12.0);                    // a little light into the body, ~0.3 units
      float fade  = (1.0 - life) * (1.0 - life) + exp(-age * 5.0);   // linger, plus an arrival flash
      float win   = smoothstep(0.85, 0.95, c);             // dies before the cutoff, no seam
      color += (uEventColors[i] * (halo * 1.1 + bleed * 0.08) + vec3(1.0) * hot * 0.9) * fade * win;
    }
    return color;
  }

  // Skin 'hot' (Attractor): a dark body under a boiling crust of domain-warped
  // value noise in object space (so it turns with the mesh): dark plates and
  // glowing cracks in the palette's inner colour, the hottest filaments
  // lifted toward white and sparkling with the treble. A warm rim and a
  // hairline limb. The equatorial glow is measured on the WORLD normal so it
  // sits under the orbits pass's dot ring (world equatorial plane) however
  // the mesh has tilted, hottest where the band meets the limb like a ring
  // seen edge-on. The crust is kept under the bloom threshold so only the
  // filaments, the band and the limb bloom and the body stays a textured
  // sphere, not a white blob. Landings (kind 2) are brief white-hot
  // pinpoints in the particle's colour; kinds 0 and 1 are not drawn.
  vec3 hotSkin(float NdotV) {
    vec3 on = normalize(vObjNormal);
    vec3 Nw = normalize(vWorldNormal);
    float t = uTime * 0.06;
    vec3 p = on * 3.0;
    vec2 warp = vec2(vnoise(p + vec3(t, 0.0, 0.0)), vnoise(p + vec3(0.0, t, 7.1))) - 0.5;
    p += vec3(warp.x, warp.y, warp.x - warp.y) * 1.1;
    float n = vnoise(p) * 0.55 + vnoise(p * 2.1 + vec3(0.0, t * 1.7, 0.0)) * 0.3 + vnoise(p * 4.7 - vec3(t, 0.0, 0.0)) * 0.15;
    float crust = smoothstep(0.38, 0.72, n);               // dark plates (0) to glowing cracks (1)
    float fil   = smoothstep(0.66, 0.84, n);               // the hottest filaments
    float pulse = 1.0 + uBass * 0.4 + uHit * 0.7;
    float rim   = pow(1.0 - NdotV, 2.5);                   // warm edge
    float limb  = pow(1.0 - NdotV, 10.0);                  // hairline at the silhouette
    float eq    = exp(-Nw.y * Nw.y * 45.0);                // band about the world equator, ~9 degrees wide
    float belt  = exp(-Nw.y * Nw.y * 5.0);                 // broad warmth around it
    vec3 ember = uColorOuter, fire = uColorInner, white = mix(fire, vec3(1.0), 0.6);
    vec3 color = ember * (0.06 + 0.10 * NdotV);                                  // dark body, barely lit toward the camera
    color += mix(ember, fire, crust) * (0.08 + 0.42 * crust) * pulse;            // crust
    color += white * fil * (0.45 + 0.35 * uTreble) * pulse;                      // filaments
    color += mix(fire, white, 0.3) * rim * 0.45 * pulse;                         // rim
    color += vec3(1.0) * limb * 0.25;                                            // limb
    color += fire * belt * 0.15 * pulse;                                         // warmth about the equator
    color += mix(fire, vec3(1.0), 0.5) * eq * (0.45 + 0.8 * rim) * pulse;        // the equatorial glow, hottest at the limb
    float lifeSpan = max(uSpotLife, 0.01);
    for (int i = 0; i < MAX_EVENTS; i++) {
      vec4 e = uEvents[i];
      float age = uTime - e.w;
      if (age < 0.0 || age > lifeSpan) continue;
      if (uEventKinds[i] < 1.5) continue;                  // landings only
      float c = dot(on, e.xyz);
      if (c < 0.85) continue;                              // more than ~0.55 rad away
      float life = age / lifeSpan;
      float d    = length(on - e.xyz) * uRadius;           // chord length, world units
      float hot  = exp(-d * d * 900.0);                    // pinpoint, ~0.03 units
      float halo = exp(-d * d * 90.0);                     // small halo, ~0.1 units
      float fade = (1.0 - life) * (1.0 - life) + exp(-age * 6.0);
      float win  = smoothstep(0.85, 0.95, c);              // dies before the cutoff, no seam
      color += (uEventColors[i] * halo * 0.8 + vec3(1.0) * hot) * fade * win;
    }
    return color;
  }

  // Skin 4, paper (Paper): an unlit flat disc, a mid tone between the
  // palette's outer and core colours, with a drawn outline along the limb
  // (the outer ~8% of the projected radius, measured on the world normal so
  // it faces the camera) in the core colour lifted toward white, and a
  // small swell on a hit. No surface events are drawn.
  vec3 paperSkin(float NdotV) {
    float rp = sqrt(max(0.0, 1.0 - NdotV * NdotV));     // 0 at the disc centre, 1 at the limb
    float edge = smoothstep(0.90, 0.94, rp);
    float pulse = 1.0 + uBass * 0.08 + uHit * 0.15;
    vec3 fill = mix(uColorOuter, uColorCore, 0.2) * pulse;
    vec3 line = mix(uColorCore, vec3(1.0), 0.35);
    return mix(fill, line, edge);
  }
  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vViewDir);
    float NdotV = max(dot(N, V), 0.0);
    if (abs(uSkin - ${PLANET_SKINS.hot}.0) < 0.5) {
      vec3 Nw = normalize(vWorldNormal);
      gl_FragColor = vec4(hotSkin(max(dot(Nw, V), 0.0)), 1.0);
      return;
    }
    if (uSkin > 3.5) {
      vec3 Nw = normalize(vWorldNormal);
      gl_FragColor = vec4(paperSkin(max(dot(Nw, V), 0.0)), 1.0);
      return;
    }
    if (uSkin > 2.5) {
      vec3 Nw = normalize(vWorldNormal);
      gl_FragColor = vec4(silhouetteSkin(max(dot(Nw, V), 0.0)), 1.0);
      return;
    }
    if (uSkin > 1.5) {
      vec3 Nw = normalize(vWorldNormal);
      gl_FragColor = vec4(ringSkin(max(dot(Nw, V), 0.0)), 1.0);
      return;
    }
    if (uSkin > 0.5) {
      vec3 Nw = normalize(vWorldNormal);
      gl_FragColor = vec4(glassSkin(Nw, V, max(dot(Nw, V), 0.0)), 1.0);
      return;
    }

    // Hodgin-style nebula: a hot concentrated nucleus stands in stark contrast
    // to a darker body, with a soft halo just inside the silhouette.
    float nucleus  = pow(NdotV, 14.0);    // very tight white-hot center point
    float halo     = pow(NdotV, 4.0);     // medium inner glow around nucleus
    float corona   = pow(NdotV, 1.6);     // wider body falloff
    float rim      = pow(1.0 - NdotV, 3.0); // narrow atmospheric edge

    // Animated atmospheric texture — drifting cloud-like patterns.
    vec3 p = vWorldPos * 0.55;
    float t = uTime * 0.15;
    float n = vnoise(p + vec3(t, 0.0, 0.0)) * 0.6
            + vnoise(p * 2.1 - vec3(0.0, t * 1.3, 0.0)) * 0.3
            + vnoise(p * 4.3 + vec3(0.0, 0.0, t * 0.7)) * 0.1;
    float surface = smoothstep(0.25, 0.85, n);

    // Audio-reactive pulse: the bass envelope carries the glow, a bass hit flashes it.
    float pulse = 1.0 + uBass * 0.6 + uMid * 0.15 + uHit * 0.9;
    float sparkle = uTreble * 0.5;

    // Color stack: white-hot nucleus → palette inner glow → darker body → halo edge.
    vec3 nucleusCol = mix(uColorInner, vec3(1.0), 0.8);
    vec3 haloCol    = uColorInner;
    vec3 bodyCol    = mix(uColorOuter * 0.4, uColorCore * 0.7, surface);
    vec3 rimCol     = uColorOuter;

    // Body is intentionally dark so the nucleus and rim do the heavy visual lifting.
    vec3 color = bodyCol * (0.04 + corona * 0.18);
    color += haloCol * halo * pulse * 0.6;
    color += nucleusCol * nucleus * pulse * 3.5;
    color += rimCol * rim * pulse * 0.9;
    color += uColorInner * sparkle * surface * 0.4;

    // Surface events: flare spots bloom out fast and bright, ripples expand
    // like raindrops over about a second. Measured as angle on the sphere.
    vec3 on = normalize(vObjNormal);
    float flare = 0.0;
    float ripple = 0.0;
    for (int i = 0; i < MAX_EVENTS; i++) {
      vec4 e = uEvents[i];
      float age = uTime - e.w;
      if (age < 0.0 || age > 1.2) continue;
      float c = dot(on, e.xyz);
      if (c < 0.85) continue;                  // more than ~0.55 rad away
      float ang = acos(clamp(c, -1.0, 1.0));
      if (uEventKinds[i] < 0.5) {
        float life = clamp(age / 0.35, 0.0, 1.0);
        float r = 0.04 + life * 0.22;
        float band = 1.0 - smoothstep(0.0, 0.05, abs(ang - r));
        float fill = (1.0 - smoothstep(0.0, r, ang)) * 0.5;
        flare += (band + fill) * (1.0 - life) * (1.0 - life);
      } else {
        float life = clamp(age / 1.0, 0.0, 1.0);
        float r = 0.02 + life * 0.3;
        float band = 1.0 - smoothstep(0.0, 0.035, abs(ang - r));
        ripple += band * (1.0 - life) * (1.0 - life);
      }
    }
    color += uColorInner * flare * 2.5 * pulse;
    color += mix(uColorInner, vec3(1.0), 0.4) * ripple * 1.2;

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ─── Ray fan (Starburst extras: 'rays') ──────────────────────────────────────

// Straight radial streaks from a body: one shared unit fan of RAY_COUNT
// directions, each ray two vertices (root on the surface, tip at aT = 1)
// with its own length share and seed, built once from a fixed-seed hash so
// it never touches Math.random (the planet and particle RNG sequences stay
// as they were). Every core owns a LineSegments on this geometry, placed at
// the body, scaled by radius x lifecycle (so it grows in and collapses with
// the body) and spun slowly about its own tilted axis. The vertex shader
// stretches each ray to the look's length, breathing with the bass and
// jumping on a hit; the fragment fades it to nothing by the tip. Nothing is
// uploaded per frame: a transform and a few uniforms per body. Hidden under
// every look whose extras do not name 'rays'.
const RAY_COUNT = 192;
let RAY_GEOMETRY = null;
function rayGeometry() {
  if (RAY_GEOMETRY) return RAY_GEOMETRY;
  let s = 0x9e3779b9;   // mulberry32 with a fixed seed: the fan is the same every session
  const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const n = RAY_COUNT;
  const pos = new Float32Array(n * 6), t = new Float32Array(n * 2), len = new Float32Array(n * 2), seed = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) {
    const theta = rnd() * Math.PI * 2, z = 2 * rnd() - 1, sx = Math.sqrt(1 - z * z);   // uniform on the sphere
    const l = 0.3 + 0.7 * Math.pow(rnd(), 1.5);   // most rays short, a few long
    const sd = rnd();
    for (let e = 0; e < 2; e++) {
      const v = k * 2 + e, v3 = v * 3;
      pos[v3] = sx * Math.cos(theta); pos[v3 + 1] = sx * Math.sin(theta); pos[v3 + 2] = z;
      t[v] = e; len[v] = l; seed[v] = sd;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));   // the ray's unit direction; the shader places it
  g.setAttribute('aT', new THREE.BufferAttribute(t, 1));
  g.setAttribute('aLen', new THREE.BufferAttribute(len, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  RAY_GEOMETRY = g;
  return g;
}

const RAY_VERTEX = /* glsl */ `
  attribute float aT;      // 0 root, 1 tip
  attribute float aLen;    // this ray's share of uLength
  attribute float aSeed;
  uniform float uTime;
  uniform float uBass;
  uniform float uHit;
  uniform float uLength;   // world units at full length for a body of radius 1
  uniform float uRadius;   // body radius: the object is scaled by it, so lengths divide it out
  varying float vT;
  varying float vSeed;
  void main() {
    // position is the unit direction; the object carries the body's
    // position, scale (radius x lifecycle) and spin. Rays breathe with the
    // bass, jump on a hit and shimmer a little on their own seed. Length
    // grows with the body but slower than its radius, so a satellite keeps
    // a fan and a sun's does not swallow the frame.
    float breath = 1.0 + uBass * 0.35 + uHit * 0.5;
    float wobble = 0.9 + 0.1 * sin(uTime * (1.0 + aSeed * 2.0) + aSeed * 40.0);
    float len = uLength * aLen * breath * wobble * (0.5 + 0.5 * uRadius) / uRadius;
    vec3 p = position * (1.03 + aT * len);
    vT = aT;
    vSeed = aSeed;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const RAY_FRAGMENT = /* glsl */ `
  uniform vec3 uColorInner;
  uniform vec3 uColorOuter;
  uniform float uOpacity;
  uniform float uVolume;
  varying float vT;
  varying float vSeed;
  void main() {
    float fall = (1.0 - vT) * (1.0 - vT);                      // bright at the root, gone by the tip
    float a = fall * uOpacity * (0.5 + 0.5 * uVolume) * (0.6 + 0.4 * vSeed);
    vec3 col = mix(mix(uColorInner, vec3(1.0), 0.35), uColorOuter, vT);
    gl_FragColor = vec4(col * a, 1.0);                         // additive, like the trails
  }
`;

// ─── Orbits (Attractor extras: 'orbits') ─────────────────────────────────────

// A ring of dots on a body's world equator (the plane the hot skin's
// equatorial glow sits in) and a thin orbit circle outside it, leaning by
// the body's index and precessing slowly. Two shared unit geometries in the
// XZ plane, built once from a fixed-seed PRNG (Math.random untouched, so
// the planet and particle RNG sequences stay as they were): a Points for
// the dots, laid down at the golden angle so any prefix of the buffer is an
// even ring and orbits.dots is a draw range, and a LineSegments for the
// circle. Every core owns one of each, placed at the body and scaled by
// radius x lifecycle x the look's radius factor, like the ray fan, so
// spawn, collapse and destroy come free. The dots turn about world y on the
// sim time (F stops them), twinkle on their own seed and breathe with the
// bass; one bright arc travels round the circle. Nothing is uploaded per
// frame. Hidden under every look whose extras do not name 'orbits'.
const ORBIT_DOTS = 160;         // dots the shared ring holds; orbits.dots is a draw range into it
const ORBIT_SEGMENTS = 128;
let ORBIT_DOT_GEOMETRY = null, ORBIT_CIRCLE_GEOMETRY = null;
function orbitDotGeometry() {
  if (ORBIT_DOT_GEOMETRY) return ORBIT_DOT_GEOMETRY;
  let s = 0x2545f491;   // mulberry32 with its own fixed seed
  const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const n = ORBIT_DOTS, pos = new Float32Array(n * 3), seed = new Float32Array(n), size = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const a = k * 2.399963 + (rnd() - 0.5) * 0.06;       // golden angle: any prefix is an even ring
    const r = 1 + (rnd() - 0.5) * 0.06;                  // a thin band, not a hairline
    pos[k * 3] = Math.cos(a) * r; pos[k * 3 + 1] = (rnd() - 0.5) * 0.03; pos[k * 3 + 2] = Math.sin(a) * r;
    seed[k] = rnd();
    size[k] = 0.6 + Math.pow(rnd(), 2.0) * 1.2;          // most small, a few bright
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  ORBIT_DOT_GEOMETRY = g;
  return g;
}
function orbitCircleGeometry() {
  if (ORBIT_CIRCLE_GEOMETRY) return ORBIT_CIRCLE_GEOMETRY;
  const n = ORBIT_SEGMENTS, pos = new Float32Array(n * 6), ang = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) {
    const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2, k6 = k * 6;
    pos[k6] = Math.cos(a0); pos[k6 + 2] = Math.sin(a0); pos[k6 + 3] = Math.cos(a1); pos[k6 + 5] = Math.sin(a1);
    ang[k * 2] = a0; ang[k * 2 + 1] = a1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aAngle', new THREE.BufferAttribute(ang, 1));
  ORBIT_CIRCLE_GEOMETRY = g;
  return g;
}

const ORBIT_DOT_VERTEX = `
  attribute float aSeed;
  attribute float aSize;
  uniform float uTime;
  uniform float uBass;
  uniform float uHit;
  uniform float uDotSize;
  uniform float uRadius;   // body radius: the object is scaled by it, so a sun's dots are heavier than a satellite's, but not by the ratio
  varying float vGlow;
  void main() {
    // The object carries the body's position, the ring radius and the spin;
    // a dot keeps its pixel size. Each twinkles on its own seed and the
    // whole ring breathes with the bass and jumps on a hit.
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    float twinkle = 0.75 + 0.25 * sin(uTime * (2.0 + aSeed * 3.0) + aSeed * 50.0);
    vGlow = twinkle * (1.0 + uBass * 0.4 + uHit * 0.8);
    gl_PointSize = uDotSize * aSize * (0.6 + 0.4 * uRadius) * (120.0 / -mvPos.z);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const ORBIT_DOT_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uVolume;
  varying float vGlow;
  void main() {
    vec2 p = (gl_PointCoord - 0.5) * 2.0;
    float r2 = dot(p, p);
    float hot  = exp(-r2 * 30.0);                               // the dot
    float halo = exp(-r2 * 4.0);                                // its glow, gone by the edge
    float a = (hot + halo * 0.3) * vGlow * uOpacity * (0.6 + 0.4 * uVolume);
    if (a < 0.004) discard;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.55 * hot) * a, 1.0);   // additive, like the rays: the colour carries the alpha
  }
`;

const ORBIT_CIRCLE_VERTEX = `
  attribute float aAngle;
  uniform float uTime;
  uniform float uArc;
  varying float vBright;
  void main() {
    // One bright arc travels round the circle; the rest is a hairline.
    float arc = pow(0.5 + 0.5 * cos(aAngle - uTime * uArc), 8.0);
    vBright = 0.3 + 0.7 * arc;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ORBIT_CIRCLE_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uCircleOpacity;
  uniform float uVolume;
  varying float vBright;
  void main() {
    gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.4) * vBright * uCircleOpacity * (0.6 + 0.4 * uVolume), 1.0);   // additive
  }
`;

// ─── Ribbons (trails.style 'ribbon') ─────────────────────────────────────────

// A trail drawn as a flat strip. The ribbon ring (RIBBON_POINTS slots per
// particle, slot-major like the line ring, two vertices per point: vertex =
// (slot * maxCount + i) * 2 + edge) keeps, per point, the position, a unit
// side vector with the point's half-width share in w, the face normal, the
// colour with its brightness, and the birth. All of it is written once at
// the trail cadence into both edge vertices; a static aSign (-1 / +1) tells
// the vertex shader which edge to push out, so the strip is expanded, shaped
// and lit on the GPU and nothing per point is rebuilt in JS. The frame
// (side, normal) is parallel-transported from write to write and rolled
// about the tangent by ribbons.twist x the turn since the last write plus a
// slow roll of the particle's own, so a strip stays flat through a gentle
// curve, twists as its particle turns and catches the key light as it does.
// The width share is speed (fast = wide) times the particle's size.
//
// The index is static, rebuilt only when the count changes: block s holds
// the quad from slot s-1 to slot s for every particle, blocks 0..P-1 and
// then the same again, so the window of the last W blocks ending at the
// current slot is one contiguous draw range that slides with the ring. Three
// rules keep that correct with nothing walked per frame: a point older than
// the strand, never written or blanked (birth RIBBON_NONE) folds to zero
// width in the shader; the first point of a life carries a width share of 0,
// so a strand never joins the one its particle index left behind; and a
// landed particle's newest point is blanked on sleep, so no quad runs from a
// landed strand to the next life's launch point. A landed strand then stays
// and fades by age, with no slot held. Per frame: this frame's slot block
// (count x 2 vertices) and the caps are uploaded, the draw range moves.
const RIBBON_VERTEX = `
  attribute vec4 aSide;      // xyz unit side (int8), w half-width share 0..1 (0 on the first point of a life: it folds)
  attribute vec4 aNormal;    // xyz unit face normal (int8)
  attribute vec4 aColor;     // rgb the point's colour, a its brightness (uint8)
  attribute float birth;     // RIBBON_NONE on a slot that holds no point of a live strand
  attribute float aSign;     // -1 one edge, +1 the other
  uniform float uNow;
  uniform float uSeconds;
  uniform float uOpacity;
  uniform float uWidth;      // full width in world units at share 1
  uniform float uTint;       // 0 grey, 1 the stored colour
  uniform float uFlat;       // 0 lit, 1 flat
  uniform float uTaper;      // 0 tip: wide at the head, thinning to the root; 1 bulge: thin at both ends, widest mid-strand
  uniform vec3 uLight;       // key light direction, unit (the glass skin's)
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float age = uNow - birth;
    float alive = step(0.0, age) * step(age, uSeconds);                     // older than the strand, never written or blanked: folds
    float fade = clamp(1.0 - age / uSeconds, 0.0, 1.0);                     // 1 at the head, 0 at the root
    float shape = mix(sqrt(fade), 0.15 + 3.4 * fade * (1.0 - fade), uTaper);
    float tip = min(1.0, (1.0 - fade) * 20.0);                              // the newest 5% narrows into the head dot
    float hw = uWidth * 0.5 * aSide.w * shape * tip * alive;
    vec3 p = position + aSide.xyz * (hw * aSign);
    vec3 N = aNormal.xyz;
    float nn = dot(N, N);
    N = nn > 1.0e-6 ? N / sqrt(nn) : vec3(0.0, 1.0, 0.0);
    vec3 V = normalize(cameraPosition - p);
    vec3 H = normalize(uLight + V);
    float dl = abs(dot(N, uLight));
    float dh = abs(dot(N, H));
    float dv = abs(dot(N, V));
    float lit = 0.3 + 0.7 * dl + pow(dh, 32.0) * 1.4 + (1.0 - dv) * 0.15;   // two-sided diffuse, a sheen as it turns through the light, a little edge lift
    vec3 rgb = mix(vec3(dot(aColor.rgb, vec3(0.299, 0.587, 0.114))), aColor.rgb, uTint);
    if (uFlat > 0.5) {
      vColor = rgb;                                                         // flat: the colour as stored, the width does the ends
      vAlpha = uOpacity * alive;
    } else {
      vColor = rgb * aColor.a * lit * fade * uOpacity;                      // additive: the colour carries the intensity
      vAlpha = 1.0;
    }
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const RIBBON_FRAGMENT = `
  varying vec3 vColor;
  varying float vAlpha;
  void main() { gl_FragColor = vec4(vColor, vAlpha); }
`;

// ─── Shards (extras 'shards') ────────────────────────────────────────────────

// Angular slivers thrown off every source on a bass hit: a pool of SHARD_MAX
// shards, each two thin triangles sharing a root (a kinked fragment: a spike
// with a barb off each side), six vertices carrying the origin, the unit
// flight direction, a unit side at right angles, a corner in the shard's own
// frame (static), a birth and a seed. The vertex shader flies it (thrown
// hard, slowing), tumbles the side about the flight line, sizes the corner,
// lights it by how much the face turns to the camera and fades it over its
// life; a dead shard collapses off screen. A hit writes its shards once and
// uploads the pool; nothing moves per frame but the clock.
const SHARD_CORNERS = [0, 0, 0.45, 1, 1, 0,   0, 0, 1, 0, 0.3, -0.7];   // (along 0..1, across -1..1): root, barb, tip; root, tip, barb
const SHARD_VERTEX = `
  attribute vec3 aDir;
  attribute vec3 aSide;
  attribute vec2 aCorner;
  attribute float aBirth;
  attribute float aSeed;
  uniform float uNow;
  uniform float uLife;
  uniform float uSpeed;
  uniform float uLength;
  uniform float uWidth;
  uniform float uOpacity;
  uniform float uFlat;
  uniform vec3 uColorA;      // lit: the tip colour (the root is white-hot)
  uniform vec3 uColorB;      // flat: the one colour
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float age = uNow - aBirth;
    float t = age / uLife;
    if (age < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec3(0.0); vAlpha = 0.0; return; }
    float travel = uSpeed * uLife * (1.0 - (1.0 - t) * (1.0 - t)) * (0.6 + 0.8 * aSeed);   // thrown hard, slowing
    float ang = age * (3.0 + aSeed * 6.0);                                                // tumble about the flight line
    vec3 up = cross(aDir, aSide);
    vec3 side = aSide * cos(ang) + up * sin(ang);
    float len = uLength * (0.5 + aSeed);
    vec3 p = position + aDir * (travel + aCorner.x * len) + side * (aCorner.y * uWidth * (0.5 + 0.5 * aSeed));
    vec3 N = cross(aDir, side);                                   // unit: aDir and aSide are unit and at right angles
    vec3 V = normalize(cameraPosition - p);
    float face = abs(dot(N, V));
    float fall = (1.0 - t) * (1.0 - t);
    vec3 col = mix(vec3(1.0), uColorA, aCorner.x * 0.8);
    if (uFlat > 0.5) { vColor = uColorB; vAlpha = uOpacity * fall; }
    else { vColor = col * (0.4 + 0.8 * face) * fall * uOpacity; vAlpha = 1.0; }
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const SHARD_FRAGMENT = RIBBON_FRAGMENT;
class Core {
  // params: { role, mass, charge, radius, position: Vector3, velocity: Vector3 }
  constructor(scene, index, params) {
    this.index = index;
    this.scene = scene;
    this.alive = true;

    this.role = params.role;
    this.mass = params.mass;
    this.charge = params.charge;
    this.radius = params.radius;
    this.position = params.position.clone();
    this.velocity = params.velocity.clone();
    this.acceleration = new THREE.Vector3();

    // Lifecycle state
    this.phase = 'spawning'; // 'spawning' | 'alive' | 'collapsing' | 'dead'
    this.phaseTime = 0;
    this.spawnDuration = 2.0 + Math.random() * 1.5;
    this.lifeDuration = 35 + Math.random() * 50;
    this.collapseDuration = 2.5 + Math.random() * 1.5;
    this.scaleT = 0;
    this.collapseFrom = 1;   // scale at the start of the collapse

    // Ring buffer of surface events for the shader; start times far in the
    // past so empty slots never draw.
    this.surfaceEvents = new Float32Array(MAX_SURFACE_EVENTS * 4);
    this.surfaceKinds = new Float32Array(MAX_SURFACE_EVENTS);
    for (let k = 0; k < MAX_SURFACE_EVENTS; k++) this.surfaceEvents[k * 4 + 3] = -1000;
    this.surfaceHead = 0;
    this.lastRipple = -1000;
    this.surfaceColors = new Float32Array(MAX_SURFACE_EVENTS * 3).fill(1);
    this.lastSpot = -1000;
    this._tmpVec = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();

    const geo = new THREE.IcosahedronGeometry(this.radius, 4);
    this.geometry = geo;

    this.uniforms = {
      uTime:       { value: 0 },
      uBass:       { value: 0 },
      uMid:        { value: 0 },
      uTreble:     { value: 0 },
      uHit:        { value: 0 },
      uColorCore:  { value: new THREE.Color(0x888899) },
      uColorInner: { value: new THREE.Color(0x6699ff) },
      uColorOuter: { value: new THREE.Color(0x2244aa) },
      uSkin:       { value: 0 },
      uEvents:     { value: this.surfaceEvents },
      uEventKinds: { value: this.surfaceKinds },
      uEventColors: { value: this.surfaceColors },
      uSpotLife:    { value: LOOK_DEFAULTS.planet.spotLife },
      uRadius:      { value: this.radius },
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERTEX,
      fragmentShader: PLANET_FRAGMENT,
      uniforms: this.uniforms,
      wireframe: false,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.castShadow = true;
    this.mesh.scale.setScalar(0.001); // start invisible
    this.mesh.position.copy(this.position);
    scene.add(this.mesh);

    // Ray fan (extras 'rays'): hidden until a look asks for it. The tilt of
    // its spin axis comes from the body's index, not from the RNG.
    this.rayUniforms = {
      uTime:       { value: 0 },
      uBass:       { value: 0 },
      uHit:        { value: 0 },
      uVolume:     { value: 0 },
      uColorInner: { value: new THREE.Color(0x6699ff) },
      uColorOuter: { value: new THREE.Color(0x2244aa) },
      uLength:     { value: LOOK_DEFAULTS.rays.length },
      uOpacity:    { value: LOOK_DEFAULTS.rays.opacity },
      uRadius:     { value: this.radius },
    };
    this.rayMaterial = new THREE.ShaderMaterial({
      vertexShader: RAY_VERTEX,
      fragmentShader: RAY_FRAGMENT,
      uniforms: this.rayUniforms,
      transparent: true,
      depthWrite: false,          // depthTest stays on: a silhouette in front hides the rays behind it
      blending: THREE.AdditiveBlending,
    });
    this.rays = new THREE.LineSegments(rayGeometry(), this.rayMaterial);
    this.rays.visible = false;
    this.rays.frustumCulled = false;                       // the unit fan's sphere is the body; the rays reach far past it
    this.rays.rotation.x = (((index * 0.618034) % 1) - 0.5) * 0.8;   // each fan spins about its own tilted axis
    this._raySpin = 0;
    scene.add(this.rays);

    // Orbits (extras 'orbits'): a ring of dots on the world equator and a
    // thin circle outside it, hidden until a look asks for them. Both
    // materials share one uniforms object; the circle's lean comes from the
    // body's index, not from the RNG.
    this.orbitUniforms = {
      uTime:          { value: 0 },
      uBass:          { value: 0 },
      uHit:           { value: 0 },
      uVolume:        { value: 0 },
      uColor:         { value: new THREE.Color(0x6699ff) },
      uOpacity:       { value: LOOK_DEFAULTS.orbits.opacity },
      uCircleOpacity: { value: LOOK_DEFAULTS.orbits.circleOpacity },
      uDotSize:       { value: LOOK_DEFAULTS.orbits.dotSize },
      uArc:           { value: LOOK_DEFAULTS.orbits.spin * 2 },
      uRadius:        { value: this.radius },
    };
    this.orbitDotMaterial = new THREE.ShaderMaterial({
      vertexShader: ORBIT_DOT_VERTEX, fragmentShader: ORBIT_DOT_FRAGMENT, uniforms: this.orbitUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.orbitCircleMaterial = new THREE.ShaderMaterial({
      vertexShader: ORBIT_CIRCLE_VERTEX, fragmentShader: ORBIT_CIRCLE_FRAGMENT, uniforms: this.orbitUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.orbitRing = new THREE.Points(orbitDotGeometry(), this.orbitDotMaterial);
    this.orbitCircle = new THREE.LineSegments(orbitCircleGeometry(), this.orbitCircleMaterial);
    this.orbitCircle.rotation.order = 'YXZ';               // lean about x, then precess about world y
    this._orbitTilt = (((index * 0.618034 + 0.3) % 1) - 0.5) * 2;   // -1..1 from the index; orbits.tilt scales it
    for (const o of [this.orbitRing, this.orbitCircle]) { o.visible = false; o.frustumCulled = false; scene.add(o); }
    this._orbits = LOOK_DEFAULTS.orbits;
    this._orbitSpin = 0;
    this._orbitPrecess = 0;
  }

  // Gravitational mass used by the n-body sim. Fades linearly to zero across
  // the full collapse phase so the system's center of mass shifts smoothly
  // instead of jumping when a body finally dies.
  get effectiveMass() {
    if (this.phase === 'collapsing') {
      const t = Math.min(1, this.phaseTime / this.collapseDuration);
      return this.mass * (1 - t);
    }
    return this.mass;
  }

  // 0 -> 1 across the collapse phase, 0 otherwise. Particles read it for the
  // inward pull and to stop landing on a body that's about to go.
  get collapseT() {
    if (this.phase !== 'collapsing') return 0;
    return Math.min(1, this.phaseTime / this.collapseDuration);
  }

  // Charge as the particle field sees it. Ramps in with the spawn scale so a
  // new body's streams fade in, and out across the collapse so its lines hand
  // off to the survivors instead of vanishing on the death frame.
  get effectiveCharge() {
    return this.charge * this.scaleT;
  }

  // Register a surface event at world point (x, y, z): 0 = flare spot,
  // 1 = ripple (a landing or a bounce), 2 = landing spot (the glass skin
  // keeps it lit for spotLife in the colour r, g, b of the comet that
  // landed). Ripples are throttled so a busy sink shows a patter instead of
  // a smear; spots are paced to the ring so one is rarely overwritten
  // mid-fade.
  addSurfaceEvent(x, y, z, kind, time, r = 1, g = 1, b = 1) {
    if (kind === 1) {
      if (time - this.lastRipple < 0.03) return;
      this.lastRipple = time;
    } else if (kind === 2) {
      if (time - this.lastSpot < SPOT_MIN_GAP) return;
      this.lastSpot = time;
    }
    const v = this._tmpVec.set(x - this.position.x, y - this.position.y, z - this.position.z);
    v.applyQuaternion(this._tmpQuat.copy(this.mesh.quaternion).invert()).normalize();
    const k = this.surfaceHead * 4, k3 = this.surfaceHead * 3;
    this.surfaceEvents[k]     = v.x;
    this.surfaceEvents[k + 1] = v.y;
    this.surfaceEvents[k + 2] = v.z;
    this.surfaceEvents[k + 3] = time;
    this.surfaceKinds[this.surfaceHead] = kind;
    this.surfaceColors[k3] = r; this.surfaceColors[k3 + 1] = g; this.surfaceColors[k3 + 2] = b;
    this.surfaceHead = (this.surfaceHead + 1) % MAX_SURFACE_EVENTS;
  }

  // Pure lifecycle + visual sync. Physics is driven externally by the Visualizer.
  update(time, dt, audio) {
    this.phaseTime += dt;

    if (this.phase === 'spawning') {
      const raw = Math.min(1, this.phaseTime / this.spawnDuration);
      // Elastic ease-out
      this.scaleT = raw < 1 ? 1 - Math.pow(1 - raw, 3) * Math.cos(raw * Math.PI * 0.5) : 1;
      if (this.phaseTime >= this.spawnDuration) {
        this.phase = 'alive';
        this.phaseTime = 0;
        this.scaleT = 1;
      }
    } else if (this.phase === 'alive') {
      this.scaleT = 1;
      if (this.phaseTime >= this.lifeDuration) this.beginCollapse();
    } else if (this.phase === 'collapsing') {
      const t = Math.min(1, this.phaseTime / this.collapseDuration);
      this.scaleT = this.collapseFrom * (1 - t * t * t);
      if (this.phaseTime >= this.collapseDuration) {
        this.phase = 'dead';
        this.alive = false;
        this.mesh.visible = false;
        this.rays.visible = false;
        this.orbitRing.visible = false;
        this.orbitCircle.visible = false;
      }
    }

    if (!this.alive) return;

    // A bass hit swells the body ~5% on top of its lifecycle scale. Hits
    // land softer in quiet passages so the planets calm down with the music.
    const hit = audio.getHit('bass') * (0.35 + 0.65 * audio.getVolume());
    this.mesh.scale.setScalar(Math.max(0.001, this.scaleT) * (1 + hit * 0.05));
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y += 0.005;
    this.mesh.rotation.x += 0.003;

    this.uniforms.uTime.value = time;
    this.uniforms.uBass.value = audio.getBass();
    this.uniforms.uMid.value = audio.getMid();
    this.uniforms.uTreble.value = audio.getTreble();
    this.uniforms.uHit.value = hit;

    if (this.rays.visible) {
      this.rays.position.copy(this.position);
      this.rays.scale.setScalar(Math.max(0.001, this.scaleT) * this.radius);
      this.rays.rotation.y = time * this._raySpin;        // sim time: stops under F with the shader time
      const u = this.rayUniforms;
      u.uTime.value = time; u.uBass.value = audio.getBass(); u.uHit.value = hit; u.uVolume.value = audio.getVolume();
    }
    if (this.orbitRing.visible) {
      const s = Math.max(0.001, this.scaleT) * this.radius, o = this._orbits;
      this.orbitRing.position.copy(this.position);
      this.orbitRing.scale.setScalar(s * o.ringRadius);
      this.orbitRing.rotation.y = time * this._orbitSpin;         // sim time: stops under F with the shader time
      this.orbitCircle.position.copy(this.position);
      this.orbitCircle.scale.setScalar(s * o.circleRadius);
      this.orbitCircle.rotation.y = time * this._orbitPrecess;
      const ou = this.orbitUniforms;
      ou.uTime.value = time; ou.uBass.value = audio.getBass(); ou.uHit.value = hit; ou.uVolume.value = audio.getVolume();
    }
  }

  // Start collapsing now, from the current scale, so a body that's still
  // spawning shrinks back instead of popping to full size first.
  beginCollapse() {
    if (this.phase === 'collapsing' || this.phase === 'dead') return;
    this.collapseFrom = this.scaleT;
    this.phase = 'collapsing';
    this.phaseTime = 0;
  }

  destroy() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.scene.remove(this.rays);
    this.rayMaterial.dispose();                            // the fan geometry is shared, it stays
    this.scene.remove(this.orbitRing);
    this.scene.remove(this.orbitCircle);
    this.orbitDotMaterial.dispose();                       // the ring geometries are shared too, they stay
    this.orbitCircleMaterial.dispose();
  }

  applyLook(look, palette) {
    const p = look.planet;
    this.mesh.visible = p.visible && this.alive;
    this.material.wireframe = p.wireframe;
    const skin = PLANET_SKINS[p.skin] ?? 0;
    if (skin !== this.uniforms.uSkin.value) {
      // A new skin starts with a clean surface: no ripple from the old look
      // lingers as a 3 s spot, no spot comes back as a ripple.
      for (let k = 0; k < MAX_SURFACE_EVENTS; k++) this.surfaceEvents[k * 4 + 3] = -1000;
    }
    this.uniforms.uSkin.value = skin;
    this.uniforms.uSpotLife.value = p.spotLife;
    this.uniforms.uColorCore.value.set(palette.core);
    this.uniforms.uColorInner.value.set(palette.rayInner);
    this.uniforms.uColorOuter.value.set(palette.rayOuter);

    // Extras this look owns: the ray fan. The fan geometry is shared, so its
    // draw range (rays.count) is the current look's for every body.
    const r = look.rays;
    this.rays.visible = look.extras.includes('rays') && this.alive;
    this._raySpin = (this.index % 2 ? -1 : 1) * r.spin;   // neighbours spin opposite ways
    this.rays.geometry.setDrawRange(0, Math.min(RAY_COUNT, r.count) * 2);
    this.rayUniforms.uLength.value = r.length;
    this.rayUniforms.uOpacity.value = r.opacity;
    this.rayUniforms.uColorInner.value.set(palette.rayInner);
    this.rayUniforms.uColorOuter.value.set(palette.rayOuter);

    // Orbits: the dot ring and the circle, dialled by the look. The dot
    // geometry is shared, so its draw range (orbits.dots) is the current
    // look's for every body.
    const o = look.orbits;
    const orbitsOn = look.extras.includes('orbits') && this.alive;
    this._orbits = o;
    this.orbitRing.visible = orbitsOn;
    this.orbitCircle.visible = orbitsOn;
    this.orbitRing.geometry.setDrawRange(0, Math.min(ORBIT_DOTS, o.dots));
    this._orbitSpin = (this.index % 2 ? -1 : 1) * o.spin;          // neighbours turn opposite ways
    this._orbitPrecess = (this.index % 2 ? 1 : -1) * o.precess;
    this.orbitCircle.rotation.x = this._orbitTilt * o.tilt;
    this.orbitUniforms.uOpacity.value = o.opacity;
    this.orbitUniforms.uCircleOpacity.value = o.circleOpacity;
    this.orbitUniforms.uDotSize.value = o.dotSize;
    this.orbitUniforms.uArc.value = o.spin * 2;
    this.orbitUniforms.uColor.value.set(palette.rayInner);
  }
}

// ─── Magnetic Particle System ────────────────────────────────────────────────

// Particles are thrown off a source core, mostly on bass hits, with a launch
// energy set by their own frequency. Near the source they're ballistic under
// its gravity: low energy rises, bounces once and lands; high energy clears a
// couple of radii, where the magnetic field takes over. Every alive core is a
// monopole with its effectiveCharge and the field is the sum of q * r / |r|^3,
// so escapees stream from positive cores to negative ones and land there.
//
// All speeds are scene units per second, rates are particles per second.
// These are the knobs to turn while watching Demo Mode.
const TRAIL_POINTS = 200;  // ring slots per particle; points are written at most 60/s, so 3.3 s at any refresh rate
const LINK_MAX_PAIRS = 7500;   // fixed link buffer (Starburst): 5000 stars x 3 links / 2 under the A key, so the cap never binds; the look runs at the chosen count
const LINK_MAX_DEGREE = 8;     // partners a star can list; links.perParticle is clamped to it
const RIBBON_POINTS = 120;     // ribbon ring slots per particle (Ribbons, Paper): 2 s at the 60 Hz write cadence
const RIBBON_NONE = -1e9;      // birth of a ribbon slot that holds no point of a live strand
const SHARD_MAX = 512;         // pool of shards thrown on hits (extras 'shards')

const PARTICLE_TUNING = {
  // Emission
  trickleBase:   0.02,  // steady emission at silence, fraction of count per second
  trickleVolume: 0.15,  // extra steady emission per unit of loudness
  trickleCap:    0.05,  // cap on trickle emissions per frame, fraction of count
  hitBurst:      0.10,  // burst on a bass hit at full bass level, fraction of count
  hitBurstMin:   0.3,   // a soft kick still throws this fraction of hitBurst
  burstCap:      0.06,  // cap on burst emissions per frame, fraction of count
  spotsMin:      2,     // flare spots per source per hit
  spotsMax:      4,
  spotSpread:    0.26,  // radians of scatter around a flare spot
  // Launch
  energyQuiet:   0.25,  // at silence, this much of a particle's level becomes launch energy
  energyLoud:    1.0,   // ...and this much at full loudness, so loud passages escape more
  kickFloor:     0.4,   // energy multiplier for the softest kick...
  kickGain:      1.0,   // ...plus this much at a full-strength kick: hard kicks throw farther
  energyNoise:   0.3,   // random spread on energy, keeps both populations present
  launchMin:     1.2,   // speed at zero energy
  launchMax:     6.5,   // speed at full energy
  launchSpread:  0.08,  // random jitter on launch velocity, as a fraction of launch speed
  launchElevMin: 25,    // degrees above the local horizon for the flattest launch
  launchElevMax: 90,    // ...and the steepest (straight up)
  launchElevBias: 2.0,  // higher = more launches near vertical, fewer lofted
  spotLean:      0.5,   // how much a burst scatters around its flare's jet direction
  srcGravity:    6.0,   // escape speed off any surface = sqrt(2 * srcGravity), ~3.5
  restitution:   0.35,  // one bounce before landing
  bounceMin:     0.8,   // impacts slower than this just land
  escapeRadii:   1.6,   // radii: an unbound particle hands over to the field from here out
  // Look
  pointSize:     0.45,  // base sprite size (pixels ~ size * 250 / distance)
  poolQuiet:     0.25,  // fraction of the pool allowed in flight at silence; all of it at full loudness
  // Field flight
  speedBase:     1.6,   // cruise speed along a field line at silence
  speedVolume:   1.8,   // extra speed per unit of volume
  poleBoost:     0.8,   // up to +80% speed where the field is strong (near a core)
  poleFieldRef:  0.5,   // |B| at which poleBoost saturates
  steer:         1.5,   // 1/s, how fast velocity bends toward the field line (a nudge, not an override)
  shimmer:       1.2,   // sideways wobble speed driven by the particle's FFT bin
  fadeIn:        0.12,  // seconds to full brightness after emission
  maxAge:        14,    // seconds before a particle is recycled regardless
  boundaryMult:  2.2,   // lines that escape past this many extents recycle
  boundaryMin:   12,    // ...but never closer than this
  // Charge (only when a look's sim.charge is not 'none')
  sepRadius:     1.0,   // separation acts within this distance
  sepMax:        8,     // neighbours considered per particle per frame
  // Collapse
  pullRadii:     4,     // a collapsing core pulls particles from this many radii out
  pullStrength:  10,    // inward acceleration at full collapse, at the core
  burstSpeed:    8,     // outward impulse when a core dies
  burstRadii:    2.5,   // particles within this many radii of a dying core get it
  kickDecay:     1.2,   // seconds for a burst to hand control back to the field
};

// Cell visiting order for the separation walk: the particle's own cell, then
// the six face neighbours, the twelve edges, the eight corners (flat xyz
// triples). The walk stops at sepMax neighbours, so in a dense cloud it has
// to look at the nearest cells first or the capped sum leans toward
// whichever corner the loop starts in.
const SEP_CELL_ORDER = (() => {
  const cells = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) cells.push([x, y, z]);
  cells.sort((a, b) => (Math.abs(a[0]) + Math.abs(a[1]) + Math.abs(a[2])) - (Math.abs(b[0]) + Math.abs(b[1]) + Math.abs(b[2])));
  return Int8Array.from(cells.flat());
})();

class MagneticParticles {
  constructor(scene, cores, initialCount) {
    this.scene = scene;
    this.cores = cores;
    this.maxCount = 5000;
    this.count = initialCount;
    this.look = makeLook('default');
    this.trailSeconds = 0.5;
    this.trailStyle = 'line';
    this.spriteScale = 1.0;
    this.hueScatter = 0;
    this._chargeRule = 'none';
    this._cometSprite = false;   // upload the velocity attribute each frame
    this._spotEvents = false;    // landings register kind-2 spots instead of ripples
    this.t = 0;
    this.emitBudget = 0;     // trickle
    this.activeCount = 0;    // particles in flight
    this.burstBudget = 0;    // hit bursts, from flare spots
    this._burstKick = 0;     // bass level at the last flare
    this._spotsByCore = new Map(); // Core -> flat [nx,ny,nz, lx,ly,lz, ...]: surface direction + jet lean
    this._dir = [0, 0, 0];
    this._lean = [0, 0, 0];

    // Per-particle state. Everything starts dormant (hidden) and is released
    // through the emission budgets, so streams build up over the first second.
    const n = this.maxCount;
    this.positions = new Float32Array(n * 3);
    this.velocities = new Float32Array(n * 3);
    this.active = new Uint8Array(n);      // 0 dormant (hidden), 1 in flight
    this.flowDir = new Int8Array(n);      // +1 follows B, -1 follows -B
    this.escaped = new Uint8Array(n);     // 0 ballistic near the source, 1 on the field
    this.bounced = new Uint8Array(n);     // one bounce allowed before landing
    this.energy = new Float32Array(n);    // launch energy 0..1, from the particle's frequency
    this.sourceCore = new Array(n).fill(null);
    this.ages = new Float32Array(n);
    this.kicks = new Float32Array(n);     // seconds of reduced steering left after a burst
    this.brightness = new Float32Array(n);
    this.listenHz = new Float32Array(n);  // the frequency each particle listens to
    this.sizeMul = new Float32Array(n);   // per-particle size, so they keep their individuality
    this.phases = new Float32Array(n);    // shimmer phase offset
    this.charge = new Float32Array(n);    // signed charge this frame (0 unless the look uses charge)
    this.chargeSign = new Int8Array(n);
    this.hueOff = new Float32Array(n);    // per-particle hue offset, scaled by the look's hueScatter
    this.hueInner = new Float32Array(n * 3); // per-particle hue-shifted palette colours, filled in applyLook
    this.hueOuter = new Float32Array(n * 3);
    this.trailLen = new Uint16Array(n);   // trail points written since emission, capped
    this.trailHead = new Uint16Array(n);  // ring slot of each particle's newest trail point
    this._drain = false;                  // trails.drain: a landed particle's strand stays and fades out instead of vanishing
    this._gridHeads = new Int32Array(4096);
    this._gridNext = new Int32Array(n);
    this._sep = [0, 0, 0];

    for (let i = 0; i < n; i++) {
      // Log-spaced so every octave has listeners. Uniform bins would put
      // most particles above 4 kHz, where music has almost nothing.
      const [loHz, hiHz] = AUDIO_TUNING.particleHz;
      this.listenHz[i] = loHz * Math.pow(hiHz / loHz, Math.random());
      this.sizeMul[i] = 0.6 * Math.pow(3, Math.random());        // 0.6x .. 1.8x, log-uniform
      this.phases[i] = Math.random() * Math.PI * 2;
      this.hueOff[i] = Math.random() * 2 - 1;
    }

    // Emitter table, rebuilt every frame: cores plus cumulative weights.
    this._emitters = [];
    this._emitWeights = [];
    this._emitTotal = 0;

    // --- Point particles ---
    this.pointGeo = new THREE.BufferGeometry();
    this.pointPositions = new Float32Array(n * 3);
    this.pointColors = new Float32Array(n * 3);
    this.pointSizes = new Float32Array(n);
    this.pointGeo.setAttribute('position', new THREE.BufferAttribute(this.pointPositions, 3));
    this.pointGeo.setAttribute('color', new THREE.BufferAttribute(this.pointColors, 3));
    this.pointGeo.setAttribute('size', new THREE.BufferAttribute(this.pointSizes, 1));
    this.pointGeo.setAttribute('velocity', new THREE.BufferAttribute(this.velocities, 3)); // comet sprites orient by it

    this.pointMat = new THREE.ShaderMaterial({
      uniforms: { uSprite: { value: 0 } },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        attribute vec3 velocity;
        uniform float uSprite;
        varying vec3 vColor;
        varying vec2 vDir;    // comet: screen-space direction of travel in gl_PointCoord space (y down)
        varying float vTail;  // comet: 0..1 how much tail to draw; short when moving along the view axis
        varying float vSpike; // star: 0..1 how much lens cross to draw; only the bigger, brighter points get one
        void main() {
          vColor = color;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vec4 clip = projectionMatrix * mvPos;
          gl_PointSize = size * (250.0 / -mvPos.z);
          gl_Position = clip;
          vDir = vec2(0.0, 1.0);
          vTail = 0.0;
          vSpike = 0.0;
          if (abs(uSprite - 2.0) < 0.5) {
            // Star: a lens cross on the bigger, brighter points only (near,
            // a loud bin, a large sizeMul), as the flares in the reference
            // sit on the brightest stars. Sized in device pixels.
            float px = size * (250.0 / -mvPos.z);
            float lum = max(color.r, max(color.g, color.b));
            vSpike = smoothstep(10.0, 22.0, px) * smoothstep(0.4, 0.9, lum);
          } else if (abs(uSprite - 1.0) < 0.5 || abs(uSprite - ${SPRITES.streak}.0) < 0.5) {
            // Comet and streak: where the particle will be in 1/20 s, projected,
            // gives the tail direction on screen. x is scaled by the aspect (P[1][1] / P[0][0])
            // so the direction is right inside the square point sprite.
            vec4 ahead = projectionMatrix * (mvPos + modelViewMatrix * vec4(velocity * 0.05, 0.0));
            vec2 d = ahead.xy / max(ahead.w, 0.0001) - clip.xy / max(clip.w, 0.0001);
            d.x *= projectionMatrix[1][1] / projectionMatrix[0][0];
            d.y = -d.y;                                                // gl_PointCoord has y down
            float len = length(d);
            if (len > 0.000001) vDir = d / len;
            vTail = clamp(len * 60.0, 0.0, 1.0);
          }
        }
      `,
      fragmentShader: `
        uniform float uSprite;   // SPRITES index: 0 disc, 1 comet, 2 star, 3 flat, 4 streak
        varying vec3 vColor;
        varying vec2 vDir;
        varying float vTail;
        varying float vSpike;
        void main() {
          if (uSprite > 2.5) {
            // Flat (Paper): an opaque disc in the particle's flat colour with
            // a drawn outline, lighter on a dark fill and darker on a light
            // one, anti-aliased at the rim. Nothing glows; drawn with normal
            // blending so a disc sits on whatever is behind it.
            float d = length(gl_PointCoord - 0.5) * 2.0;
            if (d > 1.0) discard;
            float ring = smoothstep(0.70, 0.78, d);
            float lum = dot(vColor, vec3(0.299, 0.587, 0.114));
            vec3 line = mix(mix(vColor, vec3(1.0), 0.5), vColor * 0.5, step(0.5, lum));
            float aa = 1.0 - smoothstep(0.94, 1.0, d);
            gl_FragColor = vec4(mix(vColor, line, ring), aa);
            return;
          }          if (uSprite < 0.5) {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            if (d > 1.0) discard;
            // Solid disc with a thin feathered edge and a hot center, so a
            // particle reads as a point of light rather than a fog blob.
            float disc = 1.0 - smoothstep(0.6, 1.0, d);
            float core = 1.0 - smoothstep(0.0, 0.35, d);
            float alpha = disc * 0.85 + core * 0.6;
            gl_FragColor = vec4(vColor * (1.0 + core * 0.6), alpha);
            return;
          }
          if (abs(uSprite - ${SPRITES.streak}.0) < 0.5) {
            // Streak (Attractor): a small hot point in a soft glow with a
            // short thin dash behind it along the direction of travel,
            // thinner and shorter than the comet's tail (60% of the sprite
            // radius, a thread by its end), so a particle reads as a mote
            // moving along a field line; just the dot when it moves along
            // the view axis (vTail 0).
            vec2 p = (gl_PointCoord - 0.5) * 2.0;
            float r2 = dot(p, p);
            float along = dot(p, -vDir);                        // positive behind the head
            float across = abs(p.x * vDir.y - p.y * vDir.x);    // distance from the travel axis
            float head = exp(-r2 * 60.0);                       // hot point, ~0.13 of the sprite
            float glow = exp(-r2 * 12.0);                       // soft halo
            float tl = clamp(along / 0.6, 0.0, 1.0);            // 0 at the head, 1 at the dash's end
            float width = mix(0.07, 0.012, tl);
            float dash = (1.0 - tl) * (1.0 - tl)
                       * (1.0 - smoothstep(0.0, width, across))
                       * smoothstep(-0.05, 0.05, along) * vTail;
            float alpha = head + glow * 0.3 + dash * 0.85;
            if (alpha < 0.005) discard;
            vec3 rgb = vColor * (glow * 0.45 + dash + head * 0.5) + vec3(head) * 1.1;
            gl_FragColor = vec4(rgb, min(alpha, 1.0));
            return;
          }
          if (uSprite > 1.5) {
            // Star: a hot centre, a soft halo that fills the sprite (the
            // halos of a cluster sum into its glow), and on the bigger
            // points a faint four-point lens cross along the screen axes:
            // each arm a thin gaussian across and a square fall-off along,
            // so it is a short spike, not a line to the sprite edge.
            vec2 p = (gl_PointCoord - 0.5) * 2.0;
            float r2 = dot(p, p);
            float hot  = exp(-r2 * 55.0);                                   // the point, ~0.13 of the sprite
            float halo = exp(-r2 * 5.0);                                    // soft glow, gone by the edge
            vec2 a = abs(p);
            float spike = exp(-a.x * a.x * 160.0) * (1.0 - a.y) * (1.0 - a.y)   // vertical arm
                        + exp(-a.y * a.y * 160.0) * (1.0 - a.x) * (1.0 - a.x);  // horizontal arm
            spike *= vSpike;
            float alpha = hot + halo * 0.4 + spike * 0.5;
            if (alpha < 0.004) discard;                                     // also trims the square: the halo is 0.0027 at the corner
            vec3 rgb = vColor * (halo * 0.55 + spike * 0.6 + hot * 0.5) + vec3(hot) * 1.4 + vec3(spike) * 0.25;
            gl_FragColor = vec4(rgb, min(alpha, 1.0));
            return;
          }
          // Comet: a white-hot head with a coloured glow and a tail that
          // tapers in width and brightness behind it, against the direction
          // of travel. The line trail carries on from the tail's tip.
          vec2 p = (gl_PointCoord - 0.5) * 2.0;
          float r2 = dot(p, p);
          float along = dot(p, -vDir);                        // positive behind the head
          float across = abs(p.x * vDir.y - p.y * vDir.x);    // distance from the travel axis
          float head = exp(-r2 * 70.0);                       // hot point, ~0.12 of the sprite
          float glow = exp(-r2 * 9.0);                        // soft halo
          float tl = clamp(along / 0.95, 0.0, 1.0);           // 0 at the head, 1 at the sprite edge
          float width = mix(0.14, 0.015, tl);                 // wide at the head, a thread at the end
          float tail = (1.0 - tl) * (1.0 - tl)
                     * (1.0 - smoothstep(0.0, width, across))
                     * smoothstep(-0.08, 0.08, along) * vTail;
          float alpha = head + glow * 0.35 + tail * 0.75;
          if (alpha < 0.005) discard;
          vec3 rgb = vColor * (glow * 0.5 + tail + head * 0.6) + vec3(head) * 1.2;
          gl_FragColor = vec4(rgb, min(alpha, 1.0));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.pointGeo, this.pointMat);
    scene.add(this.points);

    // --- Trails ---
    // A global ring of TRAIL_POINTS slots; every active particle writes the
    // current slot each frame (slot-major layout, so one frame's writes are
    // one contiguous block to upload). Segments are rebuilt each frame from
    // each particle's valid points and fade in the shader by age, so trail
    // length is seconds, not points, and frame rate doesn't change the look.
    this.trailSlot = 0;
    this._lastTrailWrite = -1;
    this._trailWrote = false;
    const tp = TRAIL_POINTS * n;
    this.trailPositions = new Float32Array(tp * 3);
    this.trailColors = new Float32Array(tp * 3);
    this.trailBirth = new Float32Array(tp);
    this.trailIndex = new Uint32Array(n * (TRAIL_POINTS - 1) * 2);
    this.trailGeo = new THREE.BufferGeometry();
    this.trailPosAttr = new THREE.BufferAttribute(this.trailPositions, 3);
    this.trailColAttr = new THREE.BufferAttribute(this.trailColors, 3);
    this.trailBirthAttr = new THREE.BufferAttribute(this.trailBirth, 1);
    this.trailIdxAttr = new THREE.BufferAttribute(this.trailIndex, 1);
    this.trailGeo.setAttribute('position', this.trailPosAttr);
    this.trailGeo.setAttribute('color', this.trailColAttr);
    this.trailGeo.setAttribute('birth', this.trailBirthAttr);
    this.trailGeo.setIndex(this.trailIdxAttr);
    this.trailGeo.setDrawRange(0, 0);

    this.trailMat = new THREE.ShaderMaterial({
      uniforms: { uNow: { value: 0 }, uSeconds: { value: 0.5 }, uOpacity: { value: 0.6 }, uStyle: { value: 0 } },
      vertexShader: `
        attribute vec3 color;
        attribute float birth;
        uniform float uNow;
        uniform float uSeconds;
        uniform float uOpacity;
        uniform float uStyle;    // 0 linear fade (line), 1 comet: cubic taper with a hot tip, 2 hair: even strand, soft root
        varying vec3 vColor;
        void main() {
          float fade = clamp(1.0 - (uNow - birth) / uSeconds, 0.0, 1.0);
          if (uStyle > 1.5) {
            // Hair: near-even brightness along the strand (the square root
            // holds it up until the root, which then dies softly), with the
            // newest few points lifted so the strand joins its tip dot.
            float tip = max(0.0, 1.0 - (1.0 - fade) * 14.0);
            vColor = (color * sqrt(fade) + vec3(tip * 0.4)) * uOpacity;
          } else if (uStyle > 0.5) {
            // Brightness falls off fast behind the head so a 1 px line reads
            // as a streak that thins out; the newest ~11% is lifted toward
            // white so it joins the sprite's hot head.
            float tip = max(0.0, 1.0 - (1.0 - fade) * 9.0);
            vColor = (color * (fade * fade * fade + tip * 0.8) + vec3(tip * 0.35)) * uOpacity;
          } else {
            vColor = color * fade * uOpacity;
          }
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() { gl_FragColor = vec4(vColor, 1.0); }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.trailLines = new THREE.LineSegments(this.trailGeo, this.trailMat);
    scene.add(this.trailLines);

    // --- Links (Starburst) ---
    // A fixed buffer of LINK_MAX_PAIRS segments with a draw range, filled
    // from the spatial grid by _buildLinks when the look's extras include
    // 'links'. Own vertices rather than an index over the point buffer so
    // each pair can carry its own distance fade. Each star keeps the
    // partners its own walk found this frame, so a pair is written once.
    this._links = null;                        // the look's links section while the pass is on
    this.linkPairs = 0;
    this.linkDegree = new Uint8Array(n);
    this.linkOf = new Int32Array(n * LINK_MAX_DEGREE);
    this.linkPositions = new Float32Array(LINK_MAX_PAIRS * 6);
    this.linkColors = new Float32Array(LINK_MAX_PAIRS * 6);
    this.linkGeo = new THREE.BufferGeometry();
    this.linkPosAttr = new THREE.BufferAttribute(this.linkPositions, 3);
    this.linkColAttr = new THREE.BufferAttribute(this.linkColors, 3);
    this.linkGeo.setAttribute('position', this.linkPosAttr);
    this.linkGeo.setAttribute('color', this.linkColAttr);
    this.linkGeo.setDrawRange(0, 0);
    this.linkMat = new THREE.ShaderMaterial({
      vertexShader: `
        attribute vec3 color;
        varying vec3 vColor;
        void main() { vColor = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() { gl_FragColor = vec4(vColor, 1.0); }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.linkLines = new THREE.LineSegments(this.linkGeo, this.linkMat);
    this.linkLines.visible = false;
    this.linkLines.frustumCulled = false;   // the bounding sphere would be computed once, from zeros
    scene.add(this.linkLines);

    // --- Ribbons (trails.style 'ribbon') and shards (extras 'shards') ---
    // Both are built by the first look that asks (_ensureRibbons,
    // _ensureShards), so the other looks pay nothing for them.
    this._ribbons = null;        // the look's ribbons section while trails.style is 'ribbon'
    this._flatColor = false;     // ribbons.shade 'flat': discs and ribbons carry one flat palette colour, not the level lerp
    this._shards = null;         // the look's shards section while extras has 'shards'
    this.ribbonGeo = null;
    this.ribbonMesh = null;
    this.shardGeo = null;
    this.shardMesh = null;
    this.rbSlot = 0;             // ribbon ring slot, advanced with the trail cadence under a ribbon look
    this.innerColor = new THREE.Color(0x6699ff);
    this.outerColor = new THREE.Color(0x2244aa);
    // Pooled color objects to avoid GC pressure in hot loops
    this._tmpColorA = new THREE.Color();
    this._tmpColorB = new THREE.Color();
    this._tmpColorParticle = new THREE.Color();
  }

  setCount(n) {
    const next = Math.max(100, Math.min(this.maxCount, n));
    // Anything above the new count goes dormant so it isn't left frozen on
    // screen; its strand goes with it, since the index never walks above
    // count and a held strand would reappear if the count grew back.
    for (let i = next; i < this.count; i++) { this._sleep(i); this.trailLen[i] = 0; }
    this.count = next;
  }

  applyLook(look, palette) {
    this.look = look;
    const tr = look.trails;
    const style = tr.style === 'none' ? 'none' : tr.style === 'ribbon' ? 'ribbon' : 'line';
    if (style !== this.trailStyle) this.trailLen.fill(0);
    this.trailStyle = style;
    this.trailSeconds = Math.max(0.05, tr.seconds);
    this.trailMat.uniforms.uSeconds.value = this.trailSeconds;
    this.trailMat.uniforms.uOpacity.value = tr.opacity;
    this.trailMat.uniforms.uStyle.value = tr.style === 'comet' ? 1 : tr.style === 'hair' ? 2 : 0;
    this.trailLines.visible = style === 'line';
    // Draining strands belong to dormant particles; a look without draining
    // drops them now so they can't come back when the particle is reused.
    this._drain = tr.drain === true;
    if (!this._drain) for (let i = 0; i < this.maxCount; i++) if (!this.active[i]) this.trailLen[i] = 0;

    this.spriteScale = look.particles.size;
    this.hueScatter = look.particles.hueScatter;
    const sprite = SPRITES[look.particles.sprite] ?? 0;
    this.pointMat.uniforms.uSprite.value = sprite;
    this._cometSprite = sprite === SPRITES.comet || sprite === SPRITES.streak;   // both orient by the velocity attribute
    this._spotEvents = look.planet.landing === 'spot';
    this.points.visible = true;

    // Extras this look owns. Links: a web between neighbours, rebuilt from
    // the grid each frame into the fixed buffer; off, it draws nothing.
    this._links = look.extras.includes('links') ? look.links : null;
    this.linkLines.visible = this._links !== null;
    if (!this._links) { this.linkGeo.setDrawRange(0, 0); this.linkPairs = 0; }

    this.innerColor.set(palette.rayInner);
    this.outerColor.set(palette.rayOuter);
    // Hue scatter is fixed per particle per look, so shift the palette once
    // here rather than two HSL conversions per particle per frame.
    if (this.hueScatter > 0) {
      const a = this._tmpColorA, b = this._tmpColorB, hi = this.hueInner, ho = this.hueOuter;
      for (let i = 0; i < this.maxCount; i++) {
        const i3 = i * 3, h = this.hueOff[i] * this.hueScatter;
        a.set(this.innerColor).offsetHSL(h, 0, 0);
        b.set(this.outerColor).offsetHSL(h, 0, 0);
        hi[i3] = a.r; hi[i3 + 1] = a.g; hi[i3 + 2] = a.b;
        ho[i3] = b.r; ho[i3 + 1] = b.g; ho[i3 + 2] = b.b;
      }
    }

    // Ribbons: the strip renderer over its own ring, built on first use.
    // Coming in from a look without them every live strand restarts
    // (trailLen is 0, so its first point folds) and the ring is blanked, so
    // no quad can run from a strand left behind to a point written now.
    const hadRibbons = this._ribbons !== null;
    this._ribbons = style === 'ribbon' ? look.ribbons : null;
    this._flatColor = this._ribbons !== null && this._ribbons.shade === 'flat';
    if (this._ribbons) {
      this._ensureRibbons();
      if (!hadRibbons) { this.rbBirth.fill(RIBBON_NONE); this._rbWipe = true; }
      const R = this._ribbons, u = this.ribbonMat.uniforms;
      u.uSeconds.value = Math.min(this.trailSeconds, (RIBBON_POINTS - 2) / 60);
      u.uOpacity.value = tr.opacity; u.uWidth.value = R.width; u.uTint.value = R.tint;
      u.uFlat.value = this._flatColor ? 1 : 0; u.uTaper.value = R.taper === 'bulge' ? 1 : 0;
      this.ribbonMat.blending = this._flatColor ? THREE.NormalBlending : THREE.AdditiveBlending;
    } else if (this.ribbonGeo) {
      this.ribbonGeo.setDrawRange(0, 0);
    }
    if (this.ribbonMesh) this.ribbonMesh.visible = this._ribbons !== null;
    // Flat colours: inner, outer or an accent (the inner hue shifted by
    // accentHue) per particle, picked by its hueOff so no RNG is drawn:
    // 15% accent, 45% inner, 40% outer. Discs and shards follow the ribbons.
    if (this._flatColor) {
      const fc = this.ribbonColor;
      const a = this._tmpColorA.set(this.innerColor), b = this._tmpColorB.set(this.outerColor);
      const c = this._tmpColorParticle.set(this.innerColor).offsetHSL(this._ribbons.accentHue, 0, 0);
      for (let i = 0; i < this.maxCount; i++) {
        const u = (this.hueOff[i] + 1) * 0.5, i3 = i * 3;
        const col = u < 0.15 ? c : u < 0.6 ? a : b;
        fc[i3] = col.r; fc[i3 + 1] = col.g; fc[i3 + 2] = col.b;
      }
    }
    this.pointMat.blending = this._flatColor ? THREE.NormalBlending : THREE.AdditiveBlending;

    // Shards: thrown on hits while the pass is on; the pool is built on first use.
    this._shards = look.extras.includes('shards') ? look.shards : null;
    if (this._shards) {
      this._ensureShards();
      const S = this._shards, u = this.shardMat.uniforms;
      u.uLife.value = S.life; u.uSpeed.value = S.speed; u.uLength.value = S.length; u.uWidth.value = S.width; u.uOpacity.value = S.opacity;
      u.uFlat.value = this._flatColor ? 1 : 0;
      u.uColorA.value.set(palette.rayInner); u.uColorB.value.set(palette.rayOuter);
      this.shardMat.blending = this._flatColor ? THREE.NormalBlending : THREE.AdditiveBlending;
    }
    if (this.shardMesh) this.shardMesh.visible = this._shards !== null;
    // A new charge rule re-signs the live particles so it takes effect now.
    if (look.sim.charge !== this._chargeRule) {
      this._chargeRule = look.sim.charge;
      for (let i = 0; i < this.maxCount; i++) this.chargeSign[i] = this._chargeSignFor(i);
    }
  }

  // The ribbon ring, built on the first ribbon look: RIBBON_POINTS slots per
  // particle, two vertices per point (see the Ribbons comment above the
  // shaders for the layout, the static index and the three rules).
  _ensureRibbons() {
    if (this.ribbonGeo) return;
    const n = this.maxCount, P = RIBBON_POINTS, V = P * n * 2;
    this.rbTan = new Float32Array(n * 3);          // tangent at the last write
    this.rbNor = new Float32Array(n * 3);          // face normal at the last write
    this.rbHead = new Uint8Array(n);               // ring slot of each particle's newest ribbon point
    this.ribbonColor = new Float32Array(n * 3);    // flat palette colour per particle (shade 'flat'), filled in applyLook
    this.rbPositions = new Float32Array(V * 3);
    this.rbSides = new Int8Array(V * 4);
    this.rbNormals = new Int8Array(V * 4);
    this.rbColors = new Uint8Array(V * 4);
    this.rbBirth = new Float32Array(V).fill(RIBBON_NONE);
    this.rbSign = new Int8Array(V);
    for (let v = 0; v < V; v++) this.rbSign[v] = v & 1 ? 127 : -127;
    this.rbIndex = new Uint32Array(P * n * 6 * 2);
    const g = this.ribbonGeo = new THREE.BufferGeometry();
    this.rbPosAttr = new THREE.BufferAttribute(this.rbPositions, 3);
    this.rbSideAttr = new THREE.BufferAttribute(this.rbSides, 4, true);
    this.rbNormAttr = new THREE.BufferAttribute(this.rbNormals, 4, true);
    this.rbColAttr = new THREE.BufferAttribute(this.rbColors, 4, true);
    this.rbBirthAttr = new THREE.BufferAttribute(this.rbBirth, 1);
    this.rbIdxAttr = new THREE.BufferAttribute(this.rbIndex, 1);
    g.setAttribute('position', this.rbPosAttr);
    g.setAttribute('aSide', this.rbSideAttr);
    g.setAttribute('aNormal', this.rbNormAttr);
    g.setAttribute('aColor', this.rbColAttr);
    g.setAttribute('birth', this.rbBirthAttr);
    g.setAttribute('aSign', new THREE.BufferAttribute(this.rbSign, 1, true));
    g.setIndex(this.rbIdxAttr);
    g.setDrawRange(0, 0);
    this.ribbonMat = new THREE.ShaderMaterial({
      uniforms: {
        uNow: { value: 0 }, uSeconds: { value: 1.5 }, uOpacity: { value: 0.6 }, uWidth: { value: LOOK_DEFAULTS.ribbons.width },
        uTint: { value: LOOK_DEFAULTS.ribbons.tint }, uFlat: { value: 0 }, uTaper: { value: 0 },
        uLight: { value: new THREE.Vector3(-0.356, 0.814, 0.458) },
      },
      vertexShader: RIBBON_VERTEX, fragmentShader: RIBBON_FRAGMENT,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.ribbonMesh = new THREE.Mesh(g, this.ribbonMat);
    this.ribbonMesh.frustumCulled = false;   // the bounding sphere would be computed once, from zeros
    this.ribbonMesh.renderOrder = -1;        // before the points, so a flat disc sits on its own ribbon
    this.scene.add(this.ribbonMesh);
    this._rbIndexCount = -1;                 // the count the static index was built for
    this._rbWipe = false;                    // the whole birth buffer goes up on the next frame
  }

  // Static index for `count` particles: block s holds the quad from slot
  // s-1 to slot s for every particle (6 indices each), blocks 0..P-1, then
  // the same again, so any window of W <= P-1 blocks ending at the head is
  // one contiguous range. Rebuilt only when the count changes.
  _rebuildRibbonIndex() {
    const n = this.maxCount, c = this.count, P = RIBBON_POINTS, idx = this.rbIndex;
    let k = 0;
    for (let rep = 0; rep < 2; rep++) {
      for (let s = 0; s < P; s++) {
        const o = s === 0 ? P - 1 : s - 1;
        for (let i = 0; i < c; i++) {
          const a = (o * n + i) * 2, b = (s * n + i) * 2;
          idx[k++] = a; idx[k++] = a + 1; idx[k++] = b;
          idx[k++] = a + 1; idx[k++] = b + 1; idx[k++] = b;
        }
      }
    }
    this.rbIdxAttr.clearUpdateRanges(); this.rbIdxAttr.addUpdateRange(0, k); this.rbIdxAttr.needsUpdate = true;
    this._rbIndexCount = c;
  }

  // One ribbon point. The tangent is this write's velocity; on the first
  // point of a life the normal is a perpendicular rolled by the particle's
  // phase (fixed per particle, no RNG), after that it is parallel-
  // transported from the last write (no flips at inflections) and the frame
  // is rolled about the tangent by twist x the turn since the last write
  // (clamped, so a bounce kinks the tape rather than spinning it) plus the
  // strand's own slow roll. The width share is speed times size, 0 on the
  // first point so the strand starts from nothing. Both edge vertices get
  // the same data; aSign tells them apart.
  _writeRibbonPoint(i, px, py, pz, vx, vy, vz, cr, cg, cb, bright, gap) {
    const R = this._ribbons, i3 = i * 3, tan = this.rbTan, nor = this.rbNor;
    const first = this.trailLen[i] === 0;
    const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
    let tx = tan[i3], ty = tan[i3 + 1], tz = tan[i3 + 2];
    let ux = tx, uy = ty, uz = tz;
    if (sp > 1e-4) { ux = vx / sp; uy = vy / sp; uz = vz / sp; }
    else if (first) { ux = 0; uy = 1; uz = 0; }
    let nx, ny, nz, turn = 0;
    if (first) {
      let ax = -uz, ay = 0, az = ux, al = Math.sqrt(ax * ax + az * az);
      if (al < 1e-3) { ax = 0; ay = -uz; az = uy; al = Math.sqrt(ay * ay + az * az) || 1; }
      ax /= al; ay /= al; az /= al;
      const bx = uy * az - uz * ay, by = uz * ax - ux * az, bz = ux * ay - uy * ax;
      const cp = Math.cos(this.phases[i]), sq = Math.sin(this.phases[i]);
      nx = ax * cp + bx * sq; ny = ay * cp + by * sq; nz = az * cp + bz * sq;
    } else {
      turn = Math.acos(Math.max(-1, Math.min(1, ux * tx + uy * ty + uz * tz)));
      nx = nor[i3]; ny = nor[i3 + 1]; nz = nor[i3 + 2];
    }
    tx = ux; ty = uy; tz = uz;
    const d = nx * tx + ny * ty + nz * tz;
    nx -= d * tx; ny -= d * ty; nz -= d * tz;
    let nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nl < 1e-4) { nx = -tz; ny = 0; nz = tx; nl = Math.sqrt(nx * nx + nz * nz); if (nl < 1e-4) { nx = 0; ny = -tz; nz = ty; nl = Math.sqrt(ny * ny + nz * nz) || 1; } }
    nx /= nl; ny /= nl; nz /= nl;
    let sx = ty * nz - tz * ny, sy = tz * nx - tx * nz, sz = tx * ny - ty * nx;   // side = t x n
    const a = Math.min(turn, 1.0) * R.twist + Math.sin(this.phases[i]) * R.roll * gap;
    if (a !== 0) {
      const ca = Math.cos(a), sa = Math.sin(a);
      const rx = nx * ca + sx * sa, ry = ny * ca + sy * sa, rz = nz * ca + sz * sa;
      sx = sx * ca - nx * sa; sy = sy * ca - ny * sa; sz = sz * ca - nz * sa;
      nx = rx; ny = ry; nz = rz;
    }
    tan[i3] = tx; tan[i3 + 1] = ty; tan[i3 + 2] = tz;
    nor[i3] = nx; nor[i3 + 1] = ny; nor[i3 + 2] = nz;
    const share = first ? 0 : (0.3 + 0.7 * Math.min(1, sp / R.speedRef)) * (0.6 + 0.4 * this.sizeMul[i] / 1.8);
    const sx8 = Math.round(sx * 127), sy8 = Math.round(sy * 127), sz8 = Math.round(sz * 127), w8 = Math.round(Math.min(1, share) * 127);
    const nx8 = Math.round(nx * 127), ny8 = Math.round(ny * 127), nz8 = Math.round(nz * 127);
    const cr8 = Math.round(Math.min(1, Math.max(0, cr)) * 255), cg8 = Math.round(Math.min(1, Math.max(0, cg)) * 255), cb8 = Math.round(Math.min(1, Math.max(0, cb)) * 255), ba8 = Math.round(Math.min(1, Math.max(0, bright)) * 255);
    const pos = this.rbPositions, side = this.rbSides, nrm = this.rbNormals, col = this.rbColors, birth = this.rbBirth;
    const v = (this.rbSlot * this.maxCount + i) * 2;
    for (let e = 0; e < 2; e++) {
      const u = v + e, u3 = u * 3, u4 = u * 4;
      pos[u3] = px; pos[u3 + 1] = py; pos[u3 + 2] = pz;
      side[u4] = sx8; side[u4 + 1] = sy8; side[u4 + 2] = sz8; side[u4 + 3] = w8;
      nrm[u4] = nx8; nrm[u4 + 1] = ny8; nrm[u4 + 2] = nz8; nrm[u4 + 3] = 0;
      col[u4] = cr8; col[u4 + 1] = cg8; col[u4 + 2] = cb8; col[u4 + 3] = ba8;
      birth[u] = this.t;
    }
    this.rbHead[i] = this.rbSlot;
  }

  // A strand's newest point is blanked when its particle sleeps, so no quad
  // can run from a landed strand to the next life's launch point. The rest
  // of the strand stays and fades by age. One small upload range.
  _capRibbon(i) {
    const v = (this.rbHead[i] * this.maxCount + i) * 2;
    this.rbBirth[v] = this.rbBirth[v + 1] = RIBBON_NONE;
    this.rbBirthAttr.addUpdateRange(v, 2);
  }

  // Per frame under a ribbon look: rebuild the index if the count changed,
  // upload this frame's slot block (when one was written) and the caps, or
  // the whole birth buffer after a wipe, slide the draw window over the
  // last W blocks, feed the clock.
  _ribbonFrame() {
    if (this._rbIndexCount !== this.count) this._rebuildRibbonIndex();
    const n = this.maxCount, c = this.count, P = RIBBON_POINTS;
    if (this._trailWrote) {
      const v = this.rbSlot * n * 2, cnt = c * 2;
      const up = (attr, size) => { attr.clearUpdateRanges(); attr.addUpdateRange(v * size, cnt * size); attr.needsUpdate = true; };
      up(this.rbPosAttr, 3); up(this.rbSideAttr, 4); up(this.rbNormAttr, 4); up(this.rbColAttr, 4);
      this.rbBirthAttr.addUpdateRange(v, cnt);           // the caps added this frame stay in the list
    }
    if (this._rbWipe) { this.rbBirthAttr.clearUpdateRanges(); this.rbBirthAttr.needsUpdate = true; this._rbWipe = false; }   // no ranges: the whole buffer
    else if (this.rbBirthAttr.updateRanges.length) this.rbBirthAttr.needsUpdate = true;
    const W = Math.min(P - 1, Math.ceil(this.ribbonMat.uniforms.uSeconds.value * 60) + 1);   // blocks in the window
    const B = c * 6;                                                                            // indices per block
    const first = (this.rbSlot - W + 1 + P) % P;        // oldest block drawn; the doubled index keeps the run contiguous
    this.ribbonGeo.setDrawRange(first * B, W * B);
    this.ribbonMat.uniforms.uNow.value = this.t;
  }

  // Shard buffers, built once on the first look whose extras name 'shards'.
  _ensureShards() {
    if (this.shardGeo) return;
    const V = SHARD_MAX * 6;
    this.shardPositions = new Float32Array(V * 3);
    this.shardDirs = new Float32Array(V * 3);
    this.shardSides = new Float32Array(V * 3);
    this.shardCorners = new Float32Array(V * 2);
    this.shardBirth = new Float32Array(V).fill(-1000);
    this.shardSeeds = new Float32Array(V);
    for (let s = 0; s < SHARD_MAX; s++) for (let e = 0; e < 6; e++) { const u2 = (s * 6 + e) * 2; this.shardCorners[u2] = SHARD_CORNERS[e * 2]; this.shardCorners[u2 + 1] = SHARD_CORNERS[e * 2 + 1]; }
    const g = this.shardGeo = new THREE.BufferGeometry();
    this.shardPosAttr = new THREE.BufferAttribute(this.shardPositions, 3);
    this.shardDirAttr = new THREE.BufferAttribute(this.shardDirs, 3);
    this.shardSideAttr = new THREE.BufferAttribute(this.shardSides, 3);
    this.shardBirthAttr = new THREE.BufferAttribute(this.shardBirth, 1);
    this.shardSeedAttr = new THREE.BufferAttribute(this.shardSeeds, 1);
    g.setAttribute('position', this.shardPosAttr);
    g.setAttribute('aDir', this.shardDirAttr);
    g.setAttribute('aSide', this.shardSideAttr);
    g.setAttribute('aCorner', new THREE.BufferAttribute(this.shardCorners, 2));
    g.setAttribute('aBirth', this.shardBirthAttr);
    g.setAttribute('aSeed', this.shardSeedAttr);
    this.shardMat = new THREE.ShaderMaterial({
      uniforms: {
        uNow: { value: 0 }, uLife: { value: LOOK_DEFAULTS.shards.life }, uSpeed: { value: LOOK_DEFAULTS.shards.speed }, uLength: { value: LOOK_DEFAULTS.shards.length }, uWidth: { value: LOOK_DEFAULTS.shards.width }, uOpacity: { value: LOOK_DEFAULTS.shards.opacity }, uFlat: { value: 0 },
        uColorA: { value: new THREE.Color(0x6699ff) }, uColorB: { value: new THREE.Color(0x2244aa) },
      },
      vertexShader: SHARD_VERTEX, fragmentShader: SHARD_FRAGMENT,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.shardMesh = new THREE.Mesh(g, this.shardMat);
    this.shardMesh.frustumCulled = false;
    this.scene.add(this.shardMesh);
    this.shardHead = 0;      // next pool slot
    this.shardCount = 0;     // shards thrown so far (tests)
  }

  // On a hit, every source throws shards from random points on its surface,
  // more for a harder kick, into the pool's next slots. Runs only under a
  // look whose extras name 'shards', so the other looks draw no extra RNG.
  _throwShards() {
    const S = this._shards;
    const per = Math.max(1, Math.round(S.perHit * (0.5 + 0.5 * this._burstKick)));
    const pos = this.shardPositions, dir = this.shardDirs, sid = this.shardSides, birth = this.shardBirth, seed = this.shardSeeds;
    for (const c of this._emitters) {
      const r = c.radius * Math.max(c.scaleT, 0.05);
      for (let k = 0; k < per; k++) {
        const d = this._randomDir(); const dx = d[0], dy = d[1], dz = d[2];
        const l = this._randomLean();
        let sx = dy * l[2] - dz * l[1], sy = dz * l[0] - dx * l[2], sz = dx * l[1] - dy * l[0];
        let sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
        if (sl < 1e-3) { sx = -dz; sy = 0; sz = dx; sl = Math.sqrt(sx * sx + sz * sz) || 1; }
        sx /= sl; sy /= sl; sz /= sl;
        const sd = Math.random();
        const ox = c.position.x + dx * r, oy = c.position.y + dy * r, oz = c.position.z + dz * r;
        const base = this.shardHead * 6;
        for (let e = 0; e < 6; e++) {
          const u = base + e, u3 = u * 3;
          pos[u3] = ox; pos[u3 + 1] = oy; pos[u3 + 2] = oz;
          dir[u3] = dx; dir[u3 + 1] = dy; dir[u3 + 2] = dz;
          sid[u3] = sx; sid[u3 + 1] = sy; sid[u3 + 2] = sz;
          birth[u] = this.t; seed[u] = sd;
        }
        this.shardHead = (this.shardHead + 1) % SHARD_MAX;
        this.shardCount++;
      }
    }
    this.shardPosAttr.needsUpdate = true; this.shardDirAttr.needsUpdate = true; this.shardSideAttr.needsUpdate = true;
    this.shardBirthAttr.needsUpdate = true; this.shardSeedAttr.needsUpdate = true;   // the whole pool (~130 KB), on hit frames only
  }
  // Sign of a particle's charge under the current look: bass listeners
  // positive and treble negative, random, or none.
  _chargeSignFor(i) {
    const rule = this.look.sim.charge;
    if (rule === 'frequency') return this.listenHz[i] < 600 ? 1 : -1;
    if (rule === 'random') return Math.random() < 0.5 ? 1 : -1;
    return 0;
  }

  // Spatial hash of the active particles, cell size cell: the separation
  // force walks it (built before the move at sepRadius) and so do the
  // Starburst links (rebuilt after the move at the link radius).
  _cellHash(x, y, z) {
    return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & 4095;
  }

  _buildGrid(cell = PARTICLE_TUNING.sepRadius) {
    const inv = 1 / cell;
    this._gridHeads.fill(-1);
    for (let i = 0; i < this.count; i++) {
      if (!this.active[i]) continue;
      const i3 = i * 3;
      const c = this._cellHash(Math.floor(this.positions[i3] * inv), Math.floor(this.positions[i3 + 1] * inv), Math.floor(this.positions[i3 + 2] * inv));
      this._gridNext[i] = this._gridHeads[c];
      this._gridHeads[c] = i;
    }
  }

  // Short-range push away from the nearest neighbours, scaled by both
  // charges' magnitudes. Writes an acceleration into this._sep.
  _separationForce(i, px, py, pz, k) {
    const T = PARTICLE_TUNING;
    const h = T.sepRadius, inv = 1 / h, h2 = h * h;
    const cx = Math.floor(px * inv), cy = Math.floor(py * inv), cz = Math.floor(pz * inv);
    const qi = Math.abs(this.charge[i]) || 0.3;
    let fx = 0, fy = 0, fz = 0, found = 0;
    for (let c = 0; c < 81 && found < T.sepMax; c += 3) {
      let j = this._gridHeads[this._cellHash(cx + SEP_CELL_ORDER[c], cy + SEP_CELL_ORDER[c + 1], cz + SEP_CELL_ORDER[c + 2])];
      while (j !== -1 && found < T.sepMax) {
        if (j !== i) {
          const j3 = j * 3;
          const dx = px - this.positions[j3], dy = py - this.positions[j3 + 1], dz = pz - this.positions[j3 + 2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < h2 && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const f = k * qi * (Math.abs(this.charge[j]) || 0.3) / (d2 + 0.05);
            fx += dx / d * f; fy += dy / d * f; fz += dz / d * f;
            found++;
          }
        }
        j = this._gridNext[j];
      }
    }
    this._sep[0] = fx; this._sep[1] = fy; this._sep[2] = fz;
    return this._sep;
  }

  // Sources for this frame. Positive cores emit, weighted by charge. If none
  // is alive (the sinks outlived the sources) the remaining cores emit instead,
  // flowing against the field, so a lone sink still has streams. Those lines
  // escape to the boundary and recycle there.
  _buildEmitters(alive) {
    this._emitters.length = 0;
    this._emitWeights.length = 0;
    this._emitTotal = 0;

    let anyPositive = false;
    for (const c of alive) {
      if (c.effectiveCharge > 0.01) { anyPositive = true; break; }
    }
    for (const c of alive) {
      const w = anyPositive ? c.effectiveCharge : Math.abs(c.effectiveCharge);
      if (w <= 0.01) continue;
      this._emitTotal += w;
      this._emitters.push(c);
      this._emitWeights.push(this._emitTotal);
    }
  }

  _pickEmitter() {
    const r = Math.random() * this._emitTotal;
    for (let k = 0; k < this._emitters.length; k++) {
      if (r <= this._emitWeights[k]) return this._emitters[k];
    }
    return this._emitters[this._emitters.length - 1];
  }

  // Uniform random unit vector into this._dir.
  _randomDir() {
    const theta = Math.random() * Math.PI * 2;
    const z = 2 * Math.random() - 1;
    const s = Math.sqrt(1 - z * z);
    this._dir[0] = s * Math.cos(theta);
    this._dir[1] = s * Math.sin(theta);
    this._dir[2] = z;
    return this._dir;
  }

  // Uniform random unit vector into this._lean (the azimuth hint for a launch).
  _randomLean() {
    const theta = Math.random() * Math.PI * 2;
    const z = 2 * Math.random() - 1;
    const s = Math.sqrt(1 - z * z);
    this._lean[0] = s * Math.cos(theta);
    this._lean[1] = s * Math.sin(theta);
    this._lean[2] = z;
    return this._lean;
  }

  // Launch energy: the particle's own listener at this instant, scaled by
  // loudness and multiplied by the strength of the kick that threw it. Hot
  // bins escape, quiet bins bounce and fall back; a hard kick pushes the
  // whole spread outward, a quiet passage pulls it back, and the noise
  // keeps both populations present. Energy is also the particle's cruising
  // speed for the rest of its trip.
  _launchEnergy(i, audio, kick) {
    const T = PARTICLE_TUNING;
    const amp = audio.getFreqAt(this.listenHz[i]);
    const loud = audio.getVolume();
    const gain = T.energyQuiet + (T.energyLoud - T.energyQuiet) * loud;
    const e = amp * gain * (T.kickFloor + T.kickGain * kick) + (Math.random() - 0.5) * T.energyNoise;
    // The look's energy dial caps the whole range (clamp first, then scale),
    // so 0.6 means no launch faster than 60% of the way to launchMax.
    return (e < 0 ? 0 : e > 1 ? 1 : e) * this.look.sim.energy;
  }

  // Release a dormant particle off a core's surface at direction n (unit),
  // carried along with the core. Speed comes from energy. The launch is
  // lofted: most leave near-vertical, some go up at a slant like a missile,
  // with the azimuth taken from the lean hint l (a flare's jet direction, or
  // random for the trickle).
  _emit(i, core, nx, ny, nz, energy, lx, ly, lz) {
    const T = PARTICLE_TUNING;
    const i3 = i * 3;
    const r = core.radius * Math.max(core.scaleT, 0.05) * 1.02;

    this.positions[i3]     = core.position.x + nx * r;
    this.positions[i3 + 1] = core.position.y + ny * r;
    this.positions[i3 + 2] = core.position.z + nz * r;

    // Tangent in the surface plane from the lean hint
    const ln = lx * nx + ly * ny + lz * nz;
    let tx = lx - ln * nx, ty = ly - ln * ny, tz = lz - ln * nz;
    let tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tl < 1e-3) {
      tx = -nz; ty = 0; tz = nx;
      tl = Math.sqrt(tx * tx + tz * tz);
      if (tl < 1e-3) { tx = 0; ty = -nz; tz = ny; tl = Math.sqrt(ty * ty + tz * tz) || 1; }
    }
    tx /= tl; ty /= tl; tz /= tl;

    const elevDeg = T.launchElevMax - (T.launchElevMax - T.launchElevMin) * Math.pow(Math.random(), T.launchElevBias);
    const elev = elevDeg * Math.PI / 180;
    const se = Math.sin(elev), ce = Math.cos(elev);
    const dx = nx * se + tx * ce, dy = ny * se + ty * ce, dz = nz * se + tz * ce;

    const v0 = T.launchMin + energy * (T.launchMax - T.launchMin);
    const sp = v0 * T.launchSpread * 2;
    this.velocities[i3]     = core.velocity.x + dx * v0 + (Math.random() - 0.5) * sp;
    this.velocities[i3 + 1] = core.velocity.y + dy * v0 + (Math.random() - 0.5) * sp;
    this.velocities[i3 + 2] = core.velocity.z + dz * v0 + (Math.random() - 0.5) * sp;

    if (!this.active[i]) this.activeCount++;
    this.active[i] = 1;
    this.flowDir[i] = core.effectiveCharge >= 0 ? 1 : -1;
    this.escaped[i] = 0;
    this.bounced[i] = 0;
    this.energy[i] = energy;
    this.sourceCore[i] = core;
    this.ages[i] = 0;
    this.kicks[i] = 0;
    this.brightness[i] = 0;
    this.trailLen[i] = 0;
    this.chargeSign[i] = this._chargeSignFor(i);
  }

  // A landing on `core`: a ripple under the ring looks, a lingering spot in
  // the particle's colour (last frame's point colour, so a loud comet leaves
  // a bright dot and a quiet one a dim dot) under the spot looks.
  _land(core, i, x, y, z, time) {
    if (!this._spotEvents) { core.addSurfaceEvent(x, y, z, 1, time); return; }
    const i3 = i * 3;
    core.addSurfaceEvent(x, y, z, 2, time, this.pointColors[i3], this.pointColors[i3 + 1], this.pointColors[i3 + 2]);
  }

  _sleep(i) {
    if (this.active[i]) this.activeCount--;
    this.active[i] = 0;
    this.brightness[i] = 0;
    if (this._ribbons && this.trailLen[i] > 0) this._capRibbon(i);   // the strand's newest point is blanked, the rest fades by age
    this.pointSizes[i] = 0;
    // Under a draining look the strand stays in the ring and fades out by
    // age from the root; otherwise it goes with the particle.
    if (!this._drain) this.trailLen[i] = 0;
  }

  // One-time outward impulse for everything a dying core had gathered in.
  // Kicked particles steer back onto the field slowly so the puff reads.
  _burst(core) {
    const T = PARTICLE_TUNING;
    const reach = core.radius * T.burstRadii + 0.5;
    const reachSq = reach * reach;
    const spread = 0.35;

    for (let i = 0; i < this.count; i++) {
      if (!this.active[i]) continue;
      const i3 = i * 3;
      const dx = this.positions[i3]     - core.position.x;
      const dy = this.positions[i3 + 1] - core.position.y;
      const dz = this.positions[i3 + 2] - core.position.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > reachSq) continue;

      const d = Math.sqrt(d2) + 0.001;
      let ox = dx / d + (Math.random() - 0.5) * spread;
      let oy = dy / d + (Math.random() - 0.5) * spread;
      let oz = dz / d + (Math.random() - 0.5) * spread;
      const ol = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
      const s = T.burstSpeed * (0.7 + Math.random() * 0.6) / ol;
      this.velocities[i3]     = ox * s;
      this.velocities[i3 + 1] = oy * s;
      this.velocities[i3 + 2] = oz * s;
      this.kicks[i] = T.kickDecay;
      this.escaped[i] = 1;
    }
  }

  // On a bass hit every source grows a few flare spots; the burst erupts from
  // those, and each spot flashes a ring on the surface.
  _flare(audio, time) {
    const T = PARTICLE_TUNING;
    const bassLevel = audio.getBass();
    const loud = audio.getVolume();
    this.burstBudget += this.count * T.hitBurst * (T.hitBurstMin + (1 - T.hitBurstMin) * bassLevel) * (0.5 + 0.5 * loud);
    this._burstKick = bassLevel;
    this._spotsByCore.clear();
    if (this.look.sim.emission === 'even') return;   // the burst erupts from the whole surface: no spots, no flare rings
    for (const c of this._emitters) {
      const n = T.spotsMin + Math.floor(Math.random() * (T.spotsMax - T.spotsMin + 1));
      const r = c.radius * Math.max(c.scaleT, 0.05);
      const spots = [];
      for (let k = 0; k < n; k++) {
        const d = this._randomDir();
        const l = this._randomLean();
        spots.push(d[0], d[1], d[2], l[0], l[1], l[2]);
        if (!this._spotEvents) c.addSurfaceEvent(c.position.x + d[0] * r, c.position.y + d[1] * r, c.position.z + d[2] * r, 0, time);
      }
      this._spotsByCore.set(c, spots);
    }
  }

  // Direction for a burst particle: a spot of this core, scattered, with the
  // spot's jet direction (scattered too) left in this._lean.
  _spotDir(core) {
    const T = PARTICLE_TUNING;
    const spots = this._spotsByCore.get(core);
    const d = this._dir, ln = this._lean;
    if (!spots || spots.length === 0) { this._randomLean(); return this._randomDir(); }
    const k = Math.floor(Math.random() * (spots.length / 6)) * 6;
    d[0] = spots[k]     + (Math.random() - 0.5) * 2 * T.spotSpread;
    d[1] = spots[k + 1] + (Math.random() - 0.5) * 2 * T.spotSpread;
    d[2] = spots[k + 2] + (Math.random() - 0.5) * 2 * T.spotSpread;
    const l = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) || 1;
    d[0] /= l; d[1] /= l; d[2] /= l;
    ln[0] = spots[k + 3] + (Math.random() - 0.5) * 2 * T.spotLean;
    ln[1] = spots[k + 4] + (Math.random() - 0.5) * 2 * T.spotLean;
    ln[2] = spots[k + 5] + (Math.random() - 0.5) * 2 * T.spotLean;
    return d;
  }

  // ctx: { barycenter: Vector3, extent: number, died: Core[], time: number }
  update(audio, dt, ctx) {
    const T = PARTICLE_TUNING;
    const volume = audio.getVolume();
    const treble = audio.getTreble();
    const time = ctx.time;
    this.t += dt;

    const alive = [];
    for (const c of this.cores) if (c.alive) alive.push(c);
    this._buildEmitters(alive);
    const canEmit = this._emitTotal > 0.0001;

    for (const core of ctx.died) this._burst(core);

    const bx = ctx.barycenter.x, by = ctx.barycenter.y, bz = ctx.barycenter.z;
    const boundary = Math.max(T.boundaryMin, ctx.extent * T.boundaryMult);
    const boundarySq = boundary * boundary;

    // Trickle budget: fractional particles accumulate across frames, capped
    // so a stalled tab can't dump the whole pool in one frame when it resumes.
    const sim = this.look.sim;
    const rate = this.count * (T.trickleBase + volume * T.trickleVolume) * sim.trickle;
    this.emitBudget = Math.min(this.emitBudget + rate * dt, this.count * T.trickleCap);

    // Burst budget: every bass onset, however soft (the burst size and the
    // launch energy carry the strength).
    if (audio.getOnset('bass') && canEmit) { this._flare(audio, time); if (this._shards) this._throwShards(); }
    if (!canEmit) this.burstBudget = 0;
    const burstCap = this.count * T.burstCap;
    let burstThisFrame = 0;

    // How many may be in flight follows loudness: quiet means a sparse
    // scene, loud means the whole pool. Nothing is killed early; emission
    // just waits for natural recycling to bring the count under the cap.
    const poolQuiet = sim.poolQuiet ?? T.poolQuiet;
    const activeCap = this.count * (poolQuiet + (1 - poolQuiet) * volume);

    const speed = (T.speedBase + volume * T.speedVolume) * sim.speed;
    const steerBase = Math.min(1, dt * T.steer);
    const shimmerT = this.t * 6;

    // Charge forces, only when the look asks for them. Strength follows
    // loudness ("audio data can then influence the particles' charge and
    // strength of the forces applied").
    const useCharge = sim.charge !== 'none';
    const loudGain = 0.5 + 0.5 * volume;
    const coulomb = useCharge ? sim.coulomb * loudGain : 0;
    const separation = useCharge ? sim.separation * loudGain : 0;
    if (separation > 0) this._buildGrid();

    // Trail ring: advance the shared slot at most 60 times a second, so a
    // 120 Hz display gets the same trail resolution, memory and segment count
    // as a 60 Hz one.
    const trailGap = Math.min(0.1, this.t - this._lastTrailWrite);   // seconds since the last ring write, for the ribbon roll
    const writeTrail = this.trailStyle !== 'none' && this.t - this._lastTrailWrite >= 1 / 60 - 1e-4;
    if (writeTrail) { this.trailSlot = (this.trailSlot + 1) % TRAIL_POINTS; this._lastTrailWrite = this.t; }
    this._trailWrote = writeTrail;
    const slotBase = this.trailSlot * this.maxCount;
    // The ribbon ring advances with the same cadence; its birth upload ranges (caps, the slot block) are gathered over this frame.
    if (this._ribbons) { if (writeTrail) this.rbSlot = (this.rbSlot + 1) % RIBBON_POINTS; this.rbBirthAttr.clearUpdateRanges(); }

    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;

      if (!this.active[i]) {
        if (this.activeCount >= activeCap) {
          this.pointSizes[i] = 0;
          continue;
        }
        // A strand still draining keeps its slot until it has faded.
        if (this._drain && this.trailLen[i] > 1 && this.t - this.trailBirth[this.trailHead[i] * this.maxCount + i] < this.trailSeconds) {
          this.pointSizes[i] = 0;
          continue;
        }
        if (canEmit && this.burstBudget >= 1 && burstThisFrame < burstCap) {
          const core = this._pickEmitter();
          const d = this._spotDir(core);
          const l = this._lean;
          this._emit(i, core, d[0], d[1], d[2], this._launchEnergy(i, audio, this._burstKick), l[0], l[1], l[2]);
          this.burstBudget -= 1;
          burstThisFrame++;
        } else if (canEmit && this.emitBudget >= 1) {
          const core = this._pickEmitter();
          const d = this._randomDir();
          const l = this._randomLean();
          this._emit(i, core, d[0], d[1], d[2], this._launchEnergy(i, audio, audio.getBass() * 0.6), l[0], l[1], l[2]);
          this.emitBudget -= 1;
        } else {
          this.pointSizes[i] = 0;
          continue;
        }
      }

      let px = this.positions[i3], py = this.positions[i3 + 1], pz = this.positions[i3 + 2];
      let vx = this.velocities[i3], vy = this.velocities[i3 + 1], vz = this.velocities[i3 + 2];
      const age = this.ages[i];
      const src = this.escaped[i] ? null : this.sourceCore[i];
      const freqAmp = audio.getFreqAt(this.listenHz[i]);
      const q = useCharge ? this.chargeSign[i] * (0.3 + 0.7 * freqAmp) * sim.chargeGain : 0;
      this.charge[i] = q;

      // Field at p, gravity from every core, the collapse pull, and surface
      // contact. The particle's own source is handled separately while it's
      // ballistic (its gravity, bounce and escape test live there).
      let fx = 0, fy = 0, fz = 0;
      let gx = 0, gy = 0, gz = 0;
      let absorbedBy = null;
      for (const core of alive) {
        if (core === src) continue;
        const dx = px - core.position.x;
        const dy = py - core.position.y;
        const dz = pz - core.position.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const ct = core.collapseT;

        // Landing on a surface ends the trip. A core past the early part of
        // its collapse doesn't absorb: it hoards particles at its center so
        // there's something to release when it dies.
        const surface = core.radius * Math.max(core.scaleT, 0.05);
        if (d2 < surface * surface && age > 0.05 && ct < 0.3) { absorbedBy = core; break; }

        const d = Math.sqrt(d2 + 0.05);
        const qf = core.effectiveCharge / (d * d * d);
        fx += qf * dx;
        fy += qf * dy;
        fz += qf * dz;

        // Gravity, same scaling as the launch phase: escape speed off any
        // surface is sqrt(2 * srcGravity). Momentum carries through flybys.
        let a = T.srcGravity * surface / Math.max(d2, surface * surface * 0.25);
        if (ct > 0) {
          const reach = core.radius * T.pullRadii + 1;
          if (d < reach) a += (1 - d / reach) * ct * ct * T.pullStrength;
        }
        // Coulomb: like signs repel, so a positive particle is pushed off a
        // positive core and drawn to a negative one. Negative of the gravity
        // direction when the product is positive.
        if (coulomb !== 0) a -= coulomb * q * core.effectiveCharge / Math.max(d2, surface * surface * 0.25);
        gx -= dx / d * a;
        gy -= dy / d * a;
        gz -= dz / d * a;
      }
      if (separation > 0) {
        const f = this._separationForce(i, px, py, pz, separation);
        gx += f[0]; gy += f[1]; gz += f[2];
      }
      if (absorbedBy) {
        this._land(absorbedBy, i, px, py, pz, time);
        this._sleep(i);
        continue;
      }

      // Ballistic phase: the source's gravity, a bounce, a landing, or escape.
      // Escape is decided by energy, not distance: a particle stays on its
      // arc until its speed beats escape speed at its current distance, so
      // sub-escape launches rise as far as their speed allows and fall back,
      // while unbound ones hand over to the field once clear of the surface.
      let onField = 1;
      if (src) {
        if (!src.alive) {
          this.escaped[i] = 1;
        } else {
          const dx = px - src.position.x;
          const dy = py - src.position.y;
          const dz = pz - src.position.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          const d = Math.sqrt(d2) + 1e-6;
          const r = src.radius * Math.max(src.scaleT, 0.05);
          const K = T.srcGravity * r;
          const rvx = vx - src.velocity.x, rvy = vy - src.velocity.y, rvz = vz - src.velocity.z;
          const unbound = 0.5 * (rvx * rvx + rvy * rvy + rvz * rvz) > K / d;
          if (unbound && d > r * T.escapeRadii) {
            this.escaped[i] = 1;
          } else {
            onField = 0;
            const a = K / Math.max(d2, r * r * 0.25);
            gx -= dx / d * a;
            gy -= dy / d * a;
            gz -= dz / d * a;

            if (d < r && age > 0.03) {
              const nx = dx / d, ny = dy / d, nz = dz / d;
              // Impact speed relative to the moving surface
              const vr = rvx * nx + rvy * ny + rvz * nz;
              if (!this.bounced[i] && -vr > T.bounceMin) {
                const k = (1 + T.restitution) * vr;
                vx -= k * nx;
                vy -= k * ny;
                vz -= k * nz;
                px = src.position.x + nx * r * 1.01;
                py = src.position.y + ny * r * 1.01;
                pz = src.position.z + nz * r * 1.01;
                this.bounced[i] = 1;
                if (!this._spotEvents) src.addSurfaceEvent(px, py, pz, 1, time);
              } else {
                this._land(src, i, px, py, pz, time);
                this._sleep(i);
                continue;
              }
            }
          }
        }
      }

      // Flight along the field: unit flow direction along (or against) the
      // field, faster where the field is strong so lines rush in and out of
      // the poles. Launch energy is the cruising speed, so a particle thrown
      // by a hard kick stays fast for its whole trip and a soft one drifts;
      // its live bin adds a little on top.
      const fmag = Math.sqrt(fx * fx + fy * fy + fz * fz);
      let tx = 0, ty = 0, tz = 0;
      if (fmag > 1e-6) {
        const inv = this.flowDir[i] / fmag;
        const ux = fx * inv, uy = fy * inv, uz = fz * inv;
        const s = speed * (0.45 + 1.0 * this.energy[i]) * (0.8 + 0.4 * freqAmp) * (1 + Math.min(1, fmag / T.poleFieldRef) * T.poleBoost);

        // Shimmer: a small wobble perpendicular to the line, sized by this
        // particle's FFT bin and the treble so highs make the arcs sparkle.
        let qx = uz, qy = 0, qz = -ux;
        let ql = Math.sqrt(qx * qx + qz * qz);
        if (ql < 0.1) { qx = 0; qy = uz; qz = -uy; ql = Math.sqrt(qy * qy + qz * qz) || 1; }
        const sh = T.shimmer * freqAmp * (0.3 + treble) * Math.sin(shimmerT + this.phases[i]) / ql;

        tx += ux * s + qx * sh;
        ty += uy * s + qy * sh;
        tz += uz * s + qz * sh;
      } else if (!src) {
        // No field and no source to fall back to: nothing to follow.
        this._sleep(i);
        continue;
      }

      // Steering is off while ballistic, and only a gentle bend once the
      // particle has escaped: gravity and its own momentum do the rest.
      let steer = steerBase * onField;
      if (this.kicks[i] > 0) {
        steer *= 0.15;
        this.kicks[i] -= dt;
      }
      vx += gx * dt + (tx - vx) * steer;
      vy += gy * dt + (ty - vy) * steer;
      vz += gz * dt + (tz - vz) * steer;

      px += vx * dt;
      py += vy * dt;
      pz += vz * dt;

      this.ages[i] = age + dt;
      const ex = px - bx, ey = py - by, ez = pz - bz;
      if (ex * ex + ey * ey + ez * ez > boundarySq || this.ages[i] > T.maxAge) {
        this._sleep(i);
        continue;
      }

      this.positions[i3] = px; this.positions[i3 + 1] = py; this.positions[i3 + 2] = pz;
      this.velocities[i3] = vx; this.velocities[i3 + 1] = vy; this.velocities[i3 + 2] = vz;

      // Brightness: fade in after emission, lift with the particle's own
      // bin, and sit a little lower overall when the music is quiet.
      const bright = Math.min(1, this.ages[i] / T.fadeIn) * (0.55 + freqAmp * 0.45) * (0.6 + volume * 0.4);
      this.brightness[i] = bright;

      this.pointPositions[i3]     = px;
      this.pointPositions[i3 + 1] = py;
      this.pointPositions[i3 + 2] = pz;

      let cr, cg, cb;
      if (this._flatColor) {
        // Flat (Paper): the particle's own palette colour, as is
        const fc = this.ribbonColor;
        cr = fc[i3]; cg = fc[i3 + 1]; cb = fc[i3 + 2];
      } else if (this.hueScatter > 0) {
        const hi = this.hueInner, ho = this.hueOuter;
        cr = ho[i3]     + (hi[i3]     - ho[i3])     * freqAmp;
        cg = ho[i3 + 1] + (hi[i3 + 1] - ho[i3 + 1]) * freqAmp;
        cb = ho[i3 + 2] + (hi[i3 + 2] - ho[i3 + 2]) * freqAmp;
      } else {
        const c = this._tmpColorParticle.lerpColors(this.outerColor, this.innerColor, freqAmp);
        cr = c.r; cg = c.g; cb = c.b;
      }
      const gain = this._flatColor ? Math.min(1, this.ages[i] / T.fadeIn) : bright;   // flat: the colour as is once faded in; gain === bright otherwise
      this.pointColors[i3]     = cr * gain;
      this.pointColors[i3 + 1] = cg * gain;
      this.pointColors[i3 + 2] = cb * gain;

      this.pointSizes[i] = T.pointSize * this.spriteScale * (0.6 + freqAmp * 0.8) * this.sizeMul[i] * (0.8 + 0.4 * this.energy[i]) * (0.5 + 0.5 * bright);

      // Trail point for this frame: the line ring, or the ribbon ring under
      // the ribbon style (trailLen counts for both)
      if (writeTrail) {
        if (this._ribbons) {
          this._writeRibbonPoint(i, px, py, pz, vx, vy, vz, cr, cg, cb, gain, trailGap);
        } else {
          const v = slotBase + i;
          const v3 = v * 3;
          this.trailPositions[v3] = px; this.trailPositions[v3 + 1] = py; this.trailPositions[v3 + 2] = pz;
          this.trailColors[v3] = cr * bright; this.trailColors[v3 + 1] = cg * bright; this.trailColors[v3 + 2] = cb * bright;
          this.trailBirth[v] = this.t;
          this.trailHead[i] = this.trailSlot;
        }
        if (this.trailLen[i] < TRAIL_POINTS) this.trailLen[i]++;
      }
    }

    // Zero out unused points
    for (let i = this.count; i < this.maxCount; i++) {
      this.pointSizes[i] = 0;
    }

    this.pointGeo.attributes.position.needsUpdate = true;
    this.pointGeo.attributes.color.needsUpdate = true;
    this.pointGeo.attributes.size.needsUpdate = true;
    if (this._cometSprite) this.pointGeo.attributes.velocity.needsUpdate = true;
    this.pointGeo.setDrawRange(0, this.count);

    // Links read this frame's final positions, so the grid is rebuilt here
    // at the link radius (the separation grid, when a look has both, was
    // built before the move at sepRadius and is spent).
    if (this._links) { this._buildGrid(this._links.radius); this._buildLinks(); }

    if (this._ribbons) this._ribbonFrame();
    if (this._shards) this.shardMat.uniforms.uNow.value = this.t;
    this._buildTrailIndex();
  }

  // Segments for every particle's valid trail points, newest first, stopping
  // at the look's trail duration. The walk starts at the particle's own
  // newest point: the current slot while it flies, its last slot once it has
  // landed under a draining look (the strand then shortens from the root as
  // its points age out). Uploads only this frame's slot block of points and
  // the used part of the index.
  _buildTrailIndex() {
    const idx = this.trailIndex;
    let k = 0;
    if (this.trailStyle === 'line') {
      const n = this.maxCount, P = TRAIL_POINTS;
      for (let i = 0; i < this.count; i++) {
        const len = this.trailLen[i];
        if (len < 2) continue;
        let slot = this.trailHead[i];
        for (let j = 1; j < len; j++) {
          const prev = slot === 0 ? P - 1 : slot - 1;
          const vPrev = prev * n + i;
          if (this.t - this.trailBirth[vPrev] > this.trailSeconds) break;
          idx[k++] = slot * n + i;
          idx[k++] = vPrev;
          slot = prev;
        }
      }
      if (this._trailWrote) {
        const slotBase = this.trailSlot * n;
        this.trailPosAttr.clearUpdateRanges(); this.trailPosAttr.addUpdateRange(slotBase * 3, this.count * 3); this.trailPosAttr.needsUpdate = true;
        this.trailColAttr.clearUpdateRanges(); this.trailColAttr.addUpdateRange(slotBase * 3, this.count * 3); this.trailColAttr.needsUpdate = true;
        this.trailBirthAttr.clearUpdateRanges(); this.trailBirthAttr.addUpdateRange(slotBase, this.count); this.trailBirthAttr.needsUpdate = true;
      }
      this.trailIdxAttr.clearUpdateRanges(); this.trailIdxAttr.addUpdateRange(0, Math.max(1, k)); this.trailIdxAttr.needsUpdate = true;
    }
    this.trailGeo.setDrawRange(0, k);
    this.trailMat.uniforms.uNow.value = this.t;
  }

  // Starburst's web. For each star in flight, partners within the link
  // radius from its own grid cell and the 26 around it (nearest cells
  // first, like the separation walk), first found, until it carries
  // perParticle links counting both directions, or the frame's maxPairs is
  // spent. Grid chains run in decreasing index order, so the walk stops at
  // the first j <= i: every pair is visited once, from its lower index. Two
  // of the 27 cells can hash to one bucket, so a chain can be walked twice;
  // the star's own partner list catches the repeat. A pair is two vertices
  // in the fixed buffer, coloured like its ends and dimmed by distance
  // squared, so a link grows in as the pair closes instead of popping at
  // the radius. Uploads only the pairs written. Dormant particles never
  // enter the grid, so links join stars in flight only.
  _buildLinks() {
    const L = this._links, n = this.count, r = L.radius, r2 = r * r, inv = 1 / r;
    const pos = this.positions, col = this.pointColors, lp = this.linkPositions, lc = this.linkColors;
    const deg = this.linkDegree, mine = this.linkOf, S = LINK_MAX_DEGREE;
    const maxPairs = Math.min(L.maxPairs, LINK_MAX_PAIRS), per = Math.min(L.perParticle, S), op = L.opacity;
    deg.fill(0, 0, n);
    let k = 0;
    for (let i = 0; i < n && k < maxPairs; i++) {
      if (!this.active[i] || deg[i] >= per) continue;
      const i3 = i * 3, px = pos[i3], py = pos[i3 + 1], pz = pos[i3 + 2], iS = i * S;
      const cx = Math.floor(px * inv), cy = Math.floor(py * inv), cz = Math.floor(pz * inv);
      let found = 0;
      for (let c = 0; c < 81 && deg[i] < per && k < maxPairs; c += 3) {
        let j = this._gridHeads[this._cellHash(cx + SEP_CELL_ORDER[c], cy + SEP_CELL_ORDER[c + 1], cz + SEP_CELL_ORDER[c + 2])];
        while (j > i && deg[i] < per && k < maxPairs) {
          if (deg[j] < per) {
            const j3 = j * 3;
            const dx = px - pos[j3], dy = py - pos[j3 + 1], dz = pz - pos[j3 + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < r2) {
              let dup = false;
              for (let t = 0; t < found; t++) if (mine[iS + t] === j) { dup = true; break; }
              if (!dup) {
                mine[iS + found++] = j;
                const fade = (1 - d2 / r2) * op, k6 = k * 6;
                lp[k6] = px; lp[k6 + 1] = py; lp[k6 + 2] = pz;
                lp[k6 + 3] = pos[j3]; lp[k6 + 4] = pos[j3 + 1]; lp[k6 + 5] = pos[j3 + 2];
                lc[k6] = col[i3] * fade; lc[k6 + 1] = col[i3 + 1] * fade; lc[k6 + 2] = col[i3 + 2] * fade;
                lc[k6 + 3] = col[j3] * fade; lc[k6 + 4] = col[j3 + 1] * fade; lc[k6 + 5] = col[j3 + 2] * fade;
                k++; deg[i]++; deg[j]++;
              }
            }
          }
          j = this._gridNext[j];
        }
      }
    }
    this.linkPairs = k;
    const floats = Math.max(3, k * 6);
    this.linkPosAttr.clearUpdateRanges(); this.linkPosAttr.addUpdateRange(0, floats); this.linkPosAttr.needsUpdate = true;
    this.linkColAttr.clearUpdateRanges(); this.linkColAttr.addUpdateRange(0, floats); this.linkColAttr.needsUpdate = true;
    this.linkGeo.setDrawRange(0, k * 2);
  }
}

// ─── Field lines (Attractor extras: 'streamlines') ───────────────────────────

// The magnetosphere diagram: the field the particles steer along, drawn.
// Every alive body seeds perBody lines on a Fibonacci sphere just off its
// surface, each integrated AWAY from the body (along B off a positive core,
// against it off a negative one, so lines run source to sink like the
// particles) with midpoint steps of `step` world units, up to `steps` of
// them, stopping on any surface, past the particle boundary or where the
// field dies. The field is the particle loop's own sum of
// effectiveCharge * r / |r|^3 with its softening (the loop keeps its own
// inline sum; this pass has its own). Integrated every `every` frames (a
// body moves a few hundredths of a unit in that time) into one fixed buffer
// drawn through a draw range, uploading only the vertices written. Per
// vertex aInfo carries t along the line, whether it landed and a signed
// step count: the shader keeps a landed line lit to the surface, fades one
// that left the frame to nothing by its tip, dims the set when the music is
// quiet and sends pulses along every line from source to sink. No
// Math.random anywhere in it.
const STREAM_MAX_LINES = 256;   // 8 bodies x 32 seeds: a 5-planet lock plus bodies still collapsing
const STREAM_MAX_STEPS = 200;   // streamlines.steps is clamped to it
function fibonacciSphere(n) {
  const out = new Float32Array(n * 3), ga = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < n; k++) {
    const y = 1 - (k + 0.5) * 2 / n, r = Math.sqrt(1 - y * y), a = ga * k;
    out[k * 3] = Math.cos(a) * r; out[k * 3 + 1] = y; out[k * 3 + 2] = Math.sin(a) * r;
  }
  return out;
}

const STREAM_VERTEX = `
  attribute vec3 aInfo;    // x: 0 at the root on the body, 1 at the line's last vertex; y: 1 if the line ended on a body; z: signed step, for the pulses
  uniform float uOpacity;
  uniform float uVolume;
  uniform float uTime;
  uniform float uFlow;
  uniform vec3 uColorInner;
  uniform vec3 uColorOuter;
  varying vec3 vColor;
  void main() {
    float t = aInfo.x;
    float root  = 0.45 + 0.55 * (1.0 - t);                                  // brighter near its body
    float tip   = mix(1.0 - smoothstep(0.55, 1.0, t), 1.0, aInfo.y);        // landed: lit to the surface; left the frame: fades out
    float pulse = 0.75 + 0.25 * sin(aInfo.z * 0.5 - uTime * 6.0 * uFlow);   // ~1.4 units/s along the line, source to sink
    float a = root * tip * pulse * uOpacity * (0.6 + 0.4 * uVolume);
    vColor = mix(uColorInner, uColorOuter, t * 0.6) * a;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const STREAM_FRAGMENT = `
  varying vec3 vColor;
  void main() { gl_FragColor = vec4(vColor, 1.0); }   // additive, like the trails
`;

class FieldLines {
  constructor(scene, cores) {
    this.scene = scene;
    this.cores = cores;
    this.enabled = false;
    this.look = LOOK_DEFAULTS.streamlines;
    this.frame = 0;
    this.lines = 0;
    this.lineStart = new Int32Array(STREAM_MAX_LINES + 1);   // first vertex of each line, plus the end
    this.lineCore = new Array(STREAM_MAX_LINES).fill(null);
    const v = STREAM_MAX_LINES * STREAM_MAX_STEPS * 2;
    this.positions = new Float32Array(v * 3);
    this.info = new Float32Array(v * 3);
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.infoAttr = new THREE.BufferAttribute(this.info, 3);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('aInfo', this.infoAttr);
    this.geo.setDrawRange(0, 0);
    this.uniforms = {
      uOpacity: { value: LOOK_DEFAULTS.streamlines.opacity }, uVolume: { value: 0 }, uTime: { value: 0 },
      uFlow: { value: LOOK_DEFAULTS.streamlines.flow },
      uColorInner: { value: new THREE.Color(0x6699ff) }, uColorOuter: { value: new THREE.Color(0x2244aa) },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: STREAM_VERTEX, fragmentShader: STREAM_FRAGMENT, uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.LineSegments(this.geo, this.material);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;   // the bounding sphere would be computed once, from zeros
    scene.add(this.mesh);
    this.seeds = fibonacciSphere(LOOK_DEFAULTS.streamlines.perBody);
    this._alive = [];
  }

  applyLook(look, palette) {
    this.look = look.streamlines;
    this.enabled = look.extras.includes('streamlines');
    this.mesh.visible = this.enabled;
    if (!this.enabled) { this.geo.setDrawRange(0, 0); this.lines = 0; }
    const per = Math.max(1, Math.min(32, Math.floor(this.look.perBody)));
    if (this.seeds.length !== per * 3) this.seeds = fibonacciSphere(per);
    this.frame = 0;                                        // integrate on the next frame
    this.uniforms.uOpacity.value = this.look.opacity;
    this.uniforms.uFlow.value = this.look.flow;
    this.uniforms.uColorInner.value.set(palette.rayInner);
    this.uniforms.uColorOuter.value.set(palette.rayOuter);
  }

  // ctx: { barycenter: Vector3, extent: number, time: number }, as the particles get.
  update(audio, ctx) {
    if (!this.enabled) return;
    this.uniforms.uVolume.value = audio.getVolume();
    this.uniforms.uTime.value = ctx.time;
    if (this.frame++ % Math.max(1, this.look.every) !== 0) return;
    const L = this.look, T = PARTICLE_TUNING;
    const alive = this._alive; alive.length = 0;
    for (const c of this.cores) if (c.alive) alive.push(c);
    const na = alive.length;
    const per = this.seeds.length / 3, steps = Math.max(1, Math.min(STREAM_MAX_STEPS, Math.floor(L.steps))), h = L.step;
    const bx = ctx.barycenter.x, by = ctx.barycenter.y, bz = ctx.barycenter.z;
    const boundary = Math.max(T.boundaryMin, ctx.extent * T.boundaryMult), b2 = boundary * boundary;
    const pos = this.positions, info = this.info, seeds = this.seeds, start = this.lineStart;
    let v = 0, lines = 0;
    for (let ci = 0; ci < na; ci++) {
      const c = alive[ci], q = c.effectiveCharge;
      if (Math.abs(q) < 0.01) continue;                    // a body still spawning or nearly gone has no lines yet
      const r0 = c.radius * Math.max(c.scaleT, 0.05) * 1.08;
      const sign = q > 0 ? 1 : -1;                         // away from the body: along B off a source, against it off a sink
      for (let s = 0; s < per && lines < STREAM_MAX_LINES; s++) {
        let x = c.position.x + seeds[s * 3] * r0, y = c.position.y + seeds[s * 3 + 1] * r0, z = c.position.z + seeds[s * 3 + 2] * r0;
        const base = v;
        let landed = 0, k = 0;
        for (; k < steps; k++) {
          // The field at (x, y, z): the particle loop's sum over every alive core.
          let fx = 0, fy = 0, fz = 0;
          for (let oi = 0; oi < na; oi++) {
            const o = alive[oi];
            const dx = x - o.position.x, dy = y - o.position.y, dz = z - o.position.z;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz + 0.05), qf = o.effectiveCharge / (d * d * d);
            fx += qf * dx; fy += qf * dy; fz += qf * dz;
          }
          let m = Math.sqrt(fx * fx + fy * fy + fz * fz);
          if (m < 1e-6) break;
          // Midpoint: half a step along the unit field, the field there, the full step.
          const hh = sign * h * 0.5 / m;
          const mx = x + fx * hh, my = y + fy * hh, mz = z + fz * hh;
          fx = 0; fy = 0; fz = 0;
          for (let oi = 0; oi < na; oi++) {
            const o = alive[oi];
            const dx = mx - o.position.x, dy = my - o.position.y, dz = mz - o.position.z;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz + 0.05), qf = o.effectiveCharge / (d * d * d);
            fx += qf * dx; fy += qf * dy; fz += qf * dz;
          }
          m = Math.sqrt(fx * fx + fy * fy + fz * fz);
          if (m < 1e-6) break;
          const hs = sign * h / m;
          const nx = x + fx * hs, ny = y + fy * hs, nz = z + fz * hs;
          const v3 = v * 3;
          pos[v3] = x; pos[v3 + 1] = y; pos[v3 + 2] = z; pos[v3 + 3] = nx; pos[v3 + 4] = ny; pos[v3 + 5] = nz;
          info[v3 + 2] = k * sign; info[v3 + 5] = (k + 1) * sign;
          v += 2; x = nx; y = ny; z = nz;
          const ex = x - bx, ey = y - by, ez = z - bz;
          if (ex * ex + ey * ey + ez * ez > b2) break;      // left the frame
          for (let oi = 0; oi < na; oi++) {
            const o = alive[oi];
            if (o === c && k < 1) continue;                  // the root is just off its own surface
            const dx = x - o.position.x, dy = y - o.position.y, dz = z - o.position.z, sr = o.radius * Math.max(o.scaleT, 0.05);
            if (dx * dx + dy * dy + dz * dz < sr * sr) { landed = 1; break; }
          }
          if (landed) break;
        }
        const nv = v - base, segs = Math.max(1, nv / 2);
        for (let j = 0; j < nv; j++) { const j3 = (base + j) * 3; info[j3] = ((j >> 1) + (j & 1)) / segs; info[j3 + 1] = landed; }
        start[lines] = base; this.lineCore[lines] = c; lines++;
      }
    }
    start[lines] = v; this.lines = lines;
    this.posAttr.clearUpdateRanges(); this.posAttr.addUpdateRange(0, Math.max(3, v * 3)); this.posAttr.needsUpdate = true;
    this.infoAttr.clearUpdateRanges(); this.infoAttr.addUpdateRange(0, Math.max(3, v * 3)); this.infoAttr.needsUpdate = true;
    this.geo.setDrawRange(0, v);
  }
}

// ─── Labels (Attractor extras: 'labels') ─────────────────────────────────────

// "PARTICLE 0183" beside a capped subset of the particles and the body's
// role in caps (ATTRACTOR for a sun) beside each body. One canvas atlas is
// drawn once at construction, at LABEL_ATLAS_SCALE px per CSS px for retina
// text: LABEL_WORDS role rows, then LABEL_MAX_PARTICLES particle rows whose
// four-digit ids come from a fixed-seed PRNG and belong to the slot, so the
// atlas never changes and nothing is rasterised per frame. Labels are
// camera-facing quads in one fixed buffer (not point sprites: gl_PointSize
// caps would clip the text and a sprite vanishes whole at the screen edge):
// the vertex shader projects the anchor, stands the quad off to its right
// by the anchor's projected radius plus a gap and sizes it in device
// pixels, a HUD that reads the same at any distance. Slot k follows
// particle k * LABEL_STRIDE: the low indices are emitted and re-emitted
// first, so the tagged set is nearly always in flight and never churns; a
// tag fades in once its particle has cleared the surface and out where it
// landed. The body words are stood off past the limb and fade with the
// lifecycle. Drawn with the depth test (no depth write), so a tag behind a
// planet is hidden by it, as in the reference frame. No DOM. Headless (no
// document) the atlas is null: the pass lays out its quads and draws
// nothing.
const LABEL_ATLAS_SCALE = 2;                                   // atlas px per CSS px
const LABEL_ATLAS_W = 128 * LABEL_ATLAS_SCALE, LABEL_CELL_H = 16 * LABEL_ATLAS_SCALE;
const LABEL_WORDS = ['ATTRACTOR', 'SATELLITE', 'PARTNER'];      // atlas rows 0..2, by role
const LABEL_ROLE_ROW = { central: 0, satellite: 1, partner: 2 };
const LABEL_MAX_PARTICLES = 48;                                // tag slots; labels.count is clamped to it
const LABEL_MAX_BODIES = 8;
const LABEL_STRIDE = 2;                                        // slot k tags particle k * 2: under 96, in flight under any count (min 100)
const LABEL_ROWS = LABEL_WORDS.length + LABEL_MAX_PARTICLES;
function buildLabelAtlas() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = LABEL_ATLAS_W; canvas.height = LABEL_CELL_H * LABEL_ROWS;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
  const widths = new Float32Array(LABEL_ROWS);
  let s = 0x1f123bb5;   // mulberry32, fixed seed: the ids are the same every session
  const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let r = 0; r < LABEL_ROWS; r++) {
    const body = r < LABEL_WORDS.length;
    ctx.font = `bold ${(body ? 13 : 10) * LABEL_ATLAS_SCALE}px Helvetica, Arial, sans-serif`;
    const text = body ? LABEL_WORDS[r] : `PARTICLE ${String(Math.floor(rnd() * 10000)).padStart(4, '0')}`;
    ctx.fillText(text, LABEL_ATLAS_SCALE, r * LABEL_CELL_H + LABEL_CELL_H / 2);
    widths[r] = Math.min(LABEL_ATLAS_W, Math.ceil(ctx.measureText(text).width) + 2 * LABEL_ATLAS_SCALE);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;                                       // rows count from the top, like the shader's v
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping; texture.wrapT = THREE.ClampToEdgeWrapping;
  return { texture, widths };
}

const LABEL_VERTEX = `
  attribute vec2 aCorner;    // 0..1 across the quad, (0,0) bottom left
  attribute vec4 aInfo;      // x: atlas row, y: the row's text width in atlas px, z: fade, w: world units to stand off (a body's radius, 0 for a particle)
  attribute float aScale;    // 1 for a particle tag, labels.bodyScale for a body word
  uniform vec2 uViewport;    // drawing buffer, device px
  uniform float uRows;
  uniform float uAtlasW;
  uniform float uCellH;
  uniform float uScale;      // device px per atlas px: labels.scale x pixel ratio / the atlas scale
  varying vec2 vUv;
  varying float vFade;
  varying float vBody;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec4 clip = projectionMatrix * mv;
    float pxPerUnit = projectionMatrix[1][1] * uViewport.y * 0.5 / max(-mv.z, 0.001);   // device px per world unit at the anchor's depth
    float s = uScale * aScale;
    vec2 sizePx = vec2(aInfo.y, uCellH) * s;
    vec2 offPx = vec2(aInfo.w * pxPerUnit * 1.06 + 6.0 * s, -uCellH * 0.5 * s);        // just off the limb (or the particle), centred on its height
    clip.xy += (offPx + aCorner * sizePx) * 2.0 / uViewport * clip.w;
    gl_Position = clip;
    vUv = vec2(aCorner.x * aInfo.y / uAtlasW, (aInfo.x + 1.0 - aCorner.y) / uRows);
    vFade = aInfo.z * step(mv.z, 0.0);                                                    // nothing behind the camera
    vBody = 1.0 - step(${LABEL_WORDS.length}.0 - 0.5, aInfo.x);
  }
`;
const LABEL_FRAGMENT = `
  uniform sampler2D uAtlas;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vFade;
  varying float vBody;
  void main() {
    float a = texture2D(uAtlas, vUv).a * vFade * uOpacity;
    if (a < 0.01) discard;
    vec3 col = mix(mix(uColor, vec3(1.0), 0.35), vec3(1.0), vBody);   // tags in the palette, body words white
    gl_FragColor = vec4(col * a, 1.0);                                  // additive, like the rays
  }
`;

class ParticleLabels {
  constructor(scene, particles) {
    this.scene = scene;
    this.particles = particles;
    this.enabled = false;
    this.look = LOOK_DEFAULTS.labels;
    this.quads = 0;
    this.particleLabels = 0;
    const n = this.max = LABEL_MAX_PARTICLES + LABEL_MAX_BODIES;
    this.slotFade = new Float32Array(LABEL_MAX_PARTICLES);
    this.slotAge = new Float32Array(LABEL_MAX_PARTICLES);      // the particle's age last seen: a drop means a new particle in the slot
    this.slotPos = new Float32Array(LABEL_MAX_PARTICLES * 3);  // where it was last seen, so a tag fades out in place
    this.quadSlot = new Int16Array(n);                         // the slot each drawn quad belongs to (-1 for a body word)
    const atlas = buildLabelAtlas();
    this.atlas = atlas ? atlas.texture : null;
    this.widths = atlas ? atlas.widths : new Float32Array(LABEL_ROWS).fill(64 * LABEL_ATLAS_SCALE);
    this.positions = new Float32Array(n * 12);
    this.infos = new Float32Array(n * 16);
    this.scales = new Float32Array(n * 4);
    const corners = new Float32Array(n * 8), index = new Uint16Array(n * 6);
    for (let k = 0; k < n; k++) { corners.set([0, 0, 1, 0, 1, 1, 0, 1], k * 8); index.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3], k * 6); }
    this.geo = new THREE.BufferGeometry();
    this.attrs = {
      position: new THREE.BufferAttribute(this.positions, 3),
      aCorner: new THREE.BufferAttribute(corners, 2),
      aInfo: new THREE.BufferAttribute(this.infos, 4),
      aScale: new THREE.BufferAttribute(this.scales, 1),
    };
    for (const [name, a] of Object.entries(this.attrs)) this.geo.setAttribute(name, a);
    this.geo.setIndex(new THREE.BufferAttribute(index, 1));
    this.geo.setDrawRange(0, 0);
    this.uniforms = {
      uAtlas: { value: this.atlas }, uViewport: { value: new Float32Array([1, 1]) },
      uRows: { value: LABEL_ROWS }, uAtlasW: { value: LABEL_ATLAS_W }, uCellH: { value: LABEL_CELL_H },
      uScale: { value: 1 / LABEL_ATLAS_SCALE }, uColor: { value: new THREE.Color(0x6699ff) }, uOpacity: { value: LOOK_DEFAULTS.labels.opacity },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: LABEL_VERTEX, fragmentShader: LABEL_FRAGMENT, uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;                                 // after the particles and the lines
    scene.add(this.mesh);
  }

  applyLook(look, palette, pixelRatio = 1) {
    this.look = look.labels;
    this.enabled = look.extras.includes('labels');
    this.mesh.visible = this.enabled;
    if (!this.enabled) { this.geo.setDrawRange(0, 0); this.quads = 0; this.particleLabels = 0; this.slotFade.fill(0); }
    this.uniforms.uScale.value = this.look.scale * pixelRatio / LABEL_ATLAS_SCALE;
    this.uniforms.uOpacity.value = this.look.opacity;
    this.uniforms.uColor.value.set(palette.rayInner);
  }

  _quad(k, x, y, z, row, fade, radius, scale, slot) {
    const p = this.positions, nf = this.infos, k12 = k * 12, k16 = k * 16, k4 = k * 4, w = this.widths[row];
    for (let c = 0; c < 4; c++) {
      p[k12 + c * 3] = x; p[k12 + c * 3 + 1] = y; p[k12 + c * 3 + 2] = z;
      nf[k16 + c * 4] = row; nf[k16 + c * 4 + 1] = w; nf[k16 + c * 4 + 2] = fade; nf[k16 + c * 4 + 3] = radius;
      this.scales[k4 + c] = scale;
    }
    this.quadSlot[k] = slot;
  }

  // viewW, viewH: the drawing buffer size in device pixels.
  update(dt, cores, viewW, viewH) {
    if (!this.enabled) return;
    const P = this.particles, pos = P.positions, L = this.look;
    const want = Math.max(1, Math.min(LABEL_MAX_PARTICLES, Math.floor(L.count)));
    const up = dt * 4, down = dt * 2.5;
    let k = 0;
    for (let s = 0; s < want; s++) {
      const i = s * LABEL_STRIDE, s3 = s * 3;
      const on = i < P.count && P.active[i] === 1 && P.ages[i] > 0.15;   // joins once the particle has cleared the surface
      let f = this.slotFade[s];
      if (on) {
        if (P.ages[i] < this.slotAge[s]) f = 0;                          // a new particle in the slot: start over at its place
        this.slotAge[s] = P.ages[i];
        f = Math.min(1, f + up);
        const i3 = i * 3; this.slotPos[s3] = pos[i3]; this.slotPos[s3 + 1] = pos[i3 + 1]; this.slotPos[s3 + 2] = pos[i3 + 2];
      } else f = Math.max(0, f - down);
      this.slotFade[s] = f;
      if (f <= 0) continue;
      this._quad(k++, this.slotPos[s3], this.slotPos[s3 + 1], this.slotPos[s3 + 2], LABEL_WORDS.length + s, f, 0, 1, s);
    }
    this.particleLabels = k;
    for (const c of cores) {
      if (!c.alive || k >= this.max) continue;
      const row = LABEL_ROLE_ROW[c.role] ?? (c.mass >= HEAVY_MASS ? 0 : 1);
      const sc = Math.max(c.scaleT, 0.001);
      this._quad(k++, c.position.x, c.position.y, c.position.z, row, Math.min(1, sc), c.radius * sc, L.bodyScale, -1);
    }
    this.quads = k;
    const vp = this.uniforms.uViewport.value; vp[0] = viewW; vp[1] = viewH;
    const verts = Math.max(1, k * 4);
    for (const [name, a] of Object.entries(this.attrs)) {
      if (name === 'aCorner') continue;
      a.clearUpdateRanges(); a.addUpdateRange(0, verts * a.itemSize); a.needsUpdate = true;
    }
    this.geo.setDrawRange(0, k * 6);
  }
}

// ─── Nebula Background ───────────────────────────────────────────────────────

class Nebula {
  constructor(scene) {
    this.enabled = false;
    this.forced = null;   // a look can force the nebula on or off; null follows the B key
    this.gain = 1;        // a look's nebulaGain: how dense the fog is when it's on
    this.sprites = [];

    const spriteCount = 12;
    for (let i = 0; i < spriteCount; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');

      // Radial gradient blob
      const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      gradient.addColorStop(0, 'rgba(140,160,220,0.45)');
      gradient.addColorStop(0.3, 'rgba(100,120,180,0.25)');
      gradient.addColorStop(0.6, 'rgba(60,80,140,0.10)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 256, 256);

      const texture = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      const sprite = new THREE.Sprite(spriteMat);
      const r = 15 + Math.random() * 25;
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * Math.PI * 0.6;
      sprite.position.set(
        Math.cos(theta) * Math.cos(phi) * r,
        Math.sin(phi) * r * 0.5,
        Math.sin(theta) * Math.cos(phi) * r
      );
      sprite.scale.setScalar(12 + Math.random() * 18);

      scene.add(sprite);
      this.sprites.push({ sprite, mat: spriteMat, baseOpacity: 0.25 + Math.random() * 0.2 });
    }
  }

  toggle() {
    this.enabled = !this.enabled;
  }

  update(audio) {
    const volume = audio.getVolume();
    const on = this.forced === null ? this.enabled : this.forced;
    const targetOpacity = on ? 1.0 : 0;

    for (const s of this.sprites) {
      const target = Math.min(1, targetOpacity * (s.baseOpacity + volume * 0.25) * this.gain);
      s.mat.opacity = THREE.MathUtils.lerp(s.mat.opacity, target, 0.05);
      s.sprite.rotation.z += 0.0003;
    }
  }

  applyLook(look, palette) {
    const col = new THREE.Color(palette.rayOuter);
    for (const s of this.sprites) s.mat.color = col;
    this.forced = look.scene.nebula === 'auto' ? null : look.scene.nebula === 'on';
    this.gain = look.scene.nebulaGain;
  }
}

// ─── Starfield ───────────────────────────────────────────────────────────────

function createStarfield(scene) {
  const count = 4000;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const r = 60 + Math.random() * 140;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.ShaderMaterial({
    vertexShader: `
      void main() {
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 1.2 * (80.0 / -mvPos.z);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float alpha = (1.0 - d * d) * 0.5;
        gl_FragColor = vec4(0.75, 0.8, 0.95, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });

  const points = new THREE.Points(geo, mat);
  scene.add(points);
  return points;
}

// ─── Main Visualizer ─────────────────────────────────────────────────────────

class Visualizer {
  constructor() {
    this.audio = null;
    this.cores = [];
    this.particles = null;
    this.nebula = null;
    this.frozen = false;
    this.frozenAtTime = 0;   // wall-clock time when freeze was activated
    this.frozenOffset = 0;   // accumulated time spent frozen
    this.modeIndex = 0;
    this.paletteIndex = 0;
    this.bloomLevel = 1.0;
    this.particleCount = 500;
    this.clock = new THREE.Clock();

    // Camera state — single slow drift around the system barycenter
    this.camPos = new THREE.Vector3(0, 4, 16);
    this.camTargetPos = new THREE.Vector3(0, 4, 16);
    this.camLookAt = new THREE.Vector3(0, 0, 0);
    this.camTargetLookAt = new THREE.Vector3(0, 0, 0);
    this.camAzimuth = Math.random() * Math.PI * 2;
    this._barycenter = new THREE.Vector3();
    this._barycenterTarget = new THREE.Vector3();
    this._extent = 6.0;

    // System state
    this.systemConfig = null;
    this.targetBodies = 0;   // 0 = random systems; 1-5 = a count the system keeps
    this._tmpBg = new THREE.Color();

    this._initRenderer();
    this._initScene();
    this._initCores();
    this._initParticles();
    this._initNebula();
    this._initPostProcessing();
    this._bindEvents();
    this._applyLook();
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    document.body.appendChild(this.renderer.domElement);

    // A lost GPU context leaves a black canvas with no error; say so and
    // reload, which is the only recovery that works reliably.
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this._showError('GPU context lost, reloading');
      setTimeout(() => window.location.reload(), 1500);
    });
  }

  // Put a failure on screen in the info corner, since nobody has the console
  // open while a track plays.
  _showError(msg) {
    console.error(msg);
    const el = document.getElementById('info-text');
    if (!el) return;
    el.style.color = '#f66';
    el.textContent = msg;
    this._errorShown = true;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000008);
    this.scene.fog = new THREE.FogExp2(0x000008, 0.006);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera.position.set(0, 3, 10);
    this.camera.lookAt(0, 0, 0);

    // Subtle ambient
    this.scene.add(new THREE.AmbientLight(0x0a0a1a, 0.8));

    // Central point light
    this.centralLight = new THREE.PointLight(0xffffff, 2.0, 60);
    this.centralLight.position.set(0, 0, 0);
    this.scene.add(this.centralLight);

    // Secondary fill light
    const fill = new THREE.PointLight(0x4466aa, 0.5, 40);
    fill.position.set(5, 3, -5);
    this.scene.add(fill);

    // Starfield
    this.starfield = createStarfield(this.scene);

  }

  _initCores() {
    this.coreIdCounter = 0;
    this.spawnCooldown = 0;
    this._spawnSystem();
  }

  // Pick a system configuration and spawn its cores with initial conditions
  // chosen so the resulting n-body dynamics produce the intended visual feel.
  // With a target count: 1 lone sun, 2 binary, 3 solar or trinary, 4-5 solar
  // with 3-4 satellites. Without one, the usual random mix.
  _spawnSystem(count = 0) {
    let type, sats;
    if (count === 1) { type = 'solar'; sats = 0; }
    else if (count === 2) { type = 'binary'; sats = 0; }
    else if (count === 3) { type = Math.random() < 0.5 ? 'solar' : 'trinary'; sats = 2; }
    else if (count >= 4) { type = 'solar'; sats = count - 1; }
    else {
      const r = Math.random();
      if (r < 0.4) { type = 'solar'; sats = 2 + Math.floor(Math.random() * 2); }
      else if (r < 0.75) { type = 'binary'; sats = Math.random() < 0.5 ? 1 : 0; }
      else { type = 'trinary'; sats = 0; }
    }
    this.systemConfig = type;

    // 1.05× nudge above circular gives mildly elliptical orbits — more
    // visually interesting than perfect circles.
    const ELLIP = 1.05;

    if (type === 'solar') {
      const heavyMass = 7.0 + Math.random() * 3.0;
      const heavyRadius = 1.9 + Math.random() * 0.4;
      this._spawnCore({
        role: 'central',
        mass: heavyMass,
        charge: 1.0,
        radius: heavyRadius,
        position: new THREE.Vector3(
          (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 0.3,
        ),
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 0.05,
          (Math.random() - 0.5) * 0.02,
          (Math.random() - 0.5) * 0.05,
        ),
      });
      for (let i = 0; i < sats; i++) {
        const rad = 4.5 + i * 2.0 + Math.random() * 0.6;
        const angle = Math.random() * Math.PI * 2;
        const tilt = (Math.random() - 0.5) * 0.5;
        const pos = new THREE.Vector3(
          Math.cos(angle) * rad,
          Math.sin(tilt) * rad * 0.35,
          Math.sin(angle) * rad,
        );
        const v = Math.sqrt(PHYSICS_G * heavyMass / rad) * ELLIP;
        const vel = new THREE.Vector3(-Math.sin(angle) * v, 0, Math.cos(angle) * v);
        this._spawnCore({
          role: 'satellite',
          mass: 0.4 + Math.random() * 0.4,
          charge: -0.8,
          radius: 0.45 + Math.random() * 0.35,
          position: pos,
          velocity: vel,
        });
      }
    } else if (type === 'binary') {
      const mass = 2.2 + Math.random() * 0.8;
      const radius = 1.1 + Math.random() * 0.35;
      // Separation chosen so bodies sit ~4 radii apart minimum: clearly distinct.
      const sep = 4.5 + Math.random() * 2.0;
      const d = sep / 2;
      // For two equal masses orbiting their barycenter:
      // a = G * m_other / sep²;  v_circular = sqrt(a * d)
      const v = Math.sqrt(PHYSICS_G * mass * d / (sep * sep)) * ELLIP;
      this._spawnCore({
        role: 'partner',
        mass,
        charge: 1.0,
        radius,
        position: new THREE.Vector3(-d, 0, 0),
        velocity: new THREE.Vector3(0, 0, v),
      });
      this._spawnCore({
        role: 'partner',
        mass: mass * (0.9 + Math.random() * 0.2),
        charge: -1.0,
        radius: radius * (0.9 + Math.random() * 0.2),
        position: new THREE.Vector3(d, 0, 0),
        velocity: new THREE.Vector3(0, 0, -v),
      });
      if (sats > 0) {
        const rad = sep * (1.8 + Math.random() * 0.8);
        const angle = Math.random() * Math.PI * 2;
        const tilt = (Math.random() - 0.5) * 0.4;
        const vOuter = Math.sqrt(PHYSICS_G * 2 * mass / rad) * ELLIP;
        this._spawnCore({
          role: 'satellite',
          mass: 0.4,
          charge: 0.5,
          radius: 0.4 + Math.random() * 0.25,
          position: new THREE.Vector3(
            Math.cos(angle) * rad,
            Math.sin(tilt) * rad * 0.3,
            Math.sin(angle) * rad,
          ),
          velocity: new THREE.Vector3(
            -Math.sin(angle) * vOuter,
            0,
            Math.cos(angle) * vOuter,
          ),
        });
      }
    } else {
      // trinary — 3 equal bodies at 120°
      const mass = 1.6 + Math.random() * 0.4;
      const radius = 1.0 + Math.random() * 0.3;
      const rad = 3.5 + Math.random() * 1.0;
      // Symmetric 3-body: net inward accel = sqrt(3) * G * m / side²
      // where side = rad * sqrt(3) is the equilateral triangle side.
      const side = rad * Math.sqrt(3);
      const a = Math.sqrt(3) * PHYSICS_G * mass / (side * side);
      const v = Math.sqrt(a * rad) * ELLIP;
      const charges = [1.0, -1.0, 0.8];
      for (let i = 0; i < 3; i++) {
        const angle = (i / 3) * Math.PI * 2;
        this._spawnCore({
          role: 'partner',
          mass: mass * (0.92 + Math.random() * 0.16),
          charge: charges[i],
          radius: radius * (0.9 + Math.random() * 0.2),
          position: new THREE.Vector3(Math.cos(angle) * rad, 0, Math.sin(angle) * rad),
          velocity: new THREE.Vector3(-Math.sin(angle) * v, 0, Math.cos(angle) * v),
        });
      }
    }
  }

  // Bodies that count toward the target: anything not already on its way out.
  _liveCores() {
    return this.cores.filter(c => c.phase === 'spawning' || c.phase === 'alive');
  }

  // Add one body to the running system. If nothing heavy is left, a new sun
  // at the barycenter; otherwise a satellite on a circular orbit just outside
  // the outermost body, charged opposite to the heaviest so streams connect.
  _addBody() {
    const live = this._liveCores();
    if (live.length === 0) { this._spawnSystem(this.targetBodies); return; }

    let M = 0, cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0;
    let heavy = live[0];
    for (const c of live) {
      M += c.mass;
      cx += c.position.x * c.mass; cy += c.position.y * c.mass; cz += c.position.z * c.mass;
      vx += c.velocity.x * c.mass; vy += c.velocity.y * c.mass; vz += c.velocity.z * c.mass;
      if (c.mass > heavy.mass) heavy = c;
    }
    cx /= M; cy /= M; cz /= M; vx /= M; vy /= M; vz /= M;

    if (heavy.mass < HEAVY_MASS) {
      const heavyMass = 7.0 + Math.random() * 3.0;
      this._spawnCore({
        role: 'central',
        mass: heavyMass,
        charge: heavy.charge < 0 ? 1.0 : -1.0,
        radius: 1.9 + Math.random() * 0.4,
        position: new THREE.Vector3(cx, cy, cz),
        velocity: new THREE.Vector3(vx, vy, vz),
      });
      // The survivors have been coasting without a sun; put each back on a
      // circular orbit around the new one at its current distance, keeping
      // its current direction of travel.
      for (const c of live) {
        const rx = c.position.x - cx, ry = c.position.y - cy, rz = c.position.z - cz;
        const d = Math.hypot(rx, ry, rz) || 1;
        const ux = rx / d, uy = ry / d, uz = rz / d;
        let tx = c.velocity.x - vx, ty = c.velocity.y - vy, tz = c.velocity.z - vz;
        const radial = tx * ux + ty * uy + tz * uz;
        tx -= radial * ux; ty -= radial * uy; tz -= radial * uz;
        let tl = Math.hypot(tx, ty, tz);
        if (tl < 1e-3) { tx = -uz; ty = 0; tz = ux; tl = Math.hypot(tx, ty, tz) || 1; }
        const vc = Math.sqrt(PHYSICS_G * heavyMass / d) * 1.05;
        c.velocity.set(vx + tx / tl * vc, vy + ty / tl * vc, vz + tz / tl * vc);
      }
      return;
    }

    let maxR = 0;
    for (const c of live) {
      const d = Math.hypot(c.position.x - cx, c.position.y - cy, c.position.z - cz) + c.radius;
      if (d > maxR) maxR = d;
    }
    const ELLIP = 1.05;
    const rad = Math.max(4.5, maxR + 2.0 + Math.random() * 0.6);
    const angle = Math.random() * Math.PI * 2;
    const tilt = (Math.random() - 0.5) * 0.5;
    const v = Math.sqrt(PHYSICS_G * M / rad) * ELLIP;
    this._spawnCore({
      role: 'satellite',
      mass: 0.4 + Math.random() * 0.4,
      charge: heavy.charge > 0 ? -0.8 : 0.8,
      radius: 0.45 + Math.random() * 0.35,
      position: new THREE.Vector3(
        cx + Math.cos(angle) * rad,
        cy + Math.sin(tilt) * rad * 0.35,
        cz + Math.sin(angle) * rad,
      ),
      velocity: new THREE.Vector3(vx - Math.sin(angle) * v, vy, vz + Math.cos(angle) * v),
    });
  }

  // Collapse the lightest, outermost bodies first so the sun goes last.
  _removeBodies(n) {
    const live = this._liveCores();
    let cx = 0, cy = 0, cz = 0;
    for (const c of live) { cx += c.position.x; cy += c.position.y; cz += c.position.z; }
    cx /= live.length; cy /= live.length; cz /= live.length;
    const dist = c => Math.hypot(c.position.x - cx, c.position.y - cy, c.position.z - cz);
    live.sort((a, b) => (a.mass - b.mass) || (dist(b) - dist(a)));
    for (let i = 0; i < n && i < live.length; i++) live[i].beginCollapse();
  }

  // Keys 1-5: settle the running system toward the new count right away.
  _applyTargetBodies() {
    const live = this._liveCores().length;
    if (live > this.targetBodies) this._removeBodies(live - this.targetBodies);
    for (let i = live; i < this.targetBodies; i++) this._addBody();
    this.spawnCooldown = 1.5;
  }

  _spawnCore(params) {
    const core = new Core(this.scene, this.coreIdCounter++, params);
    this.cores.push(core);
    this._applyModeToCore(core);
    return core;
  }

  _applyModeToCore(core) {
    core.applyLook(LOOKS[this.modeIndex], PALETTES[this.paletteIndex]);
  }

  // n-body integration for the cores. Gravitational attraction between cores
  // (mass-based, always attracting), light damping, soft restoring force toward
  // origin so the system doesn't drift offscreen. Charges are reserved for the
  // particle <-> core interaction (handled in MagneticParticles.update).
  _updatePhysics(dt, audio) {
    const bass = audio.getBass();
    const G = PHYSICS_G * (1.0 + bass * 0.3);
    // Very light damping (~0.2%/sec) — bleeds chaos but preserves orbits over
    // the body's full lifespan.
    const damping = Math.pow(0.998, dt);
    const softening = 0.8;

    const physicsCores = this.cores.filter(c => c.alive);
    if (physicsCores.length === 0) return;

    // Forces (mass-based gravitational attraction between all cores).
    // Uses effectiveMass so a collapsing body's pull fades smoothly toward
    // zero across its collapse phase — no instantaneous COM jump on death.
    for (const core of physicsCores) {
      core.acceleration.set(0, 0, 0);
      for (const other of physicsCores) {
        if (other === core) continue;
        const dx = other.position.x - core.position.x;
        const dy = other.position.y - core.position.y;
        const dz = other.position.z - core.position.z;
        const distSq = dx * dx + dy * dy + dz * dz + softening * softening;
        const dist = Math.sqrt(distSq);
        const fMag = G * other.effectiveMass / distSq;
        core.acceleration.x += (dx / dist) * fMag;
        core.acceleration.y += (dy / dist) * fMag;
        core.acceleration.z += (dz / dist) * fMag;
      }
    }

    // Symplectic Euler integration
    for (const core of physicsCores) {
      core.velocity.x += core.acceleration.x * dt;
      core.velocity.y += core.acceleration.y * dt;
      core.velocity.z += core.acceleration.z * dt;
      core.velocity.multiplyScalar(damping);
      core.position.x += core.velocity.x * dt;
      core.position.y += core.velocity.y * dt;
      core.position.z += core.velocity.z * dt;
    }

    // Pull the center of mass gradually back to origin (~95% of the offset
    // removed per second). Applying only a fraction per frame means that when
    // a body dies and the remaining COM shifts, the survivors *drift* back to
    // the new center rather than teleporting. Mass-weighted by effectiveMass
    // so dying bodies contribute less, completing the smooth handoff.
    let cx = 0, cy = 0, cz = 0;
    let vx = 0, vy = 0, vz = 0;
    let totalMass = 0;
    for (const core of physicsCores) {
      const m = core.effectiveMass;
      cx += core.position.x * m;
      cy += core.position.y * m;
      cz += core.position.z * m;
      vx += core.velocity.x * m;
      vy += core.velocity.y * m;
      vz += core.velocity.z * m;
      totalMass += m;
    }
    if (totalMass > 0.0001) {
      cx /= totalMass; cy /= totalMass; cz /= totalMass;
      vx /= totalMass; vy /= totalMass; vz /= totalMass;
      const recenterFrac = 1 - Math.pow(0.05, dt); // ~95%/s
      for (const core of physicsCores) {
        core.position.x -= cx * recenterFrac;
        core.position.y -= cy * recenterFrac;
        core.position.z -= cz * recenterFrac;
        core.velocity.x -= vx * recenterFrac;
        core.velocity.y -= vy * recenterFrac;
        core.velocity.z -= vz * recenterFrac;
      }
    }
  }

  _updateCoreLifecycles(dt) {
    this.spawnCooldown = Math.max(0, this.spawnCooldown - dt);

    for (let i = this.cores.length - 1; i >= 0; i--) {
      if (!this.cores[i].alive && this.cores[i].phase === 'dead') {
        this.cores[i].destroy();
        this.cores.splice(i, 1);
      }
    }

    if (this.targetBodies > 0) {
      // Keep the locked count: bodies still age and die, the system refills.
      // A system that lost its sun gets a new one first, even if that
      // overshoots the count for a moment; the trim below takes a satellite.
      const liveCores = this._liveCores();
      const live = liveCores.length;
      const hasHeavy = liveCores.some(c => c.mass >= HEAVY_MASS);
      // Never add while a sun is still collapsing: a new one would spawn on
      // top of it and the pair would slingshot apart.
      const heavyGoing = this.cores.some(c => c.phase === 'collapsing' && c.mass >= HEAVY_MASS);
      if (!heavyGoing && (live < this.targetBodies || (live > 0 && !hasHeavy)) && this.spawnCooldown <= 0) {
        this._addBody();
        this.spawnCooldown = 1.5;
      } else if (live > this.targetBodies) {
        this._removeBodies(live - this.targetBodies);
      }
      return;
    }

    const aliveCount = this.cores.filter(c => c.phase !== 'dead').length;
    if (aliveCount === 0 && this.spawnCooldown <= 0) {
      this._spawnSystem();
      this.spawnCooldown = 1.5;
    }
  }

  _initParticles() {
    this.particles = new MagneticParticles(this.scene, this.cores, this.particleCount);
    // Scene-level extras passes (Attractor): the field lines from the
    // bodies and the labels. Both hidden until a look names them.
    this.fieldLines = new FieldLines(this.scene, this.cores);
    this.labels = new ParticleLabels(this.scene, this.particles);
  }

  _initNebula() {
    this.nebula = new Nebula(this.scene);
  }

  _initPostProcessing() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.7,   // strength
      0.4,   // radius
      0.6    // threshold - only the brightest cores and flashes bloom
    );
    this.composer.addPass(this.bloomPass);
  }

  _applyLook() {
    const look = LOOKS[this.modeIndex];
    const palette = PALETTES[this.paletteIndex];

    for (const core of this.cores) core.applyLook(look, palette);
    this.particles.applyLook(look, palette);
    this.nebula.applyLook(look, palette);
    this.fieldLines.applyLook(look, palette);
    this.labels.applyLook(look, palette, this.renderer.getPixelRatio());

    const effectiveCount = Math.min(5000, Math.round(this.particleCount * look.particles.countMul));
    this.particles.setCount(effectiveCount);

    const bg = look.scene.background === 'light' ? lightBackground(palette) : palette.bg;
    this.scene.background.set(bg);
    // Haze: lift the background toward the palette's outer colour so the
    // frame is bathed in it rather than black (no-op at 0).
    if (look.scene.haze > 0) this.scene.background.lerp(this._tmpBg.set(palette.rayOuter), look.scene.haze);
    this.scene.fog.color.copy(this.scene.background);
    this.scene.fog.density = look.scene.fog ? 0.006 : 0;
    this.starfield.visible = look.scene.stars;
    this.bloomLevel = look.scene.bloom;

    this._updateInfo();
  }

  // Build a palette from an image file (button or drag-and-drop) and switch to it.
  async _loadPaletteImage(file) {
    try {
      const bitmap = await createImageBitmap(file);
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 18) || 'Image';
      const palette = paletteFromPixels(data, name);
      const existing = PALETTES.findIndex(p => p.fromImage && p.name === name);
      if (existing >= 0) PALETTES[existing] = palette; else PALETTES.push(palette);
      this.paletteIndex = existing >= 0 ? existing : PALETTES.length - 1;
      this._applyLook();
    } catch (err) {
      console.error('Palette from image failed:', err);
    }
  }

  _updateInfo() {
    if (this._errorShown) return;
    const mode = LOOKS[this.modeIndex];
    const palette = PALETTES[this.paletteIndex];
    const el = document.getElementById('info-text');
    el.innerHTML = `${mode.name} / ${palette.name}<br>${this.particles.activeCount} / ${this.particles.count} particles${this.targetBodies ? ` / ${this.targetBodies} planets` : ''}${this.nebula.enabled ? ' / nebula' : ''}${this.frozen ? ' / frozen' : ''}`;
  }

  _bindEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    });

    this.helpEl = document.getElementById('help-overlay');

    window.addEventListener('error', (e) => this._showError(`Error: ${e.message || e}`));
    window.addEventListener('unhandledrejection', (e) => this._showError(`Error: ${e.reason && e.reason.message ? e.reason.message : e.reason}`));

    window.addEventListener('keydown', (e) => {
      const key = e.key;

      if (key === '?' || key === '/') {
        this.helpEl.classList.toggle('visible');
        return;
      }
      if (key === 'Escape') {
        this.helpEl.classList.remove('visible');
        return;
      }

      switch (key.toLowerCase()) {
        case 'm':
          this.modeIndex = (this.modeIndex + 1) % LOOKS.length;
          this._applyLook();
          break;
        case 'p':
          this.paletteIndex = (this.paletteIndex + 1) % PALETTES.length;
          this._applyLook();
          break;
        case 'f':
          this.frozen = !this.frozen;
          if (this.frozen) {
            this.frozenAtTime = this.clock.getElapsedTime();
          } else {
            this.frozenOffset += this.clock.getElapsedTime() - this.frozenAtTime;
          }
          this._updateInfo();
          break;
        case 'n':
          this.modeIndex = (this.modeIndex - 1 + LOOKS.length) % LOOKS.length;
          this._applyLook();
          break;
        case 'a':
          this.particleCount = Math.min(5000, this.particleCount + 200);
          this.particles.setCount(this.particleCount);
          this._updateInfo();
          break;
        case 's':
          this.particleCount = Math.max(100, this.particleCount - 200);
          this.particles.setCount(this.particleCount);
          this._updateInfo();
          break;
        case 'b':
          this.nebula.toggle();
          this._updateInfo();
          break;
        case '0':
          this.targetBodies = 0;
          this._updateInfo();
          break;
        case '1': case '2': case '3': case '4': case '5':
          this.targetBodies = Number(key);
          this._applyTargetBodies();
          this._updateInfo();
          break;
      }
    });

    document.getElementById('btn-capture').addEventListener('click', () => this._startCapture());
    document.getElementById('btn-file').addEventListener('click', () => {
      document.getElementById('file-input').click();
    });
    document.getElementById('file-input').addEventListener('change', (e) => {
      if (e.target.files[0]) this._startFile(e.target.files[0]);
    });
    document.getElementById('btn-demo').addEventListener('click', () => this._startDemo());

    // Palette from an image: the start-panel button, or drop an image anywhere.
    document.getElementById('btn-image').addEventListener('click', () => {
      document.getElementById('image-input').click();
    });
    document.getElementById('image-input').addEventListener('change', (e) => {
      if (e.target.files[0]) this._loadPaletteImage(e.target.files[0]);
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer && e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) this._loadPaletteImage(file);
    });
  }

  async _startCapture() {
    const audio = new AudioAnalyzer();
    const ok = await audio.captureSystemAudio();
    if (ok) {
      this.audio = audio;
      this._showVisualizer();
    } else {
      alert('Could not capture system audio.\nMake sure to select a tab/window and check "Share audio".');
    }
  }

  async _startFile(file) {
    const audio = new AudioAnalyzer();
    const ok = await audio.loadFile(file);
    if (ok) {
      this.audio = audio;
      this._showVisualizer();
    }
  }

  _startDemo() {
    this.audio = new DemoAnalyzer();
    this._showVisualizer();
  }

  _showVisualizer() {
    document.getElementById('overlay').classList.add('hidden');
  }

  start() {
    this.audio = new DemoAnalyzer();
    this._applyUrlParams();
    this._animate();
  }

  // URL parameters for scripted runs and screenshots:
  //   ?demo            start Demo Mode without clicking
  //   ?look=Comets     select a look by name (or index)
  //   ?palette=Ember   select a palette by name (or index)
  //   ?planets=3       lock the planet count
  //   ?nebula=1        turn the nebula on
  _applyUrlParams() {
    let params;
    try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
    const byName = (list, v) => {
      if (v === null) return -1;
      const i = list.findIndex(x => x.name.toLowerCase() === v.toLowerCase());
      if (i >= 0) return i;
      const n = Number(v);
      return Number.isInteger(n) && n >= 0 && n < list.length ? n : -1;
    };
    const li = byName(LOOKS, params.get('look'));
    if (li >= 0) this.modeIndex = li;
    const pi = byName(PALETTES, params.get('palette'));
    if (pi >= 0) this.paletteIndex = pi;
    const planets = Number(params.get('planets'));
    if (Number.isInteger(planets) && planets >= 1 && planets <= 5) { this.targetBodies = planets; this._applyTargetBodies(); }
    if (params.get('nebula') === '1') this.nebula.enabled = true;
    if (li >= 0 || pi >= 0) this._applyLook();
    if (params.has('demo')) this._startDemo();
  }

  // Single continuous slow drift around the system's barycenter. Camera
  // distance scales with the system's current extent so all bodies stay framed.
  _updateCamera(wallTime, dt) {
    const alive = this.cores.filter(c => c.alive);

    let bx = 0, by = 0, bz = 0, totalMass = 0;
    for (const c of alive) {
      const m = c.effectiveMass;
      bx += c.position.x * m;
      by += c.position.y * m;
      bz += c.position.z * m;
      totalMass += m;
    }
    if (totalMass > 0.0001) {
      this._barycenterTarget.set(bx / totalMass, by / totalMass, bz / totalMass);
    }
    this._barycenter.lerp(this._barycenterTarget, 0.04);

    let extentTarget = 5.5;
    for (const c of alive) {
      const dx = c.position.x - this._barycenter.x;
      const dy = c.position.y - this._barycenter.y;
      const dz = c.position.z - this._barycenter.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + c.radius;
      if (d > extentTarget) extentTarget = d;
    }
    this._extent = THREE.MathUtils.lerp(this._extent, extentTarget, 0.03);

    // Slow continuous tour: ~one full azimuth revolution per ~100s, elevation
    // and distance breathe on different periods so the angle is rarely the same.
    this.camAzimuth += dt * 0.062;
    const elevation = Math.sin(wallTime * 0.022) * 0.45 + 0.18;
    const distMult = 2.15 + Math.sin(wallTime * 0.028) * 0.3;
    const camDist = this._extent * distMult;
    const cosE = Math.cos(elevation);
    const sinE = Math.sin(elevation);

    this.camTargetPos.set(
      this._barycenter.x + Math.cos(this.camAzimuth) * cosE * camDist,
      this._barycenter.y + sinE * camDist,
      this._barycenter.z + Math.sin(this.camAzimuth) * cosE * camDist,
    );
    this.camTargetLookAt.copy(this._barycenter);

    this.camPos.lerp(this.camTargetPos, 0.02);
    this.camLookAt.lerp(this.camTargetLookAt, 0.04);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLookAt);
  }

  _animate() {
    requestAnimationFrame(() => this._animate());

    // getElapsedTime() internally consumes the delta, so call getDelta() first
    // and read elapsedTime directly. Clamp dt so a tab-switch doesn't blow up
    // the physics integration on the resume frame.
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 1 / 30);
    const wallTime = this.clock.elapsedTime;
    this.audio.update(dt);

    let simTime;
    if (this.frozen) {
      simTime = this.frozenAtTime - this.frozenOffset;
    } else {
      simTime = wallTime - this.frozenOffset;
    }

    const bass = this.audio.getBass();
    const volume = this.audio.getVolume();
    const treble = this.audio.getTreble();

    this._updateCoreLifecycles(dt);

    // Physics: cores attract each other gravitationally; sets fresh positions
    // before camera and particles read them. Skipped when frozen.
    if (!this.frozen) {
      this._updatePhysics(dt, this.audio);
    }

    // Visual sync for cores (mesh transform + shader uniforms). Cores that
    // die on this frame are handed to the particles for their burst.
    const died = [];
    for (const core of this.cores) {
      const wasAlive = core.alive;
      core.update(simTime, dt, this.audio);
      if (wasAlive && !core.alive) died.push(core);
    }

    this._updateCamera(wallTime, dt);

    const hit = this.audio.getHit('bass') * (0.35 + 0.65 * volume);
    this.centralLight.intensity = 2.0 + bass * 3.0 + hit * 3.0 + volume * 1.5;
    const hue = 0.6 + treble * 0.1;
    this.centralLight.color.setHSL(hue, 0.5, 0.5 + volume * 0.3);

    const ctx = { barycenter: this._barycenter, extent: this._extent, died, time: simTime };
    this.particles.update(this.audio, dt, ctx);

    // Extras at the scene level: field lines from the bodies (on the
    // positions physics just set) and the labels (on the positions the
    // particles just took; sized in device pixels, so the drawing buffer).
    this.fieldLines.update(this.audio, ctx);
    this.labels.update(dt, this.cores, this.renderer.domElement.width, this.renderer.domElement.height);

    // Nebula
    this.nebula.update(this.audio);

    this._infoFrames = (this._infoFrames || 0) + 1;
    if (this._infoFrames % 30 === 0) this._updateInfo();

    // Starfield drift
    this.starfield.rotation.y += 0.00008;

    // Bloom reacts to volume
    this.bloomPass.strength = (0.5 + volume * 0.6 + hit * 0.4) * this.bloomLevel;

    this.composer.render();
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────────

const viz = new Visualizer();
viz.start();

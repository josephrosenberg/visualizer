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

// ─── Visual Modes ────────────────────────────────────────────────────────────

const MODES = [
  { name: 'Classic',       coreVisible: true,  wireframe: false, metalness: 0.8, roughness: 0.15, rayStyle: 'ribbon',  trailLen: 30, particleMul: 1.0 },
  { name: 'Wireframe',     coreVisible: true,  wireframe: true,  metalness: 0.5, roughness: 0.3,  rayStyle: 'line',    trailLen: 40, particleMul: 1.0 },
  { name: 'Rays Only',     coreVisible: false, wireframe: false, metalness: 0,   roughness: 0,    rayStyle: 'ribbon',  trailLen: 35, particleMul: 1.0 },
  { name: 'Points',        coreVisible: true,  wireframe: false, metalness: 0.9, roughness: 0.1,  rayStyle: 'point',   trailLen: 0,  particleMul: 1.0 },
  { name: 'Long Trails',   coreVisible: true,  wireframe: false, metalness: 0.7, roughness: 0.2,  rayStyle: 'ribbon',  trailLen: 60, particleMul: 1.0 },
  { name: 'Wire Rays',     coreVisible: true,  wireframe: true,  metalness: 0.4, roughness: 0.4,  rayStyle: 'line',    trailLen: 25, particleMul: 1.0 },
  { name: 'Ghost',         coreVisible: false, wireframe: false, metalness: 0,   roughness: 0,    rayStyle: 'line',    trailLen: 50, particleMul: 1.0 },
  { name: 'Dense',         coreVisible: true,  wireframe: false, metalness: 0.6, roughness: 0.3,  rayStyle: 'ribbon',  trailLen: 50, particleMul: 2.5 },
];

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
    this.hit = perBand(0);                        // 1 on an onset, decays
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
      if (rising && level > T.onsetMinLevel && level > avg * T.onsetRatio[name]
          && this.sinceHit[name] > T.onsetRefractory) {
        this.hit[name] = 1;
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

    const kick = breakdown ? 0 : Math.exp(-beatPhase / 0.1);
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

// ─── Core (Planet with shader-based surface) ─────────────────────────────────

// Recent surface events per planet (flare spots, landings, bounces), drawn by
// the fragment shader as rings. Stored in object space so they rotate with
// the body.
const MAX_SURFACE_EVENTS = 32;

const PLANET_VERTEX = /* glsl */ `
  uniform float uBass;
  uniform float uHit;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying vec3 vObjNormal;

  void main() {
    vec3 pos = position;
    vObjNormal = normal;

    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(normalMatrix * normal);
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
  uniform float uMetalness;
  uniform float uRoughness;
  uniform vec4 uEvents[MAX_EVENTS];      // xyz: object-space direction, w: start time
  uniform float uEventKinds[MAX_EVENTS]; // 0 flare spot, 1 ripple

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;
  varying vec3 vObjNormal;

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

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vViewDir);
    float NdotV = max(dot(N, V), 0.0);

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

    // Ring buffer of surface events for the shader; start times far in the
    // past so empty slots never draw.
    this.surfaceEvents = new Float32Array(MAX_SURFACE_EVENTS * 4);
    this.surfaceKinds = new Float32Array(MAX_SURFACE_EVENTS);
    for (let k = 0; k < MAX_SURFACE_EVENTS; k++) this.surfaceEvents[k * 4 + 3] = -1000;
    this.surfaceHead = 0;
    this.lastRipple = -1000;
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
      uMetalness:  { value: 0.85 },
      uRoughness:  { value: 0.15 },
      uEvents:     { value: this.surfaceEvents },
      uEventKinds: { value: this.surfaceKinds },
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
  // 1 = ripple (a landing or a bounce). Ripples are throttled so a busy sink
  // shows a patter instead of a smear.
  addSurfaceEvent(x, y, z, kind, time) {
    if (kind === 1) {
      if (time - this.lastRipple < 0.03) return;
      this.lastRipple = time;
    }
    const v = this._tmpVec.set(x - this.position.x, y - this.position.y, z - this.position.z);
    v.applyQuaternion(this._tmpQuat.copy(this.mesh.quaternion).invert()).normalize();
    const k = this.surfaceHead * 4;
    this.surfaceEvents[k]     = v.x;
    this.surfaceEvents[k + 1] = v.y;
    this.surfaceEvents[k + 2] = v.z;
    this.surfaceEvents[k + 3] = time;
    this.surfaceKinds[this.surfaceHead] = kind;
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
      if (this.phaseTime >= this.lifeDuration) {
        this.phase = 'collapsing';
        this.phaseTime = 0;
      }
    } else if (this.phase === 'collapsing') {
      const t = Math.min(1, this.phaseTime / this.collapseDuration);
      this.scaleT = 1 - t * t * t;
      if (this.phaseTime >= this.collapseDuration) {
        this.phase = 'dead';
        this.alive = false;
        this.mesh.visible = false;
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
  }

  destroy() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }

  applyMode(mode, palette) {
    this.mesh.visible = mode.coreVisible && this.alive;
    this.material.wireframe = mode.wireframe;
    this.uniforms.uMetalness.value = mode.metalness;
    this.uniforms.uRoughness.value = mode.roughness;
    this.uniforms.uColorCore.value.set(palette.core);
    this.uniforms.uColorInner.value.set(palette.rayInner);
    this.uniforms.uColorOuter.value.set(palette.rayOuter);
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
  energyNoise:   0.3,   // random spread on energy, keeps both populations present
  launchMin:     1.2,   // speed at zero energy
  launchMax:     6.5,   // speed at full energy
  launchSpread:  0.15,  // sideways speed as a fraction of launch speed
  srcGravity:    6.0,   // escape speed off any surface = sqrt(2 * srcGravity), ~3.5
  restitution:   0.35,  // one bounce before landing
  bounceMin:     0.8,   // impacts slower than this just land
  escapeInner:   1.6,   // radii: the field starts taking over
  escapeOuter:   2.6,   // radii: fully on the field, source gravity off
  // Look
  pointSize:     0.45,  // base sprite size (pixels ~ size * 250 / distance)
  poolQuiet:     0.25,  // fraction of the pool allowed in flight at silence; all of it at full loudness
  // Field flight
  speedBase:     1.6,   // cruise speed along a field line at silence
  speedVolume:   1.8,   // extra speed per unit of volume
  poleBoost:     0.8,   // up to +80% speed where the field is strong (near a core)
  poleFieldRef:  0.5,   // |B| at which poleBoost saturates
  steer:         10,    // 1/s, how fast velocity turns toward the field line
  shimmer:       0.6,   // sideways wobble speed driven by the particle's FFT bin
  fadeIn:        0.12,  // seconds to full brightness after emission
  maxAge:        10,    // seconds before a particle is recycled regardless
  boundaryMult:  2.2,   // lines that escape past this many extents recycle
  boundaryMin:   12,    // ...but never closer than this
  // Collapse
  pullRadii:     4,     // a collapsing core pulls particles from this many radii out
  pullStrength:  7,     // inward speed added at full collapse, at the core
  burstSpeed:    8,     // outward impulse when a core dies
  burstRadii:    2.5,   // particles within this many radii of a dying core get it
  kickDecay:     1.2,   // seconds for a burst to hand control back to the field
};

const smoothstep01 = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

class MagneticParticles {
  constructor(scene, cores, initialCount) {
    this.scene = scene;
    this.cores = cores;
    this.maxCount = 5000;
    this.count = initialCount;
    this.trailLength = 30;
    this.rayStyle = 'ribbon';
    this.t = 0;
    this.emitBudget = 0;     // trickle
    this.activeCount = 0;    // particles in flight
    this.burstBudget = 0;    // hit bursts, from flare spots
    this._lastHit = 0;
    this._burstBoost = 0;
    this._spotsByCore = new Map(); // Core -> flat [x,y,z,...] world directions
    this._dir = [0, 0, 0];

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
    this.trails = [];                     // per-particle position history (flat xyz)

    for (let i = 0; i < n; i++) {
      // Log-spaced so every octave has listeners. Uniform bins would put
      // most particles above 4 kHz, where music has almost nothing.
      const [loHz, hiHz] = AUDIO_TUNING.particleHz;
      this.listenHz[i] = loHz * Math.pow(hiHz / loHz, Math.random());
      this.sizeMul[i] = 0.6 * Math.pow(3, Math.random());        // 0.6x .. 1.8x, log-uniform
      this.phases[i] = Math.random() * Math.PI * 2;
      this.trails[i] = [];
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

    this.pointMat = new THREE.ShaderMaterial({
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (250.0 / -mvPos.z);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          // Solid disc with a thin feathered edge and a hot center, so a
          // particle reads as a point of light rather than a fog blob.
          float disc = 1.0 - smoothstep(0.6, 1.0, d);
          float core = 1.0 - smoothstep(0.0, 0.35, d);
          float alpha = disc * 0.85 + core * 0.6;
          gl_FragColor = vec4(vColor * (1.0 + core * 0.6), alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.pointGeo, this.pointMat);
    scene.add(this.points);

    // --- Trail lines (ribbons) ---
    // LineSegments geometry: a pair of vertices per segment.
    this.maxTrailVerts = n * 60 * 2;
    this.trailGeo = new THREE.BufferGeometry();
    this.trailPositions = new Float32Array(this.maxTrailVerts * 3);
    this.trailColors = new Float32Array(this.maxTrailVerts * 3);
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trailGeo.setAttribute('color', new THREE.BufferAttribute(this.trailColors, 3));

    this.trailMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.trailLines = new THREE.LineSegments(this.trailGeo, this.trailMat);
    scene.add(this.trailLines);

    this.innerColor = new THREE.Color(0x6699ff);
    this.outerColor = new THREE.Color(0x2244aa);
    // Pooled color objects to avoid GC pressure in hot loops
    this._tmpColorA = new THREE.Color();
    this._tmpColorB = new THREE.Color();
    this._tmpColorParticle = new THREE.Color();
  }

  setCount(n) {
    const next = Math.max(100, Math.min(this.maxCount, n));
    // Anything above the new count goes dormant so it isn't left frozen on screen.
    for (let i = next; i < this.count; i++) this._sleep(i);
    this.count = next;
  }

  applyMode(mode, palette) {
    this.trailLength = mode.trailLen;
    this.rayStyle = mode.rayStyle;
    this.innerColor.set(palette.rayInner);
    this.outerColor.set(palette.rayOuter);

    this.points.visible = (mode.rayStyle === 'point' || mode.rayStyle === 'ribbon' || mode.rayStyle === 'line');
    this.trailLines.visible = (mode.rayStyle === 'ribbon' || mode.rayStyle === 'line');
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

  // Launch energy from the particle's own listener at this instant, scaled
  // by loudness, plus a little extra on a hit. Hot bins escape, quiet bins
  // bounce and fall back; quiet passages tilt toward falling back, loud
  // passages toward interchange, and the noise keeps both present.
  _launchEnergy(i, audio, boost) {
    const T = PARTICLE_TUNING;
    const amp = audio.getFreqAt(this.listenHz[i]);
    const loud = audio.getVolume();
    const gain = T.energyQuiet + (T.energyLoud - T.energyQuiet) * loud;
    const e = amp * gain + boost * loud + (Math.random() - 0.5) * T.energyNoise;
    return e < 0 ? 0 : e > 1 ? 1 : e;
  }

  // Release a dormant particle off a core's surface at direction n (unit),
  // moving outward at a speed set by its energy, carried along with the core.
  _emit(i, core, nx, ny, nz, energy) {
    const T = PARTICLE_TUNING;
    const i3 = i * 3;
    const r = core.radius * Math.max(core.scaleT, 0.05) * 1.02;

    this.positions[i3]     = core.position.x + nx * r;
    this.positions[i3 + 1] = core.position.y + ny * r;
    this.positions[i3 + 2] = core.position.z + nz * r;

    const v0 = T.launchMin + energy * (T.launchMax - T.launchMin);
    const sp = v0 * T.launchSpread * 2;
    this.velocities[i3]     = core.velocity.x + nx * v0 + (Math.random() - 0.5) * sp;
    this.velocities[i3 + 1] = core.velocity.y + ny * v0 + (Math.random() - 0.5) * sp;
    this.velocities[i3 + 2] = core.velocity.z + nz * v0 + (Math.random() - 0.5) * sp;

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
    this.trails[i].length = 0;
  }

  _sleep(i) {
    if (this.active[i]) this.activeCount--;
    this.active[i] = 0;
    this.brightness[i] = 0;
    this.pointSizes[i] = 0;
    this.trails[i].length = 0;
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
    this._burstBoost = 0.25 * bassLevel;
    this._spotsByCore.clear();
    for (const c of this._emitters) {
      const n = T.spotsMin + Math.floor(Math.random() * (T.spotsMax - T.spotsMin + 1));
      const r = c.radius * Math.max(c.scaleT, 0.05);
      const spots = [];
      for (let k = 0; k < n; k++) {
        const d = this._randomDir();
        spots.push(d[0], d[1], d[2]);
        c.addSurfaceEvent(c.position.x + d[0] * r, c.position.y + d[1] * r, c.position.z + d[2] * r, 0, time);
      }
      this._spotsByCore.set(c, spots);
    }
  }

  // Direction for a burst particle: a spot of this core, scattered.
  _spotDir(core) {
    const T = PARTICLE_TUNING;
    const spots = this._spotsByCore.get(core);
    const d = this._dir;
    if (!spots || spots.length === 0) return this._randomDir();
    const k = Math.floor(Math.random() * (spots.length / 3)) * 3;
    d[0] = spots[k]     + (Math.random() - 0.5) * 2 * T.spotSpread;
    d[1] = spots[k + 1] + (Math.random() - 0.5) * 2 * T.spotSpread;
    d[2] = spots[k + 2] + (Math.random() - 0.5) * 2 * T.spotSpread;
    const l = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) || 1;
    d[0] /= l; d[1] /= l; d[2] /= l;
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
    const rate = this.count * (T.trickleBase + volume * T.trickleVolume);
    this.emitBudget = Math.min(this.emitBudget + rate * dt, this.count * T.trickleCap);

    // Burst budget: a bass hit on its rising edge.
    const hitBass = audio.getHit('bass');
    if (hitBass > 0.6 && this._lastHit <= 0.6 && canEmit) this._flare(audio, time);
    this._lastHit = hitBass;
    if (!canEmit) this.burstBudget = 0;
    const burstCap = this.count * T.burstCap;
    let burstThisFrame = 0;

    // How many may be in flight follows loudness: quiet means a sparse
    // scene, loud means the whole pool. Nothing is killed early; emission
    // just waits for natural recycling to bring the count under the cap.
    const activeCap = this.count * (T.poolQuiet + (1 - T.poolQuiet) * volume);

    const speed = T.speedBase + volume * T.speedVolume;
    const steerBase = Math.min(1, dt * T.steer);
    const shimmerT = this.t * 6;

    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;

      if (!this.active[i]) {
        if (this.activeCount >= activeCap) {
          this.pointSizes[i] = 0;
          continue;
        }
        if (canEmit && this.burstBudget >= 1 && burstThisFrame < burstCap) {
          const core = this._pickEmitter();
          const d = this._spotDir(core);
          this._emit(i, core, d[0], d[1], d[2], this._launchEnergy(i, audio, this._burstBoost));
          this.burstBudget -= 1;
          burstThisFrame++;
        } else if (canEmit && this.emitBudget >= 1) {
          const core = this._pickEmitter();
          const d = this._randomDir();
          this._emit(i, core, d[0], d[1], d[2], this._launchEnergy(i, audio, 0));
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

      // Field at p, plus the collapse pull, plus surface contact. The
      // particle's own source is handled separately while it's ballistic.
      let fx = 0, fy = 0, fz = 0;
      let pullX = 0, pullY = 0, pullZ = 0;
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
        const q = core.effectiveCharge / (d * d * d);
        fx += q * dx;
        fy += q * dy;
        fz += q * dz;

        if (ct > 0) {
          const reach = core.radius * T.pullRadii + 1;
          if (d < reach) {
            const g = (1 - d / reach) * ct * ct * T.pullStrength / d;
            pullX -= dx * g;
            pullY -= dy * g;
            pullZ -= dz * g;
          }
        }
      }
      if (absorbedBy) {
        absorbedBy.addSurfaceEvent(px, py, pz, 1, time);
        this._sleep(i);
        continue;
      }

      // Ballistic phase: the source's gravity, a bounce, a landing, or escape.
      let gx = 0, gy = 0, gz = 0;
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
          onField = smoothstep01(T.escapeInner, T.escapeOuter, d / r);
          if (onField >= 1) {
            this.escaped[i] = 1;
          } else {
            const a = T.srcGravity * r / Math.max(d2, r * r * 0.25) * (1 - onField);
            gx = -dx / d * a;
            gy = -dy / d * a;
            gz = -dz / d * a;

            if (d < r && age > 0.03) {
              const nx = dx / d, ny = dy / d, nz = dz / d;
              // Impact speed relative to the moving surface
              const vr = (vx - src.velocity.x) * nx + (vy - src.velocity.y) * ny + (vz - src.velocity.z) * nz;
              if (!this.bounced[i] && -vr > T.bounceMin) {
                const k = (1 + T.restitution) * vr;
                vx -= k * nx;
                vy -= k * ny;
                vz -= k * nz;
                px = src.position.x + nx * r * 1.01;
                py = src.position.y + ny * r * 1.01;
                pz = src.position.z + nz * r * 1.01;
                this.bounced[i] = 1;
                src.addSurfaceEvent(px, py, pz, 1, time);
              } else {
                src.addSurfaceEvent(px, py, pz, 1, time);
                this._sleep(i);
                continue;
              }
            }
          }
        }
      }

      // Flight along the field: unit flow direction along (or against) the
      // field, faster where the field is strong so lines rush in and out of
      // the poles, and faster for particles whose own frequency is hot.
      const freqAmp = audio.getFreqAt(this.listenHz[i]);
      const fmag = Math.sqrt(fx * fx + fy * fy + fz * fz);
      let tx = pullX, ty = pullY, tz = pullZ;
      if (fmag > 1e-6) {
        const inv = this.flowDir[i] / fmag;
        const ux = fx * inv, uy = fy * inv, uz = fz * inv;
        const s = speed * (0.55 + 0.9 * freqAmp) * (1 + Math.min(1, fmag / T.poleFieldRef) * T.poleBoost);

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

      // Steering is off while ballistic and fades in across the escape zone.
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

      // Store trail
      if (this.trailLength > 0) {
        const trail = this.trails[i];
        trail.push(px, py, pz);
        // Each position is 3 floats, so max entries = trailLength * 3
        const maxEntries = this.trailLength * 3;
        if (trail.length > maxEntries) {
          trail.splice(0, trail.length - maxEntries);
        }
      }

      // Brightness: fade in after emission, lift with the particle's own
      // bin, and sit a little lower overall when the music is quiet.
      const bright = Math.min(1, this.ages[i] / T.fadeIn) * (0.55 + freqAmp * 0.45) * (0.6 + volume * 0.4);
      this.brightness[i] = bright;

      this.pointPositions[i3]     = px;
      this.pointPositions[i3 + 1] = py;
      this.pointPositions[i3 + 2] = pz;

      const c = this._tmpColorParticle.lerpColors(this.outerColor, this.innerColor, freqAmp);
      this.pointColors[i3]     = c.r * bright;
      this.pointColors[i3 + 1] = c.g * bright;
      this.pointColors[i3 + 2] = c.b * bright;

      this.pointSizes[i] = T.pointSize * (0.6 + freqAmp * 0.8) * this.sizeMul[i] * (0.8 + 0.4 * this.energy[i]) * (0.5 + 0.5 * bright);
    }

    // Zero out unused points
    for (let i = this.count; i < this.maxCount; i++) {
      this.pointSizes[i] = 0;
    }

    this.pointGeo.attributes.position.needsUpdate = true;
    this.pointGeo.attributes.color.needsUpdate = true;
    this.pointGeo.attributes.size.needsUpdate = true;
    this.pointGeo.setDrawRange(0, this.count);

    // Update trail geometry
    this._updateTrails();
  }

  _updateTrails() {
    if (this.trailLength === 0) {
      this.trailGeo.setDrawRange(0, 0);
      return;
    }

    let vertIdx = 0;
    const maxVerts = this.maxTrailVerts;

    for (let i = 0; i < this.count; i++) {
      const trail = this.trails[i];
      const numPoints = trail.length / 3;
      if (numPoints < 2) continue;

      const bright = this.brightness[i];

      for (let j = 0; j < numPoints - 1 && vertIdx < maxVerts - 1; j++) {
        const j3 = j * 3;
        const alphaA = (j / numPoints) * bright;
        const alphaB = ((j + 1) / numPoints) * bright;

        const vA = vertIdx * 3;
        const vB = (vertIdx + 1) * 3;

        this.trailPositions[vA]     = trail[j3];
        this.trailPositions[vA + 1] = trail[j3 + 1];
        this.trailPositions[vA + 2] = trail[j3 + 2];

        this.trailPositions[vB]     = trail[j3 + 3];
        this.trailPositions[vB + 1] = trail[j3 + 4];
        this.trailPositions[vB + 2] = trail[j3 + 5];

        // Color fades along trail
        const cA = this._tmpColorA.lerpColors(this.outerColor, this.innerColor, alphaA);
        const cB = this._tmpColorB.lerpColors(this.outerColor, this.innerColor, alphaB);

        this.trailColors[vA]     = cA.r * alphaA;
        this.trailColors[vA + 1] = cA.g * alphaA;
        this.trailColors[vA + 2] = cA.b * alphaA;

        this.trailColors[vB]     = cB.r * alphaB;
        this.trailColors[vB + 1] = cB.g * alphaB;
        this.trailColors[vB + 2] = cB.b * alphaB;

        vertIdx += 2;
      }
    }

    // Zero remaining
    for (let v = vertIdx * 3; v < Math.min((vertIdx + 100) * 3, this.trailPositions.length); v++) {
      this.trailPositions[v] = 0;
      this.trailColors[v] = 0;
    }

    this.trailGeo.attributes.position.needsUpdate = true;
    this.trailGeo.attributes.color.needsUpdate = true;
    this.trailGeo.setDrawRange(0, vertIdx);
  }
}

// ─── Nebula Background ───────────────────────────────────────────────────────

class Nebula {
  constructor(scene) {
    this.enabled = false;
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
    const targetOpacity = this.enabled ? 1.0 : 0;

    for (const s of this.sprites) {
      const target = targetOpacity * (s.baseOpacity + volume * 0.25);
      s.mat.opacity = THREE.MathUtils.lerp(s.mat.opacity, target, 0.05);
      s.sprite.rotation.z += 0.0003;
    }
  }

  applyPalette(palette) {
    // Tint nebula sprites toward palette color
    const col = new THREE.Color(palette.rayOuter);
    for (const s of this.sprites) {
      s.mat.color = col;
    }
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

    this._initRenderer();
    this._initScene();
    this._initCores();
    this._initParticles();
    this._initNebula();
    this._initPostProcessing();
    this._bindEvents();
    this._applyModeAndPalette();
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    document.body.appendChild(this.renderer.domElement);
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
  _spawnSystem() {
    const r = Math.random();
    let type;
    if (r < 0.4) type = 'solar';
    else if (r < 0.75) type = 'binary';
    else type = 'trinary';
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
      const satCount = 2 + Math.floor(Math.random() * 2); // 2-3
      for (let i = 0; i < satCount; i++) {
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
      if (Math.random() < 0.5) {
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

  _spawnCore(params) {
    const core = new Core(this.scene, this.coreIdCounter++, params);
    this.cores.push(core);
    this._applyModeToCore(core);
    return core;
  }

  _applyModeToCore(core) {
    const mode = MODES[this.modeIndex];
    const palette = PALETTES[this.paletteIndex];
    core.applyMode(mode, palette);
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

    const aliveCount = this.cores.filter(c => c.phase !== 'dead').length;
    if (aliveCount === 0 && this.spawnCooldown <= 0) {
      this._spawnSystem();
      this.spawnCooldown = 1.5;
    }
  }

  _initParticles() {
    this.particles = new MagneticParticles(this.scene, this.cores, this.particleCount);
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

  _applyModeAndPalette() {
    const mode = MODES[this.modeIndex];
    const palette = PALETTES[this.paletteIndex];

    for (const core of this.cores) {
      this._applyModeToCore(core);
    }
    this.particles.applyMode(mode, palette);
    this.nebula.applyPalette(palette);

    // Apply particle multiplier from mode
    const effectiveCount = Math.min(5000, Math.round(this.particleCount * (mode.particleMul || 1.0)));
    this.particles.setCount(effectiveCount);

    this.scene.background.set(palette.bg);
    this.scene.fog.color.set(palette.bg);

    this._updateInfo();
  }

  _updateInfo() {
    const mode = MODES[this.modeIndex];
    const palette = PALETTES[this.paletteIndex];
    const el = document.getElementById('info-text');
    el.innerHTML = `${mode.name} / ${palette.name}<br>${this.particles.activeCount} / ${this.particleCount} particles${this.nebula.enabled ? ' / nebula' : ''}${this.frozen ? ' / frozen' : ''}`;
  }

  _bindEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    });

    this.helpEl = document.getElementById('help-overlay');

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
          this.modeIndex = (this.modeIndex + 1) % MODES.length;
          this._applyModeAndPalette();
          break;
        case 'p':
          this.paletteIndex = (this.paletteIndex + 1) % PALETTES.length;
          this._applyModeAndPalette();
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
          this.modeIndex = (this.modeIndex - 1 + MODES.length) % MODES.length;
          this._applyModeAndPalette();
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
    this._animate();
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

    this.particles.update(this.audio, dt, {
      barycenter: this._barycenter,
      extent: this._extent,
      died,
      time: simTime,
    });

    // Nebula
    this.nebula.update(this.audio);

    this._infoFrames = (this._infoFrames || 0) + 1;
    if (this._infoFrames % 30 === 0) this._updateInfo();

    // Starfield drift
    this.starfield.rotation.y += 0.00008;

    // Bloom reacts to volume
    this.bloomPass.strength = 0.5 + volume * 0.6 + hit * 0.4;

    this.composer.render();
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────────

const viz = new Visualizer();
viz.start();

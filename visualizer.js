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

// ─── Audio Analyzer ──────────────────────────────────────────────────────────

class AudioAnalyzer {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.dataArray = null;
    this.source = null;
    this.active = false;
    this.smoothBass = 0;
    this.smoothMid = 0;
    this.smoothTreble = 0;
    this.smoothVolume = 0;
    this.smoothBins = null;  // smoothed per-bin FFT data
    this.beat = false;
    this.beatHeld = 0;
    this.prevBassEnergy = 0;
    this.audioElement = null;
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
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;
    this.source.connect(this.analyser);
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.smoothBins = new Float32Array(this.analyser.frequencyBinCount);
  }

  update() {
    if (!this.active || !this.analyser) return;
    this.analyser.getByteFrequencyData(this.dataArray);

    // Smooth per-bin frequency data
    if (this.smoothBins) {
      const binLerp = 0.12;
      for (let i = 0; i < this.dataArray.length; i++) {
        const raw = this.dataArray[i] / 255;
        this.smoothBins[i] += (raw - this.smoothBins[i]) * binLerp;
      }
    }

    const len = this.dataArray.length;
    let bass = 0, mid = 0, treble = 0, total = 0;
    const bassEnd = Math.floor(len * 0.08);
    const midEnd = Math.floor(len * 0.4);

    for (let i = 0; i < len; i++) {
      const v = this.dataArray[i] / 255;
      total += v;
      if (i < bassEnd) bass += v;
      else if (i < midEnd) mid += v;
      else treble += v;
    }

    bass /= bassEnd;
    mid /= (midEnd - bassEnd);
    treble /= (len - midEnd);
    total /= len;

    // Asymmetric smoothing: rise faster than decay so hits land but falloff is gentle
    const bassUp = bass > this.smoothBass ? 0.12 : 0.05;
    const midUp  = mid  > this.smoothMid  ? 0.14 : 0.06;
    const trebUp = treble > this.smoothTreble ? 0.16 : 0.07;
    const volUp  = total > this.smoothVolume  ? 0.12 : 0.05;
    this.smoothBass = THREE.MathUtils.lerp(this.smoothBass, bass, bassUp);
    this.smoothMid = THREE.MathUtils.lerp(this.smoothMid, mid, midUp);
    this.smoothTreble = THREE.MathUtils.lerp(this.smoothTreble, treble, trebUp);
    this.smoothVolume = THREE.MathUtils.lerp(this.smoothVolume, total, volUp);

    const bassEnergy = bass;
    const delta = bassEnergy - this.prevBassEnergy;
    if (delta > 0.13 && bassEnergy > 0.35) {
      this.beat = true;
      this.beatHeld = 8;
    } else {
      this.beatHeld = Math.max(0, this.beatHeld - 1);
      this.beat = this.beatHeld > 0;
    }
    this.prevBassEnergy = bassEnergy;
  }

  // Get amplitude for a specific frequency bin (0..1)
  getFreqBin(bin) {
    if (!this.active || !this.smoothBins) return 0;
    const idx = Math.min(bin, this.smoothBins.length - 1);
    return this.smoothBins[idx];
  }

  getBass()   { return this.active ? this.smoothBass : 0; }
  getMid()    { return this.active ? this.smoothMid : 0; }
  getTreble() { return this.active ? this.smoothTreble : 0; }
  getVolume() { return this.active ? this.smoothVolume : 0; }
  isBeat()    { return this.active ? this.beat : false; }
}

// ─── Demo Analyzer ───────────────────────────────────────────────────────────

class DemoAnalyzer extends AudioAnalyzer {
  constructor() {
    super();
    this.active = true;
    this.t = 0;
    // Fake frequency data for per-particle FFT
    this.dataArray = new Uint8Array(1024);
    this.smoothBins = new Float32Array(1024);
  }

  update() {
    this.t += 0.016;
    const t = this.t;

    this.smoothBass   = 0.3 + 0.35 * Math.sin(t * 1.2) * Math.sin(t * 0.4);
    this.smoothMid    = 0.2 + 0.3  * Math.sin(t * 1.8 + 1) * Math.sin(t * 0.6);
    this.smoothTreble = 0.15 + 0.2 * Math.sin(t * 2.5 + 2) * Math.sin(t * 0.8);
    this.smoothVolume = (this.smoothBass + this.smoothMid + this.smoothTreble) / 3;

    // Fill fake frequency bins with smooth oscillations
    for (let i = 0; i < this.dataArray.length; i++) {
      const freq = i / this.dataArray.length;
      const wave = Math.sin(t * (1 + freq * 3) + i * 0.1) * 0.5 + 0.5;
      this.smoothBins[i] += (wave - this.smoothBins[i]) * 0.08;
    }
  }
}

// ─── Physics constants ───────────────────────────────────────────────────────

// Gravitational constant for the inter-core n-body sim. Tuned for visual
// orbits in the 10–30s period range at our scene scale (radii 1–3, separations
// 3–8). Audio bass scales this up to ~1.4× for "system breathes" on hits.
const PHYSICS_G = 1.4;

// ─── Core (Planet with shader-based surface) ─────────────────────────────────

const PLANET_VERTEX = /* glsl */ `
  uniform float uBass;
  uniform float uBeat;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;

  void main() {
    vec3 pos = position;

    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const PLANET_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uBass;
  uniform float uMid;
  uniform float uTreble;
  uniform float uBeat;
  uniform vec3 uColorCore;
  uniform vec3 uColorInner;
  uniform vec3 uColorOuter;
  uniform float uMetalness;
  uniform float uRoughness;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vViewDir;

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

    // Audio-reactive pulse.
    float pulse = 1.0 + uBass * 0.5 + uMid * 0.2;
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

    const geo = new THREE.IcosahedronGeometry(this.radius, 4);
    this.geometry = geo;

    this.uniforms = {
      uTime:       { value: 0 },
      uBass:       { value: 0 },
      uMid:        { value: 0 },
      uTreble:     { value: 0 },
      uBeat:       { value: 0 },
      uColorCore:  { value: new THREE.Color(0x888899) },
      uColorInner: { value: new THREE.Color(0x6699ff) },
      uColorOuter: { value: new THREE.Color(0x2244aa) },
      uMetalness:  { value: 0.85 },
      uRoughness:  { value: 0.15 },
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

    this.mesh.scale.setScalar(Math.max(0.001, this.scaleT));
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y += 0.005;
    this.mesh.rotation.x += 0.003;

    this.uniforms.uTime.value = time;
    this.uniforms.uBass.value = audio.getBass();
    this.uniforms.uMid.value = audio.getMid();
    this.uniforms.uTreble.value = audio.getTreble();
    this.uniforms.uBeat.value = audio.getBass();
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

class MagneticParticles {
  constructor(scene, cores, initialCount) {
    this.scene = scene;
    this.cores = cores;
    this.maxCount = 5000;
    this.count = initialCount;
    this.trailLength = 30;
    this.rayStyle = 'ribbon';

    // Per-particle state
    this.positions = new Float32Array(this.maxCount * 3);
    this.velocities = new Float32Array(this.maxCount * 3);
    this.charges = new Float32Array(this.maxCount);
    this.lifetimes = new Float32Array(this.maxCount);
    this.freqBins = new Uint16Array(this.maxCount); // which FFT bin each particle responds to
    this.trails = []; // Array of arrays for trail history

    for (let i = 0; i < this.maxCount; i++) {
      this._initParticle(i);
      this.trails[i] = [];
    }

    // --- Point particles ---
    this.pointGeo = new THREE.BufferGeometry();
    this.pointPositions = new Float32Array(this.maxCount * 3);
    this.pointColors = new Float32Array(this.maxCount * 3);
    this.pointSizes = new Float32Array(this.maxCount);
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
          float alpha = (1.0 - d * d) * 0.8;
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.pointGeo, this.pointMat);
    scene.add(this.points);

    // --- Trail lines (ribbons) ---
    // We'll use a LineSegments geometry for efficiency
    this.maxTrailVerts = this.maxCount * 60 * 2; // pairs of vertices for segments
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

  _initParticle(i) {
    // Spawn near a random core
    const core = this.cores[Math.floor(Math.random() * this.cores.length)];
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = core.radius * (1.0 + Math.random() * 0.5);

    const i3 = i * 3;
    this.positions[i3]     = core.position.x + r * Math.sin(phi) * Math.cos(theta);
    this.positions[i3 + 1] = core.position.y + r * Math.sin(phi) * Math.sin(theta);
    this.positions[i3 + 2] = core.position.z + r * Math.cos(phi);

    // Small initial velocity
    const speed = 0.01 + Math.random() * 0.02;
    this.velocities[i3]     = (Math.random() - 0.5) * speed;
    this.velocities[i3 + 1] = (Math.random() - 0.5) * speed;
    this.velocities[i3 + 2] = (Math.random() - 0.5) * speed;

    this.charges[i] = (Math.random() > 0.5 ? 1 : -1) * (0.5 + Math.random() * 0.5);
    this.lifetimes[i] = 0.5 + Math.random() * 0.5;
    this.freqBins[i] = Math.floor(Math.random() * 1024);
  }

  setCount(n) {
    this.count = Math.max(100, Math.min(this.maxCount, n));
  }

  applyMode(mode, palette) {
    this.trailLength = mode.trailLen;
    this.rayStyle = mode.rayStyle;
    this.innerColor.set(palette.rayInner);
    this.outerColor.set(palette.rayOuter);

    this.points.visible = (mode.rayStyle === 'point' || mode.rayStyle === 'ribbon' || mode.rayStyle === 'line');
    this.trailLines.visible = (mode.rayStyle === 'ribbon' || mode.rayStyle === 'line');
  }

  update(audio, dt) {
    const treble = audio.getTreble();
    const volume = audio.getVolume();

    const forceStrength = 0.0004 + volume * 0.003;
    const damping = 0.985;
    const maxSpeed = 0.15 + volume * 0.3;

    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;

      // Per-particle FFT influence
      const freqAmp = audio.getFreqBin(this.freqBins[i]);
      const chargeBoost = 1.0 + freqAmp * 2.0;
      const pCharge = this.charges[i] * chargeBoost;

      // Sum forces from all cores
      let fx = 0, fy = 0, fz = 0;
      for (const core of this.cores) {
        const dx = core.position.x - this.positions[i3];
        const dy = core.position.y - this.positions[i3 + 1];
        const dz = core.position.z - this.positions[i3 + 2];
        const distSq = dx * dx + dy * dy + dz * dz + 0.1;
        const dist = Math.sqrt(distSq);

        // Coulomb-like: F = k * q1 * q2 / r^2
        const F = forceStrength * pCharge * core.charge / distSq;

        fx += (dx / dist) * F;
        fy += (dy / dist) * F;
        fz += (dz / dist) * F;

        // Tangential force (creates orbiting behavior)
        const tx = -dz / dist;
        const tz = dx / dist;
        const tangentF = forceStrength * 0.5 * Math.abs(pCharge);
        fx += tx * tangentF;
        fz += tz * tangentF;
      }

      // Apply forces
      this.velocities[i3]     = (this.velocities[i3] + fx) * damping;
      this.velocities[i3 + 1] = (this.velocities[i3 + 1] + fy) * damping;
      this.velocities[i3 + 2] = (this.velocities[i3 + 2] + fz) * damping;

      // Clamp speed
      const vx = this.velocities[i3], vy = this.velocities[i3 + 1], vz = this.velocities[i3 + 2];
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (speed > maxSpeed) {
        const scale = maxSpeed / speed;
        this.velocities[i3] *= scale;
        this.velocities[i3 + 1] *= scale;
        this.velocities[i3 + 2] *= scale;
      }

      // Integrate position
      this.positions[i3]     += this.velocities[i3];
      this.positions[i3 + 1] += this.velocities[i3 + 1];
      this.positions[i3 + 2] += this.velocities[i3 + 2];

      // Lifetime
      this.lifetimes[i] -= 0.002 + treble * 0.005;
      if (this.lifetimes[i] <= 0 || speed < 0.0001 ||
          Math.abs(this.positions[i3]) > 40) {
        this._initParticle(i);
        this.trails[i] = [];
      }

      // Store trail
      if (this.trailLength > 0) {
        this.trails[i].push(
          this.positions[i3],
          this.positions[i3 + 1],
          this.positions[i3 + 2]
        );
        // Each position is 3 floats, so max entries = trailLength * 3
        const maxEntries = this.trailLength * 3;
        if (this.trails[i].length > maxEntries) {
          this.trails[i].splice(0, this.trails[i].length - maxEntries);
        }
      }

      // Update point visuals
      const life = this.lifetimes[i];
      this.pointPositions[i3]     = this.positions[i3];
      this.pointPositions[i3 + 1] = this.positions[i3 + 1];
      this.pointPositions[i3 + 2] = this.positions[i3 + 2];

      // Color by charge and frequency
      const t = freqAmp;
      const c = this._tmpColorParticle.lerpColors(this.outerColor, this.innerColor, t);
      this.pointColors[i3]     = c.r * life;
      this.pointColors[i3 + 1] = c.g * life;
      this.pointColors[i3 + 2] = c.b * life;

      this.pointSizes[i] = (1.0 + freqAmp * 3.0) * life;
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

      const life = this.lifetimes[i];
      const freqAmp = 0.5; // simplified for trail color

      for (let j = 0; j < numPoints - 1 && vertIdx < maxVerts - 1; j++) {
        const j3 = j * 3;
        const alphaA = (j / numPoints) * life;
        const alphaB = ((j + 1) / numPoints) * life;

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
    this.particleCount = 1500;
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
    const G = PHYSICS_G * (1.0 + bass * 0.4);
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
      0.9,   // strength
      0.5,   // radius
      0.45   // threshold - only the brightest particle cores bloom
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
    el.innerHTML = `${mode.name} / ${palette.name}<br>${this.particleCount} particles${this.nebula.enabled ? ' / nebula' : ''}${this.frozen ? ' / frozen' : ''}`;
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
    this.audio.update();

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

    // Visual sync for cores (mesh transform + shader uniforms)
    for (const core of this.cores) {
      core.update(simTime, dt, this.audio);
    }

    this._updateCamera(wallTime, dt);

    this.centralLight.intensity = 2.5 + bass * 4.0 + volume * 2.0;
    const hue = 0.6 + treble * 0.1;
    this.centralLight.color.setHSL(hue, 0.5, 0.5 + volume * 0.3);

    this.particles.update(this.audio, dt);

    // Nebula
    this.nebula.update(this.audio);

    // Starfield drift
    this.starfield.rotation.y += 0.00008;

    // Bloom reacts to volume
    this.bloomPass.strength = 0.9 + volume * 1.2;

    this.composer.render();
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────────

const viz = new Visualizer();
viz.start();

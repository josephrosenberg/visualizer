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
  }

  update() {
    if (!this.active || !this.analyser) return;
    this.analyser.getByteFrequencyData(this.dataArray);

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

    const lerp = 0.14;
    this.smoothBass = THREE.MathUtils.lerp(this.smoothBass, bass, lerp);
    this.smoothMid = THREE.MathUtils.lerp(this.smoothMid, mid, lerp);
    this.smoothTreble = THREE.MathUtils.lerp(this.smoothTreble, treble, lerp);
    this.smoothVolume = THREE.MathUtils.lerp(this.smoothVolume, total, lerp);

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
    if (!this.active || !this.dataArray) return 0;
    const idx = Math.min(bin, this.dataArray.length - 1);
    return this.dataArray[idx] / 255;
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
  }

  update() {
    this.t += 0.016;
    const t = this.t;

    this.smoothBass   = 0.3 + 0.35 * Math.sin(t * 1.2) * Math.sin(t * 0.4);
    this.smoothMid    = 0.2 + 0.3  * Math.sin(t * 1.8 + 1) * Math.sin(t * 0.6);
    this.smoothTreble = 0.15 + 0.2 * Math.sin(t * 2.5 + 2) * Math.sin(t * 0.8);
    this.smoothVolume = (this.smoothBass + this.smoothMid + this.smoothTreble) / 3;
    this.beat = Math.sin(t * 3.2) > 0.93;

    // Fill fake frequency bins
    for (let i = 0; i < this.dataArray.length; i++) {
      const freq = i / this.dataArray.length;
      const wave = Math.sin(t * (1 + freq * 3) + i * 0.1) * 0.5 + 0.5;
      this.dataArray[i] = Math.floor(wave * 180 + Math.random() * 40);
    }
  }
}

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

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vViewDir);

    // Fresnel (Schlick approximation)
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);

    // Simple lighting from center (point light at origin)
    vec3 lightDir = normalize(-vWorldPos);
    float NdotL = max(dot(N, lightDir), 0.0);

    // Specular (Blinn-Phong)
    vec3 H = normalize(lightDir + V);
    float NdotH = max(dot(N, H), 0.0);
    float specPower = mix(16.0, 128.0, 1.0 - uRoughness);
    float spec = pow(NdotH, specPower) * mix(0.3, 1.0, uMetalness);

    vec3 baseColor = uColorCore;

    // Gentle volume-based emissive glow
    float emissiveStrength = uBass * 0.15 + uMid * 0.1;
    vec3 emissive = uColorInner * emissiveStrength;

    // Combine
    vec3 diffuse = baseColor * NdotL * 0.8;
    vec3 specColor = mix(vec3(0.04), baseColor, uMetalness);
    vec3 specular = specColor * spec;

    // Fresnel rim glow — reacts to bass
    vec3 rimColor = mix(uColorInner, uColorOuter, 0.5);
    vec3 rim = rimColor * fresnel * (0.6 + uBass * 0.8);

    // Ambient
    vec3 ambient = baseColor * 0.08;

    vec3 color = ambient + diffuse + specular + rim + emissive;

    // Tone mapping (simple Reinhard)
    color = color / (color + vec3(1.0));

    gl_FragColor = vec4(color, 1.0);
  }
`;

class Core {
  constructor(scene, index) {
    this.index = index;
    this.scene = scene;
    this.alive = true;

    // Lifecycle state
    this.phase = 'spawning'; // 'spawning' | 'alive' | 'collapsing' | 'dead'
    this.phaseTime = 0;
    this.spawnDuration = 3.0 + Math.random() * 2.0;
    this.lifeDuration = 30 + Math.random() * 40; // 30-70 seconds alive
    this.collapseDuration = 3.0 + Math.random() * 2.0;
    this.scaleT = 0; // 0..1 animated scale factor

    this.charge = (Math.random() > 0.5) ? 1.0 : -0.8;
    this.orbitRadius = 2.5 + Math.random() * 3.5;
    this.orbitSpeed = 0.06 + Math.random() * 0.12;
    this.orbitPhase = Math.random() * Math.PI * 2;
    this.orbitTilt = (Math.random() - 0.5) * 0.8;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.radius = 0.8 + Math.random() * 0.7;

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
    scene.add(this.mesh);

    // Set initial position so particles can find it immediately
    const angle = this.orbitPhase;
    this.position.set(
      Math.cos(angle) * this.orbitRadius,
      Math.sin(this.orbitTilt) * Math.sin(angle * 1.3) * this.orbitRadius * 0.4,
      Math.sin(angle) * this.orbitRadius
    );
    this.mesh.position.copy(this.position);
  }

  update(time, dt, audio, frozen) {
    // Lifecycle
    this.phaseTime += dt;

    if (this.phase === 'spawning') {
      this.scaleT = Math.min(1, this.phaseTime / this.spawnDuration);
      // Elastic ease-out
      const t = this.scaleT;
      this.scaleT = t < 1 ? 1 - Math.pow(1 - t, 3) * Math.cos(t * Math.PI * 0.5) : 1;
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
      // Accelerating collapse
      this.scaleT = 1 - t * t * t;
      if (this.phaseTime >= this.collapseDuration) {
        this.phase = 'dead';
        this.alive = false;
        this.mesh.visible = false;
      }
    }

    if (!this.alive) return;

    this.mesh.scale.setScalar(Math.max(0.001, this.scaleT));

    if (!frozen) {
      const bass = audio.getBass();
      const angle = time * this.orbitSpeed + this.orbitPhase;
      const r = this.orbitRadius * (1.0 + bass * 0.5);
      this.position.set(
        Math.cos(angle) * r,
        Math.sin(this.orbitTilt) * Math.sin(angle * 1.3) * r * 0.4,
        Math.sin(angle) * r
      );
    }

    this.mesh.position.copy(this.position);
    this.mesh.rotation.y += 0.005;
    this.mesh.rotation.x += 0.003;

    // Update shader uniforms
    this.uniforms.uTime.value = time;
    this.uniforms.uBass.value = audio.getBass();
    this.uniforms.uMid.value = audio.getMid();
    this.uniforms.uTreble.value = audio.getTreble();
    this.uniforms.uBeat.value = audio.isBeat() ? 1.0 : 0.0;
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
    const bass = audio.getBass();
    const mid = audio.getMid();
    const treble = audio.getTreble();
    const volume = audio.getVolume();
    const beat = audio.isBeat();

    const forceStrength = 0.0004 + volume * 0.002 + (beat ? 0.002 : 0);
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

      this.pointSizes[i] = (1.0 + freqAmp * 3.0 + (beat ? 1.5 : 0)) * life;
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

    // Camera state
    this.camPos = new THREE.Vector3(0, 4, 16);
    this.camTargetPos = new THREE.Vector3(0, 4, 16);
    this.camLookAt = new THREE.Vector3(0, 0, 0);
    this.camTargetLookAt = new THREE.Vector3(0, 0, 0);
    this.camMoveTimer = 0;
    this.camMoveDuration = 8;
    this.camMode = 'orbit';  // 'orbit' | 'track' | 'flyby' | 'overhead' | 'dolly'
    this.camTrackCore = null;
    this.camOrbitAngle = 0;

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
    this.scene.fog = new THREE.FogExp2(0x000008, 0.008);

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera.position.set(0, 4, 16);
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
    this.minCores = 2;
    this.maxCores = 5;
    this.spawnCooldown = 0;
    // Spawn initial planets
    for (let i = 0; i < 3; i++) {
      this._spawnCore();
    }
  }

  _spawnCore() {
    const core = new Core(this.scene, this.coreIdCounter++);
    this.cores.push(core);
    this._applyModeToCore(core);
    return core;
  }

  _applyModeToCore(core) {
    const mode = MODES[this.modeIndex];
    const palette = PALETTES[this.paletteIndex];
    core.applyMode(mode, palette);
  }

  _updateCoreLifecycles(dt, audio) {
    this.spawnCooldown = Math.max(0, this.spawnCooldown - dt);

    // Remove dead cores
    for (let i = this.cores.length - 1; i >= 0; i--) {
      if (!this.cores[i].alive && this.cores[i].phase === 'dead') {
        this.cores[i].destroy();
        this.cores.splice(i, 1);
      }
    }

    // Count alive (not dead) cores
    const aliveCores = this.cores.filter(c => c.phase !== 'dead').length;

    // Spawn new ones if below minimum, or randomly on beats
    if (aliveCores < this.minCores && this.spawnCooldown <= 0) {
      this._spawnCore();
      this.spawnCooldown = 2.0;
    } else if (aliveCores < this.maxCores && this.spawnCooldown <= 0) {
      // Chance to spawn on beat, or every ~12s
      const beatSpawn = audio.isBeat() && Math.random() < 0.08;
      const timedSpawn = Math.random() < dt * 0.08; // ~every 12s on average
      if (beatSpawn || timedSpawn) {
        this._spawnCore();
        this.spawnCooldown = 5.0;
      }
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
      1.5,   // strength - higher for that glow-everything look
      0.6,   // radius
      0.15   // threshold - low so everything glows
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

  _pickRandomAliveCore() {
    const alive = this.cores.filter(c => c.alive);
    return alive.length > 0 ? alive[Math.floor(Math.random() * alive.length)] : null;
  }

  _switchCameraMode(wallTime) {
    const modes = ['orbit', 'track', 'flyby', 'overhead', 'dolly', 'orbit', 'track'];
    this.camMode = modes[Math.floor(Math.random() * modes.length)];
    this.camTrackCore = this._pickRandomAliveCore();
    this.camMoveDuration = 10 + Math.random() * 15; // 10-25 seconds per move
    this.camMoveTimer = 0;
    this.camOrbitAngle = wallTime * 0.08; // sync orbit angle
  }

  _updateCamera(wallTime, dt, audio) {
    const mid = audio.getMid();
    const volume = audio.getVolume();

    this.camMoveTimer += dt;

    // Switch camera mode periodically
    if (this.camMoveTimer >= this.camMoveDuration) {
      this._switchCameraMode(wallTime);
    }

    // If tracking a dead core, switch early
    if (this.camTrackCore && !this.camTrackCore.alive) {
      this._switchCameraMode(wallTime);
    }

    // Compute target position and look-at based on mode
    this.camOrbitAngle += dt * (0.04 + volume * 0.02);

    switch (this.camMode) {
      case 'orbit': {
        // Wide orbit — see the whole system
        const dist = 16 + Math.sin(wallTime * 0.02) * 3;
        const height = 3 + Math.sin(wallTime * 0.03) * 2 + mid * 0.5;
        this.camTargetPos.set(
          Math.sin(this.camOrbitAngle) * dist,
          height,
          Math.cos(this.camOrbitAngle) * dist
        );
        this.camTargetLookAt.set(0, 0, 0);
        break;
      }
      case 'track': {
        // Follow a planet at a respectful distance
        const core = this.camTrackCore;
        if (core && core.alive) {
          const trackDist = 3.0 + core.radius * 2.5;
          this.camTargetPos.set(
            core.position.x + Math.sin(this.camOrbitAngle * 0.8) * trackDist,
            core.position.y + 1.5 + Math.sin(wallTime * 0.06) * 1.0,
            core.position.z + Math.cos(this.camOrbitAngle * 0.8) * trackDist
          );
          this.camTargetLookAt.copy(core.position);
        } else {
          this.camTargetPos.set(Math.sin(this.camOrbitAngle) * 14, 3, Math.cos(this.camOrbitAngle) * 14);
          this.camTargetLookAt.set(0, 0, 0);
        }
        break;
      }
      case 'flyby': {
        // Slow, graceful arc past a planet
        const core = this.camTrackCore;
        const t = this.camMoveTimer / this.camMoveDuration;
        if (core && core.alive) {
          const sweepAngle = t * Math.PI;
          const dist = 3.5 + core.radius * 2 + Math.sin(t * Math.PI) * 2;
          this.camTargetPos.set(
            core.position.x + Math.sin(sweepAngle) * dist,
            core.position.y + 1.0 + Math.cos(sweepAngle * 0.5) * 2,
            core.position.z + Math.cos(sweepAngle) * dist
          );
          this.camTargetLookAt.copy(core.position);
        } else {
          this.camTargetPos.set(Math.sin(this.camOrbitAngle) * 12, 2, Math.cos(this.camOrbitAngle) * 12);
          this.camTargetLookAt.set(0, 0, 0);
        }
        break;
      }
      case 'overhead': {
        // High angle with slow drift
        const dist = 18 + Math.sin(wallTime * 0.015) * 3;
        this.camTargetPos.set(
          Math.sin(this.camOrbitAngle * 0.2) * 4,
          dist,
          Math.cos(this.camOrbitAngle * 0.2) * 4
        );
        this.camTargetLookAt.set(0, 0, 0);
        break;
      }
      case 'dolly': {
        // Slow push-in toward a planet, then pull back
        const t = this.camMoveTimer / this.camMoveDuration;
        const pushPull = Math.sin(t * Math.PI);
        const dist = 20 - pushPull * 12;
        this.camTargetPos.set(
          Math.sin(this.camOrbitAngle * 0.4) * dist * 0.5,
          2.0 + Math.sin(wallTime * 0.05) * 1.5,
          Math.cos(this.camOrbitAngle * 0.4) * dist
        );
        const nearest = this._pickRandomAliveCore();
        this.camTargetLookAt.copy(nearest ? nearest.position : new THREE.Vector3());
        break;
      }
    }

    // Smooth interpolation — all gentle
    const lerpSpeed = this.camMode === 'flyby' ? 0.02 : this.camMode === 'dolly' ? 0.012 : 0.018;
    this.camPos.lerp(this.camTargetPos, lerpSpeed);
    this.camLookAt.lerp(this.camTargetLookAt, lerpSpeed);

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLookAt);
  }

  _animate() {
    requestAnimationFrame(() => this._animate());

    const wallTime = this.clock.getElapsedTime();
    const dt = this.clock.getDelta();
    this.audio.update();

    // Compute simulation time that pauses when frozen
    let simTime;
    if (this.frozen) {
      simTime = this.frozenAtTime - this.frozenOffset;
    } else {
      simTime = wallTime - this.frozenOffset;
    }

    const bass = this.audio.getBass();
    const volume = this.audio.getVolume();
    const treble = this.audio.getTreble();
    const beat = this.audio.isBeat();

    // Update planet lifecycles (spawn/collapse)
    this._updateCoreLifecycles(dt, this.audio);

    // Camera
    this._updateCamera(wallTime, dt, this.audio);

    // Central light reacts
    this.centralLight.intensity = 2.0 + bass * 4.0 + (beat ? 3.0 : 0);
    const hue = 0.6 + treble * 0.1;
    this.centralLight.color.setHSL(hue, 0.5, 0.5 + volume * 0.3);

    // Update cores
    for (const core of this.cores) {
      core.update(simTime, dt, this.audio, this.frozen);
    }

    // Update magnetic particles
    this.particles.update(this.audio, dt);

    // Nebula
    this.nebula.update(this.audio);

    // Starfield drift
    this.starfield.rotation.y += 0.00008;

    // Bloom reacts to volume
    this.bloomPass.strength = 1.3 + volume * 1.5 + (beat ? 0.6 : 0);

    this.composer.render();
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────────

const viz = new Visualizer();
viz.start();

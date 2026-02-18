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

// ─── Core (Metallic Sphere) ──────────────────────────────────────────────────

class Core {
  constructor(scene, index, totalCores) {
    this.index = index;
    this.charge = (index % 2 === 0) ? 1.0 : -0.8;
    this.orbitRadius = 1.5 + index * 0.8;
    this.orbitSpeed = 0.3 + index * 0.15;
    this.orbitPhase = (index / totalCores) * Math.PI * 2;
    this.orbitTilt = (Math.random() - 0.5) * 1.2;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.radius = 0.4 + Math.random() * 0.3;

    // Metallic sphere with enough subdivisions for visible displacement
    const geo = new THREE.IcosahedronGeometry(this.radius, 5);
    this.geometry = geo;

    // Store original vertex positions for displacement reference
    const posAttr = geo.getAttribute('position');
    this.originalPositions = new Float32Array(posAttr.array.length);
    this.originalPositions.set(posAttr.array);

    // Precompute per-vertex normals and spherical coords for displacement patterns
    this.vertexNormals = new Float32Array(posAttr.count * 3);
    this.vertexTheta = new Float32Array(posAttr.count);
    this.vertexPhi = new Float32Array(posAttr.count);
    for (let i = 0; i < posAttr.count; i++) {
      const i3 = i * 3;
      const x = this.originalPositions[i3];
      const y = this.originalPositions[i3 + 1];
      const z = this.originalPositions[i3 + 2];
      const len = Math.sqrt(x * x + y * y + z * z) || 1;
      this.vertexNormals[i3] = x / len;
      this.vertexNormals[i3 + 1] = y / len;
      this.vertexNormals[i3 + 2] = z / len;
      this.vertexTheta[i] = Math.atan2(z, x);
      this.vertexPhi[i] = Math.acos(Math.max(-1, Math.min(1, y / len)));
    }

    // Unique seed per planet for distinct displacement patterns
    this.displaceSeed = index * 137.5 + 42.0;

    this.material = new THREE.MeshStandardMaterial({
      color: 0x888899,
      metalness: 0.85,
      roughness: 0.15,
      envMapIntensity: 1.0,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.castShadow = true;
    scene.add(this.mesh);
  }

  update(time, audio, frozen) {
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

    // Vertex displacement driven by audio
    this._displaceVertices(time, audio);
  }

  _displaceVertices(time, audio) {
    const bass = audio.getBass();
    const mid = audio.getMid();
    const treble = audio.getTreble();
    const beat = audio.isBeat();

    const posAttr = this.geometry.getAttribute('position');
    const positions = posAttr.array;
    const seed = this.displaceSeed;

    // Displacement amplitudes (fraction of radius)
    const bassAmp = bass * 0.18;            // broad, slow warping
    const midAmp = mid * 0.10;              // medium-frequency bumps
    const trebleAmp = treble * 0.06;        // fine detail ripples
    const beatPulse = beat ? 0.05 : 0;      // pop on beat

    const t = time * 0.8;

    for (let i = 0; i < posAttr.count; i++) {
      const i3 = i * 3;
      const nx = this.vertexNormals[i3];
      const ny = this.vertexNormals[i3 + 1];
      const nz = this.vertexNormals[i3 + 2];
      const theta = this.vertexTheta[i];
      const phi = this.vertexPhi[i];

      // Low-frequency warp (bass): 2-3 large lobes
      const bassDisp = Math.sin(theta * 2.0 + t * 1.2 + seed)
                      * Math.sin(phi * 1.5 + t * 0.7)
                      * bassAmp;

      // Mid-frequency bumps: 4-6 lobes
      const midDisp = Math.sin(theta * 5.0 + t * 2.0 + seed * 0.7)
                     * Math.cos(phi * 4.0 - t * 1.3 + seed * 0.3)
                     * midAmp;

      // High-frequency ripples (treble): many small bumps
      const trebleDisp = Math.sin(theta * 10.0 + t * 4.0 + seed * 1.3)
                        * Math.sin(phi * 8.0 + t * 3.0 - seed * 0.5)
                        * trebleAmp;

      const totalDisp = bassDisp + midDisp + trebleDisp + beatPulse;

      positions[i3]     = this.originalPositions[i3]     + nx * totalDisp;
      positions[i3 + 1] = this.originalPositions[i3 + 1] + ny * totalDisp;
      positions[i3 + 2] = this.originalPositions[i3 + 2] + nz * totalDisp;
    }

    posAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  applyMode(mode, palette) {
    this.mesh.visible = mode.coreVisible;
    this.material.wireframe = mode.wireframe;
    this.material.metalness = mode.metalness;
    this.material.roughness = mode.roughness;
    this.material.color.set(palette.core);
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
      const c = new THREE.Color().lerpColors(this.outerColor, this.innerColor, t);
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
        const cA = new THREE.Color().lerpColors(this.outerColor, this.innerColor, alphaA);
        const cB = new THREE.Color().lerpColors(this.outerColor, this.innerColor, alphaB);

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

// ─── Environment Map (for metallic reflections) ──────────────────────────────

function createEnvMap(renderer) {
  const size = 64;
  const rt = new THREE.WebGLCubeRenderTarget(size);
  const cubeCamera = new THREE.CubeCamera(0.1, 100, rt);

  // Create a simple gradient scene for reflection
  const envScene = new THREE.Scene();
  const gradGeo = new THREE.IcosahedronGeometry(50, 2);
  const gradMat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vPos;
      void main() {
        vec3 dir = normalize(vPos);
        vec3 col = mix(vec3(0.01, 0.01, 0.04), vec3(0.05, 0.07, 0.15), dir.y * 0.5 + 0.5);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
  });
  envScene.add(new THREE.Mesh(gradGeo, gradMat));
  envScene.add(new THREE.AmbientLight(0x222244));

  cubeCamera.position.set(0, 0, 0);
  cubeCamera.update(renderer, envScene);

  return rt.texture;
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

    // Camera drama state
    this.camOrbitSpeed = 0.08;         // base orbit speed
    this.camTargetOrbitSpeed = 0.08;
    this.camHeightOffset = 0;          // smooth height variation
    this.camTargetHeight = 0;
    this.camDistOffset = 0;            // smooth distance offset
    this.camTargetDist = 0;
    this.camShake = new THREE.Vector3(); // beat shake
    this.camDramaTimer = 0;            // timer for periodic drama changes
    this.camDramaPhase = 0;            // which drama "move" we're in

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

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 300);
    this.camera.position.set(0, 3, 12);
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

    // Env map for metallic reflections
    this.envMap = createEnvMap(this.renderer);
  }

  _initCores() {
    const numCores = 3;
    for (let i = 0; i < numCores; i++) {
      const core = new Core(this.scene, i, numCores);
      core.material.envMap = this.envMap;
      this.cores.push(core);
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
      core.applyMode(mode, palette);
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
    const mid = this.audio.getMid();
    const treble = this.audio.getTreble();
    const volume = this.audio.getVolume();
    const beat = this.audio.isBeat();

    // Camera drama: varied movement with periodic changes
    this.camDramaTimer += dt;

    // Every 8-15 seconds, pick a new camera "move"
    if (this.camDramaTimer > 8 + this.camDramaPhase * 3) {
      this.camDramaTimer = 0;
      this.camDramaPhase = (this.camDramaPhase + 1) % 5;

      switch (this.camDramaPhase) {
        case 0: // Normal orbit
          this.camTargetOrbitSpeed = 0.08;
          this.camTargetHeight = 0;
          this.camTargetDist = 0;
          break;
        case 1: // Slow pull-back, higher angle
          this.camTargetOrbitSpeed = 0.05;
          this.camTargetHeight = 2.5;
          this.camTargetDist = 3.0;
          break;
        case 2: // Faster sweep, level angle
          this.camTargetOrbitSpeed = 0.13;
          this.camTargetHeight = -0.5;
          this.camTargetDist = -1.0;
          break;
        case 3: // Slow drift, slight low angle
          this.camTargetOrbitSpeed = 0.04;
          this.camTargetHeight = -1.0;
          this.camTargetDist = 1.5;
          break;
        case 4: // Medium speed, high sweep
          this.camTargetOrbitSpeed = 0.10;
          this.camTargetHeight = 3.0;
          this.camTargetDist = -0.5;
          break;
      }
    }

    // Smooth lerp toward targets (slow transitions = not jarring)
    const camLerp = 0.012;
    this.camOrbitSpeed = THREE.MathUtils.lerp(this.camOrbitSpeed, this.camTargetOrbitSpeed, camLerp);
    this.camHeightOffset = THREE.MathUtils.lerp(this.camHeightOffset, this.camTargetHeight, camLerp);
    this.camDistOffset = THREE.MathUtils.lerp(this.camDistOffset, this.camTargetDist, camLerp);

    // Beat shake: small impulse that decays quickly
    if (beat) {
      this.camShake.set(
        (Math.random() - 0.5) * 0.15,
        (Math.random() - 0.5) * 0.10,
        (Math.random() - 0.5) * 0.15
      );
    }
    this.camShake.multiplyScalar(0.88); // decay

    const camTheta = wallTime * this.camOrbitSpeed;
    const camPhi = 0.3 + Math.sin(wallTime * 0.05) * 0.15 + this.camHeightOffset * 0.06;
    const camDist = 12 + this.camDistOffset - bass * 2.5;
    this.camera.position.set(
      Math.sin(camTheta) * Math.cos(camPhi) * camDist + this.camShake.x,
      Math.sin(camPhi) * camDist * 0.5 + 1.5 + mid + this.camHeightOffset * 0.3 + this.camShake.y,
      Math.cos(camTheta) * Math.cos(camPhi) * camDist + this.camShake.z
    );
    this.camera.lookAt(0, 0, 0);

    // Central light reacts
    this.centralLight.intensity = 2.0 + bass * 4.0 + (beat ? 3.0 : 0);
    const hue = 0.6 + treble * 0.1;
    this.centralLight.color.setHSL(hue, 0.5, 0.5 + volume * 0.3);

    // Update cores
    for (const core of this.cores) {
      core.update(simTime, this.audio, this.frozen);
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

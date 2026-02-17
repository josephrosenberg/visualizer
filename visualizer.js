import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

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
      // Stop the video track — we only need audio
      stream.getVideoTracks().forEach(t => t.stop());

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No audio track selected. Make sure to check "Share audio" in the dialog.');
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
    this.analyser.smoothingTimeConstant = 0.8;
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

    const lerp = 0.15;
    this.smoothBass = THREE.MathUtils.lerp(this.smoothBass, bass, lerp);
    this.smoothMid = THREE.MathUtils.lerp(this.smoothMid, mid, lerp);
    this.smoothTreble = THREE.MathUtils.lerp(this.smoothTreble, treble, lerp);
    this.smoothVolume = THREE.MathUtils.lerp(this.smoothVolume, total, lerp);

    // Beat detection: sudden bass spike
    const bassEnergy = bass;
    const delta = bassEnergy - this.prevBassEnergy;
    if (delta > 0.15 && bassEnergy > 0.4) {
      this.beat = true;
      this.beatHeld = 8;
    } else {
      this.beatHeld = Math.max(0, this.beatHeld - 1);
      this.beat = this.beatHeld > 0;
    }
    this.prevBassEnergy = bassEnergy;
  }

  // Returns 0..1 values for each band (with demo fallback)
  getBass()   { return this.active ? this.smoothBass : 0; }
  getMid()    { return this.active ? this.smoothMid : 0; }
  getTreble() { return this.active ? this.smoothTreble : 0; }
  getVolume() { return this.active ? this.smoothVolume : 0; }
  isBeat()    { return this.active ? this.beat : false; }
}

// ─── Demo audio (synthetic) ──────────────────────────────────────────────────

class DemoAnalyzer extends AudioAnalyzer {
  constructor() {
    super();
    this.active = true;
    this.t = 0;
  }

  update() {
    this.t += 0.016;
    const t = this.t;
    // Simulate musical energy with layered sine waves
    this.smoothBass   = 0.35 + 0.35 * Math.sin(t * 1.1) * Math.sin(t * 0.37);
    this.smoothMid    = 0.25 + 0.25 * Math.sin(t * 1.7 + 1) * Math.sin(t * 0.53);
    this.smoothTreble = 0.20 + 0.20 * Math.sin(t * 2.3 + 2) * Math.sin(t * 0.71);
    this.smoothVolume = (this.smoothBass + this.smoothMid + this.smoothTreble) / 3;

    this.beat = Math.sin(t * 3.0) > 0.92;
  }
}

// ─── Planet ──────────────────────────────────────────────────────────────────

class Planet {
  constructor(scene, config) {
    this.config = config;
    this.baseRadius = config.radius;
    this.orbitRadius = config.orbitRadius;
    this.orbitSpeed = config.orbitSpeed;
    this.orbitPhase = config.orbitPhase;
    this.orbitTilt = config.orbitTilt || 0;

    // Planet mesh with custom shader for pulsing surface
    const geo = new THREE.IcosahedronGeometry(1, 5);
    const mat = new THREE.MeshStandardMaterial({
      color: config.color,
      emissive: config.emissive,
      emissiveIntensity: 0.3,
      roughness: 0.5,
      metalness: 0.3,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.scale.setScalar(this.baseRadius);
    scene.add(this.mesh);

    // Atmosphere glow
    const glowGeo = new THREE.IcosahedronGeometry(1, 4);
    const glowMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uIntensity;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          float rim = 1.0 - max(dot(vNormal, vViewDir), 0.0);
          rim = pow(rim, 3.0) * uIntensity;
          gl_FragColor = vec4(uColor, rim);
        }
      `,
      uniforms: {
        uColor: { value: new THREE.Color(config.glowColor || config.color) },
        uIntensity: { value: 1.5 },
      },
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.glow = new THREE.Mesh(glowGeo, glowMat);
    this.glow.scale.setScalar(this.baseRadius * 1.25);
    scene.add(this.glow);

    // Surface particles
    this.surfaceParticleCount = config.surfaceParticles || 300;
    this.surfaceParticles = this._createSurfaceParticles(scene, config);

    this.position = new THREE.Vector3();
  }

  _createSurfaceParticles(scene, config) {
    const count = this.surfaceParticleCount;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const lifetimes = new Float32Array(count);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      this._initSurfaceParticle(positions, velocities, lifetimes, sizes, i);
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(lifetimes, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: `
        attribute float aLife;
        attribute float aSize;
        varying float vLife;
        void main() {
          vLife = aLife;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (200.0 / -mvPos.z);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vLife;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float alpha = (1.0 - d) * vLife * 0.7;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
      uniforms: {
        uColor: { value: new THREE.Color(config.particleColor || config.color) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geo, mat);
    scene.add(points);

    return {
      points,
      positions: geo.attributes.position,
      velocities,
      lifetimes,
      sizes,
      count,
    };
  }

  _initSurfaceParticle(positions, velocities, lifetimes, sizes, i) {
    // Random point on unit sphere
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = this.baseRadius * (1.0 + Math.random() * 0.1);
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);

    const i3 = i * 3;
    positions[i3]     = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z;

    // Outward velocity
    const speed = 0.002 + Math.random() * 0.005;
    velocities[i3]     = (x / r) * speed;
    velocities[i3 + 1] = (y / r) * speed;
    velocities[i3 + 2] = (z / r) * speed;

    lifetimes[i] = Math.random();
    sizes[i] = 1.0 + Math.random() * 3.0;
  }

  update(time, audio) {
    const bass = audio.getBass();
    const mid = audio.getMid();
    const treble = audio.getTreble();
    const beat = audio.isBeat();

    // Orbit
    const angle = time * this.orbitSpeed + this.orbitPhase;
    this.position.set(
      Math.cos(angle) * this.orbitRadius,
      Math.sin(this.orbitTilt) * Math.sin(angle) * this.orbitRadius * 0.3,
      Math.sin(angle) * this.orbitRadius
    );
    this.mesh.position.copy(this.position);
    this.glow.position.copy(this.position);

    // Pulse scale with bass
    const pulse = 1.0 + bass * 0.35 + (beat ? 0.15 : 0);
    this.mesh.scale.setScalar(this.baseRadius * pulse);
    this.glow.scale.setScalar(this.baseRadius * pulse * 1.25);

    // Emissive intensity reacts to mid
    this.mesh.material.emissiveIntensity = 0.3 + mid * 1.5 + (beat ? 0.5 : 0);
    this.glow.material.uniforms.uIntensity.value = 1.5 + bass * 3.0;

    // Rotate
    this.mesh.rotation.y += 0.003 + bass * 0.01;
    this.mesh.rotation.x += 0.001;

    // Surface particles
    this._updateSurfaceParticles(bass, treble, beat);
  }

  _updateSurfaceParticles(bass, treble, beat) {
    const sp = this.surfaceParticles;
    const pos = sp.positions.array;
    const vel = sp.velocities;
    const life = sp.lifetimes;
    const sizes = sp.sizes;
    const speedMult = 1.0 + bass * 4.0 + (beat ? 3.0 : 0);

    for (let i = 0; i < sp.count; i++) {
      const i3 = i * 3;
      life[i] -= 0.008 + treble * 0.02;

      if (life[i] <= 0) {
        // Respawn on planet surface
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = this.baseRadius;
        const nx = Math.sin(phi) * Math.cos(theta);
        const ny = Math.sin(phi) * Math.sin(theta);
        const nz = Math.cos(phi);

        pos[i3]     = this.position.x + nx * r;
        pos[i3 + 1] = this.position.y + ny * r;
        pos[i3 + 2] = this.position.z + nz * r;

        const speed = (0.003 + Math.random() * 0.008) * speedMult;
        vel[i3]     = nx * speed;
        vel[i3 + 1] = ny * speed;
        vel[i3 + 2] = nz * speed;

        life[i] = 0.7 + Math.random() * 0.3;
        sizes[i] = 1.0 + Math.random() * 3.0 + bass * 2.0;
      } else {
        pos[i3]     += vel[i3] * speedMult;
        pos[i3 + 1] += vel[i3 + 1] * speedMult;
        pos[i3 + 2] += vel[i3 + 2] * speedMult;
      }
    }

    sp.points.geometry.attributes.position.needsUpdate = true;
    sp.points.geometry.attributes.aLife.array = life;
    sp.points.geometry.attributes.aLife.needsUpdate = true;
    sp.points.geometry.attributes.aSize.array = sizes;
    sp.points.geometry.attributes.aSize.needsUpdate = true;
  }
}

// ─── Inter-planet Particle Streams ───────────────────────────────────────────

class ParticleStreams {
  constructor(scene, planets, count = 2000) {
    this.planets = planets;
    this.count = count;

    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const lifetimes = new Float32Array(count);
    const sizes = new Float32Array(count);
    const streamIndices = new Float32Array(count); // which planet pair

    this.velocities = new Float32Array(count * 3);
    this.targets = new Float32Array(count * 3);
    this.lifetimes = lifetimes;
    this.sizes = sizes;
    this.streamIndices = streamIndices;

    for (let i = 0; i < count; i++) {
      this._initParticle(positions, i);
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(lifetimes, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: `
        attribute float aLife;
        attribute float aSize;
        varying float vLife;
        void main() {
          vLife = aLife;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (200.0 / -mvPos.z);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        varying float vLife;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float glow = (1.0 - d * d) * vLife * 0.5;
          // Color shifts blue -> purple -> pink based on life
          vec3 col = mix(vec3(0.4, 0.5, 1.0), vec3(1.0, 0.5, 0.8), 1.0 - vLife);
          gl_FragColor = vec4(col, glow);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, mat);
    scene.add(this.points);
    this.posAttr = geo.attributes.position;
  }

  _initParticle(positions, i) {
    const pCount = this.planets.length;
    const srcIdx = Math.floor(Math.random() * pCount);
    let dstIdx = (srcIdx + 1 + Math.floor(Math.random() * (pCount - 1))) % pCount;
    this.streamIndices[i] = srcIdx * 10 + dstIdx; // encode pair

    const src = this.planets[srcIdx].position;
    const dst = this.planets[dstIdx].position;

    const i3 = i * 3;
    const t = Math.random();
    positions[i3]     = src.x + (dst.x - src.x) * t + (Math.random() - 0.5) * 0.5;
    positions[i3 + 1] = src.y + (dst.y - src.y) * t + (Math.random() - 0.5) * 0.5;
    positions[i3 + 2] = src.z + (dst.z - src.z) * t + (Math.random() - 0.5) * 0.5;

    this.lifetimes[i] = Math.random();
    this.sizes[i] = 0.5 + Math.random() * 2.0;
  }

  update(audio) {
    const bass = audio.getBass();
    const mid = audio.getMid();
    const volume = audio.getVolume();
    const beat = audio.isBeat();

    const pos = this.posAttr.array;
    const speed = 0.02 + volume * 0.12 + (beat ? 0.08 : 0);

    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      this.lifetimes[i] -= 0.005 + mid * 0.015;

      if (this.lifetimes[i] <= 0) {
        // Respawn
        const pCount = this.planets.length;
        const srcIdx = Math.floor(Math.random() * pCount);
        const dstIdx = (srcIdx + 1 + Math.floor(Math.random() * (pCount - 1))) % pCount;
        this.streamIndices[i] = srcIdx * 10 + dstIdx;

        const src = this.planets[srcIdx].position;
        pos[i3]     = src.x + (Math.random() - 0.5) * this.planets[srcIdx].baseRadius;
        pos[i3 + 1] = src.y + (Math.random() - 0.5) * this.planets[srcIdx].baseRadius;
        pos[i3 + 2] = src.z + (Math.random() - 0.5) * this.planets[srcIdx].baseRadius;

        this.lifetimes[i] = 0.7 + Math.random() * 0.3;
        this.sizes[i] = 0.5 + Math.random() * 2.0 + bass * 2.0;
      } else {
        // Move toward destination planet
        const pair = this.streamIndices[i];
        const dstIdx = pair % 10;
        const dst = this.planets[dstIdx].position;

        const dx = dst.x - pos[i3];
        const dy = dst.y - pos[i3 + 1];
        const dz = dst.z - pos[i3 + 2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.001;

        // Normalize and move
        pos[i3]     += (dx / dist) * speed + (Math.random() - 0.5) * 0.01 * (1 + bass * 3);
        pos[i3 + 1] += (dy / dist) * speed + (Math.random() - 0.5) * 0.01 * (1 + bass * 3);
        pos[i3 + 2] += (dz / dist) * speed + (Math.random() - 0.5) * 0.01 * (1 + bass * 3);

        // If close to destination, kill particle
        if (dist < this.planets[dstIdx].baseRadius * 1.2) {
          this.lifetimes[i] *= 0.9;
        }
      }
    }

    this.posAttr.needsUpdate = true;
    this.points.geometry.attributes.aLife.array = this.lifetimes;
    this.points.geometry.attributes.aLife.needsUpdate = true;
    this.points.geometry.attributes.aSize.array = this.sizes;
    this.points.geometry.attributes.aSize.needsUpdate = true;
  }
}

// ─── Starfield Background ────────────────────────────────────────────────────

function createStarfield(scene) {
  const count = 3000;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const r = 80 + Math.random() * 120;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
    sizes[i] = 0.5 + Math.random() * 1.5;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.ShaderMaterial({
    vertexShader: `
      attribute float aSize;
      varying float vSize;
      void main() {
        vSize = aSize;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (100.0 / -mvPos.z);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying float vSize;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float alpha = (1.0 - d * d) * 0.6;
        gl_FragColor = vec4(0.8, 0.85, 1.0, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });

  const points = new THREE.Points(geo, mat);
  scene.add(points);
  return points;
}

// ─── Main App ────────────────────────────────────────────────────────────────

class Visualizer {
  constructor() {
    this.audio = null;
    this.planets = [];
    this.streams = null;
    this.clock = new THREE.Clock();

    this._initRenderer();
    this._initScene();
    this._initPlanets();
    this._initPostProcessing();
    this._initHUD();
    this._bindEvents();
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    document.body.appendChild(this.renderer.domElement);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x000011, 0.004);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
    this.camera.position.set(0, 8, 22);
    this.camera.lookAt(0, 0, 0);

    // Lights
    const ambient = new THREE.AmbientLight(0x1a1a3a, 0.5);
    this.scene.add(ambient);

    const point = new THREE.PointLight(0xffffff, 1.5, 100);
    point.position.set(0, 0, 0);
    this.scene.add(point);
    this.centralLight = point;

    // Central glow orb (the "sun")
    const sunGeo = new THREE.IcosahedronGeometry(0.8, 3);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffffee });
    this.sun = new THREE.Mesh(sunGeo, sunMat);
    this.scene.add(this.sun);

    // Starfield
    this.starfield = createStarfield(this.scene);
  }

  _initPlanets() {
    const configs = [
      {
        radius: 1.2,
        orbitRadius: 6,
        orbitSpeed: 0.15,
        orbitPhase: 0,
        orbitTilt: 0.3,
        color: 0x4488ff,
        emissive: 0x2244aa,
        glowColor: 0x6699ff,
        particleColor: 0x88bbff,
        surfaceParticles: 400,
      },
      {
        radius: 0.9,
        orbitRadius: 10,
        orbitSpeed: 0.1,
        orbitPhase: Math.PI * 0.66,
        orbitTilt: -0.2,
        color: 0xff6644,
        emissive: 0xaa3322,
        glowColor: 0xff8866,
        particleColor: 0xffaa88,
        surfaceParticles: 300,
      },
      {
        radius: 1.5,
        orbitRadius: 15,
        orbitSpeed: 0.07,
        orbitPhase: Math.PI * 1.33,
        orbitTilt: 0.15,
        color: 0x44ddaa,
        emissive: 0x22aa66,
        glowColor: 0x66ffcc,
        particleColor: 0x88ffdd,
        surfaceParticles: 500,
      },
      {
        radius: 0.7,
        orbitRadius: 8,
        orbitSpeed: 0.2,
        orbitPhase: Math.PI * 0.33,
        orbitTilt: -0.4,
        color: 0xcc66ff,
        emissive: 0x7733aa,
        glowColor: 0xdd88ff,
        particleColor: 0xeeaaff,
        surfaceParticles: 250,
      },
      {
        radius: 1.0,
        orbitRadius: 19,
        orbitSpeed: 0.05,
        orbitPhase: Math.PI,
        orbitTilt: 0.1,
        color: 0xffcc33,
        emissive: 0xaa8822,
        glowColor: 0xffdd66,
        particleColor: 0xffee88,
        surfaceParticles: 350,
      },
    ];

    for (const cfg of configs) {
      this.planets.push(new Planet(this.scene, cfg));
    }

    // Inter-planet streams
    this.streams = new ParticleStreams(this.scene, this.planets, 2500);
  }

  _initPostProcessing() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      1.2,  // strength
      0.4,  // radius
      0.3   // threshold
    );
    this.composer.addPass(this.bloomPass);
  }

  _initHUD() {
    const container = document.getElementById('hud-bars');
    this.hudBars = [];
    for (let i = 0; i < 32; i++) {
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.height = '2px';
      container.appendChild(bar);
      this.hudBars.push(bar);
    }
  }

  _bindEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.composer.setSize(window.innerWidth, window.innerHeight);
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
      document.getElementById('info-text').textContent = 'System Audio Capture';
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
      document.getElementById('info-text').textContent = file.name;
    }
  }

  _startDemo() {
    this.audio = new DemoAnalyzer();
    this._showVisualizer();
    document.getElementById('info-text').textContent = 'Demo Mode';
  }

  _showVisualizer() {
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('hud').classList.add('visible');
  }

  start() {
    // Start demo mode by default (replaced when user picks audio)
    this.audio = new DemoAnalyzer();
    this._animate();
  }

  _animate() {
    requestAnimationFrame(() => this._animate());

    const time = this.clock.getElapsedTime();
    this.audio.update();

    const bass = this.audio.getBass();
    const mid = this.audio.getMid();
    const treble = this.audio.getTreble();
    const volume = this.audio.getVolume();
    const beat = this.audio.isBeat();

    // Camera gentle orbit
    const camAngle = time * 0.05;
    const camRadius = 22 - bass * 3;
    const camY = 8 + Math.sin(time * 0.1) * 2 + mid * 2;
    this.camera.position.set(
      Math.cos(camAngle) * camRadius,
      camY,
      Math.sin(camAngle) * camRadius
    );
    this.camera.lookAt(0, 0, 0);

    // Central sun pulse
    const sunScale = 0.8 + bass * 0.6 + (beat ? 0.3 : 0);
    this.sun.scale.setScalar(sunScale);
    this.centralLight.intensity = 1.5 + bass * 3.0 + (beat ? 2.0 : 0);
    this.centralLight.color.setHSL(0.1 + treble * 0.15, 0.8, 0.6 + volume * 0.3);

    // Update planets
    for (const planet of this.planets) {
      planet.update(time, this.audio);
    }

    // Update inter-planet streams
    this.streams.update(this.audio);

    // Starfield slow rotation
    this.starfield.rotation.y += 0.0001;
    this.starfield.rotation.x += 0.00005;

    // Bloom reacts to volume
    this.bloomPass.strength = 1.0 + volume * 1.5 + (beat ? 0.5 : 0);

    // Scene background color shift
    const bgH = 0.65 + treble * 0.05;
    const bgS = 0.8;
    const bgL = 0.01 + volume * 0.02;
    this.scene.background = new THREE.Color().setHSL(bgH, bgS, bgL);
    this.scene.fog.color.copy(this.scene.background);

    // HUD bars
    if (this.audio.active && this.audio.dataArray) {
      const step = Math.floor(this.audio.dataArray.length / this.hudBars.length);
      for (let i = 0; i < this.hudBars.length; i++) {
        const v = this.audio.dataArray[i * step] / 255;
        this.hudBars[i].style.height = `${2 + v * 28}px`;
        this.hudBars[i].style.background = `rgba(${150 + v * 100}, ${180 - v * 60}, 255, ${0.4 + v * 0.5})`;
      }
    }

    this.composer.render();
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────────

const viz = new Visualizer();
viz.start();

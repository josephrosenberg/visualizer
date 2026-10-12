// Particle sim: emission, bounce vs escape, loudness and kick balance,
// surface rings, collapse and death burst, lone sun, lone sink.
// Run: node test/smoke-particles.mjs   (or node test/run.mjs for all)
import { performance } from 'node:perf_hooks';
import { load } from './harness.mjs';
const { Core, MagneticParticles, PARTICLE_TUNING, THREE } = await load();


const scene = { add(){}, remove(){} };
const V = (x,y,z) => new THREE.Vector3(x,y,z);
let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures++; };
const dt = 1/60;

// Audio stub: a kick every 30 frames (2/s), tunable per-frequency amplitude.
function mkAudio({ volume = 0.5, amp = 0.5, hits = true, bass = 0.7, spread = false } = {}) {
  const hash = hz => { const x = Math.sin(hz * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const a = { frame: 0, getVolume: () => volume, getTreble: () => 0.2, getBass: () => bass, getMid: () => 0.2,
    getFreqAt: (hz) => spread ? Math.min(1, amp * (0.3 + 1.4 * hash(hz))) : amp };
  a.getOnset = () => hits && a.frame % 30 === 0;
  a.getHit = () => (a.getOnset() ? bass : 0);
  return a;
}
function mkCore(i, charge, radius, pos) {
  const c = new Core(scene, i, { role:'x', mass:1, charge, radius, position: pos, velocity: V(0,0,0) });
  c.phase = 'alive'; c.scaleT = 1; c.phaseTime = 0; c.lifeDuration = 1e9;
  return c;
}
// Count accepted surface events per core by kind (the throttle may refuse ripples).
function trackRings(cores) {
  const rings = new Map();
  for (const c of cores) {
    const st = { flares: 0, ripples: 0, requested: 0 };
    rings.set(c, st);
    const orig = c.addSurfaceEvent.bind(c);
    c.addSurfaceEvent = (x, y, z, kind, t) => {
      st.requested++;
      const before = c.surfaceHead;
      orig(x, y, z, kind, t);
      if (c.surfaceHead !== before) { if (kind === 0) st.flares++; else st.ripples++; }
    };
  }
  return rings;
}
// Classify where particles go to sleep: near which core, or elsewhere.
function instrument(p, cores) {
  const stats = { landed: 0, boundary: 0, aged: 0, other: 0, bySource: 0, bySink: 0 };
  const orig = p._sleep.bind(p);
  p._sleep = (i) => {
    const i3 = i*3, x=p.positions[i3], y=p.positions[i3+1], z=p.positions[i3+2];
    let near = null;
    for (const c of cores) { if (!c.alive) continue; const d = Math.hypot(x-c.position.x, y-c.position.y, z-c.position.z); if (d < c.radius*1.08+0.05) near = c; }
    if (p.ages[i] > PARTICLE_TUNING.maxAge) stats.aged++;
    else if (Math.hypot(x,y,z) > 11.5) stats.boundary++;
    else if (near) { stats.landed++; if (near === p.sourceCore[i]) stats.bySource++; else stats.bySink++; }
    else stats.other++;
    orig(i);
  };
  return stats;
}
const activeCount = p => { let n=0; for (let i=0;i<p.count;i++) n+=p.active[i]; return n; };
const anyNaN = p => { for (let i=0;i<p.count;i++) if (p.active[i]) for (let k=0;k<3;k++) if (!Number.isFinite(p.positions[i*3+k]) || !Number.isFinite(p.velocities[i*3+k])) return true; return false; };
const nearCount = (p, c, mult) => { let n=0; for (let i=0;i<p.count;i++){ if(!p.active[i]) continue; const i3=i*3; if (Math.hypot(p.positions[i3]-c.position.x,p.positions[i3+1]-c.position.y,p.positions[i3+2]-c.position.z) < c.radius*mult) n++; } return n; };
const solar = () => [ mkCore(0, 1.0, 2.0, V(0,0,0)), mkCore(1, -0.8, 0.6, V(5,0,0)), mkCore(2, -0.8, 0.6, V(-6,1,0)) ];
function run(p, audio, cores, ctx, frames, onFrame) {
  for (let f = 0; f < frames; f++) {
    audio.frame++;
    ctx.time += dt;
    p.update(audio, dt, ctx);
    if (onFrame) onFrame(f);
  }
}

// ── Scenario 1: solar, kicks, 15 s steady state ──────────────────────────
{
  const cores = solar();
  const audio = mkAudio();
  const p = new MagneticParticles(scene, cores, 1500);
  const stats = instrument(p, cores);
  const rings = trackRings(cores);
  const elevs = [];
  const origEmit1 = p._emit.bind(p);
  p._emit = (...a) => {
    origEmit1(...a);
    const [i, core, nx, ny, nz] = a;
    const vx = p.velocities[i*3] - core.velocity.x, vy = p.velocities[i*3+1] - core.velocity.y, vz = p.velocities[i*3+2] - core.velocity.z;
    const sp = Math.hypot(vx, vy, vz) || 1;
    elevs.push(Math.asin(Math.max(-1, Math.min(1, (vx*nx + vy*ny + vz*nz) / sp))) * 180 / Math.PI);
  };
  const ctx = { barycenter: V(0,0,0), extent: 6, died: [], time: 0 };
  const t0 = performance.now();
  const activeAt = {};
  run(p, audio, cores, ctx, 900, f => { if (f===60||f===300||f===899) activeAt[f]=activeCount(p); });
  const ms = (performance.now()-t0)/900;
  const sun = rings.get(cores[0]), s1 = rings.get(cores[1]);
  console.log('solar: active@1s', activeAt[60], '@5s', activeAt[300], '@15s', activeAt[899], 'sleeps', JSON.stringify(stats), `ms/frame ${ms.toFixed(2)}`);
  console.log('solar: rings sun', JSON.stringify(sun), 'sat1', JSON.stringify(s1));
  check(activeAt[60] > 50, 'particles emitted in first second');
  check(activeAt[899] > 300 && activeAt[899] <= 1500, 'steady-state in-flight count is sane');
  check(stats.landed > 200, 'particles land on surfaces');
  check(stats.bySink > 100, 'escapees reach the sinks');
  check(stats.aged < stats.landed * 0.2, 'few particles hit maxAge (not stuck)');
  check(stats.other === 0, 'no unexplained recycles');
  check(!anyNaN(p), 'no NaN positions/velocities');
  check(ms < 4, 'frame cost under 4 ms in node');
  check(sun.flares >= 40 && sun.flares <= 130, 'sun got 2-4 flare rings per kick');
  elevs.sort((a, b) => a - b);
  const eq = k => elevs[Math.floor(elevs.length * k)];
  console.log(`launch elevation deg: p10 ${eq(0.1).toFixed(0)} p25 ${eq(0.25).toFixed(0)} p50 ${eq(0.5).toFixed(0)} p90 ${eq(0.9).toFixed(0)} of ${elevs.length} launches`);
  check(eq(0.1) < 55 && eq(0.5) > 60 && eq(0.9) > 80, 'launches mix lofted slants with near-vertical');
  check(s1.ripples > 0 && s1.ripples <= 15 * 34 && s1.requested > s1.ripples, 'sink ripples registered and throttled');

  // Quiet (no kicks, low volume) vs loud (kicks, high volume)
  run(p, mkAudio({ volume: 0.03, hits: false }), cores, ctx, 600);
  const qN = activeCount(p);
  run(p, mkAudio({ volume: 0.6, hits: true }), cores, ctx, 600);
  const lN = activeCount(p);
  console.log('quiet in-flight', qN, 'loud in-flight', lN, 'caps', Math.round(1500*(PARTICLE_TUNING.poolQuiet+(1-PARTICLE_TUNING.poolQuiet)*0.03)), Math.round(1500*(PARTICLE_TUNING.poolQuiet+(1-PARTICLE_TUNING.poolQuiet)*0.6)));
  check(lN > qN * 1.5, 'loud has visibly more particles in flight than quiet');
  check(qN <= 1500*(PARTICLE_TUNING.poolQuiet+(1-PARTICLE_TUNING.poolQuiet)*0.03) + 1, 'quiet in-flight stays under the loudness cap');
  check(p.activeCount === activeCount(p), 'activeCount bookkeeping matches the flags');

  // ── Scenario 2: collapse sat1, then death burst ───────────────────────
  const sat = cores[1];
  sat.phase = 'collapsing'; sat.phaseTime = 0; sat.collapseDuration = 3;
  let died = [], burstKicks = 0, hoarded = 0;
  for (let f=0; f<60*3+5; f++) {
    died = [];
    for (const c of cores) { const was = c.alive; c.update(0, dt, audio); if (was && !c.alive) died.push(c); }
    if (f === 150) hoarded = nearCount(p, sat, 1.2);
    audio.frame++; ctx.time += dt;
    p.update(audio, dt, { ...ctx, died });
    if (died.length) { for (let i=0;i<p.count;i++) if (p.kicks[i] > 0) burstKicks++; }
  }
  console.log('collapse: hoarded near dying core at 2.5s', hoarded, 'kicked on death', burstKicks, 'alive cores', cores.filter(c=>c.alive).length);
  check(!sat.alive, 'satellite died');
  check(hoarded > 20, 'collapsing core gathered particles');
  check(burstKicks > 10, 'death burst kicked particles');
  run(p, audio, cores, ctx, 180);
  check(!anyNaN(p), 'no NaN after burst');
  check(activeCount(p) > 300, 'streams continue after a core dies');
}

// ── Scenario 3: bounce vs escape by energy ───────────────────────────────
for (const [label, amp, wantBounce] of [['cold listeners', 0.05, true], ['hot listeners', 0.95, false]]) {
  const cores = solar();
  const audio = mkAudio({ amp, volume: wantBounce ? 0.5 : 0.9, bass: wantBounce ? 0.3 : 0.9 });
  const p = new MagneticParticles(scene, cores, 1500);
  const stats = instrument(p, cores);
  const ctx = { barycenter: V(0,0,0), extent: 6, died: [], time: 0 };
  let bouncing = 0;
  run(p, audio, cores, ctx, 600, () => { for (let i=0;i<p.count;i++) if (p.active[i] && p.bounced[i] && !p.escaped[i]) bouncing++; });
  const total = stats.bySource + stats.bySink;
  const srcFrac = total ? stats.bySource / total : 0;
  console.log(`${label}: fell back on source ${stats.bySource}, reached a sink ${stats.bySink}, boundary ${stats.boundary}, aged ${stats.aged}; bounced-in-flight frames ${bouncing}`);
  check(!anyNaN(p), `${label}: no NaN`);
  if (wantBounce) {
    check(srcFrac > 0.8, `${label}: most particles fall back onto their source`);
    check(bouncing > 0, `${label}: particles bounce before landing`);
  } else {
    check(srcFrac < 0.2, `${label}: most particles escape to the sinks`);
  }
}

// ── Scenario 3b: loudness slides the bounce/escape balance, both always present ──
{
  const frac = {};
  for (const [label, volume] of [['quiet', 0.15], ['loud', 0.9]]) {
    const cores = solar();
    const p = new MagneticParticles(scene, cores, 1500);
    const stats = instrument(p, cores);
    const ctx = { barycenter: V(0,0,0), extent: 6, died: [], time: 0 };
    run(p, mkAudio({ volume, amp: 0.6, spread: true }), cores, ctx, 600);
    frac[label] = stats;
    console.log(`${label} passage: fell back ${stats.bySource}, reached a sink ${stats.bySink}`);
    check(stats.bySource > 20 && stats.bySink > 20, `${label} passage: both fall-back and interchange present`);
  }
  const q = frac.quiet.bySource / (frac.quiet.bySource + frac.quiet.bySink);
  const l = frac.loud.bySource / (frac.loud.bySource + frac.loud.bySink);
  console.log(`fall-back share: quiet ${q.toFixed(2)}, loud ${l.toFixed(2)}`);
  check(q > l + 0.2, 'quiet passages fall back more, loud passages interchange more');
}

// ── Scenario 3c: kick strength throws farther and tips the balance ─────────
{
  const res = {};
  for (const [label, bass] of [['soft kicks', 0.35], ['hard kicks', 0.95]]) {
    const cores = solar();
    const p = new MagneticParticles(scene, cores, 1500);
    const stats = instrument(p, cores);
    let eSum = 0, eN = 0;
    const origEmit = p._emit.bind(p);
    p._emit = (...args) => { eSum += args[5]; eN++; origEmit(...args); };
    const ctx = { barycenter: V(0,0,0), extent: 6, died: [], time: 0 };
    run(p, mkAudio({ volume: 0.6, amp: 0.6, spread: true, bass }), cores, ctx, 600);
    res[label] = { share: stats.bySource / (stats.bySource + stats.bySink), e: eSum / eN };
    console.log(`${label}: mean launch energy ${res[label].e.toFixed(2)}, fell back ${stats.bySource}, reached a sink ${stats.bySink}`);
    check(stats.bySource > 20 && stats.bySink > 20, `${label}: both populations present`);
  }
  check(res['hard kicks'].e > res['soft kicks'].e + 0.1, 'hard kicks launch with more energy than soft kicks');
  check(res['soft kicks'].share > res['hard kicks'].share + 0.15, 'soft kicks fall back more than hard kicks');
}

// ── Scenario 3d: lone sun, arcs of different heights, no hovering shell ───
{
  const cores = [ mkCore(0, 1.0, 2.0, V(0,0,0)) ];
  const p = new MagneticParticles(scene, cores, 1500);
  const stats = instrument(p, cores);
  const peak = new Float32Array(1500);                 // max distance reached, per particle
  const heights = [];                                   // apoapsis (in radii) of each fall-back
  const origSleep = p._sleep;                           // (already instrumented) wrap again to collect heights
  p._sleep = (i) => { if (p.active[i] && !p.escaped[i] && peak[i] > 0) heights.push(peak[i] / 2.0); peak[i] = 0; origSleep(i); };
  const ctx = { barycenter: V(0,0,0), extent: 5.5, died: [], time: 0 };
  let shell = 0, samples = 0;
  const still = new Uint16Array(1500), hovered = new Uint8Array(1500);
  run(p, mkAudio({ volume: 0.6, amp: 0.6, spread: true, bass: 0.7 }), cores, ctx, 900, (f) => {
    for (let i = 0; i < p.count; i++) {
      if (!p.active[i]) continue;
      const d = Math.hypot(p.positions[i*3], p.positions[i*3+1], p.positions[i*3+2]);
      if (d > peak[i]) peak[i] = d;
      // A hover: ballistic, between 1.2 and 3 radii where gravity is >= 0.33 u/s^2, and nearly still for 1.5 s straight. An arc can't do that.
      if (!p.escaped[i]) { samples++; const sp = Math.hypot(p.velocities[i*3], p.velocities[i*3+1], p.velocities[i*3+2]); if (d > 2.4 && d < 6 && sp < 0.15) { if (++still[i] > 90 && !hovered[i]) { hovered[i] = 1; shell++; } } else still[i] = 0; }
    }
  });
  heights.sort((a, b) => a - b);
  const q = k => heights[Math.floor(heights.length * k)] || 0;
  console.log(`lone sun: fell back ${stats.bySource}, escaped to boundary ${stats.boundary}, aged ${stats.aged}; fall-back apoapsis radii p10 ${q(0.1).toFixed(2)} p50 ${q(0.5).toFixed(2)} p90 ${q(0.9).toFixed(2)}; hovering particles ${shell} of ${stats.bySource + stats.boundary + stats.aged} launches`);
  check(stats.bySource > 100 && stats.boundary > 50, 'lone sun: some fall back, some escape');
  check(q(0.9) > q(0.1) + 0.3, 'lone sun: fall-backs reach a spread of heights');
  check(shell <= (stats.bySource + stats.boundary + stats.aged) * 0.01, 'lone sun: no shell of particles hovering for seconds');
}

// ── Scenario 4: lone sink, emitters fall back ─────────────────────────────
{
  const cores = [ mkCore(0, -1.0, 1.2, V(0,0,0)) ];
  const audio = mkAudio({ volume: 0.9, bass: 0.95 });
  const p = new MagneticParticles(scene, cores, 800);
  const stats = instrument(p, cores);
  const ctx = { barycenter: V(0,0,0), extent: 5.5, died: [], time: 0 };
  run(p, audio, cores, ctx, 900);
  console.log('lone sink: active', activeCount(p), 'sleeps', JSON.stringify(stats));
  check(activeCount(p) > 50, 'lone sink still emits');
  check(stats.boundary > 0 || stats.aged > 0, 'escaping lines recycle');
  check(!anyNaN(p), 'no NaN (lone sink)');
}

// ── Scenario 5: all cores gone for a frame ───────────────────────────────
{
  const p = new MagneticParticles(scene, [], 500);
  p.update(mkAudio(), dt, { barycenter: V(0,0,0), extent: 5.5, died: [], time: 0 });
  check(activeCount(p) === 0, 'no cores: nothing emitted, no crash');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);

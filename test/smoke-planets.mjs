// Planet-count control: builds a Visualizer from its prototype (no renderer)
// and exercises _spawnSystem(n), _applyTargetBodies, refill and physics.
// Run: node test/smoke-planets.mjs   (or node test/run.mjs for all)
import { load } from './harness.mjs';
const { Visualizer, Core, PHYSICS_G, THREE } = await load();
let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures++; };
const dt = 1 / 60;
const audio = { getBass: () => 0.3, getMid: () => 0.2, getTreble: () => 0.2, getVolume: () => 0.4, getHit: () => 0, getOnset: () => false, getFreqAt: () => 0.3 };

function mkViz(target = 0) {
  const v = Object.create(Visualizer.prototype);
  v.scene = { add() {}, remove() {} };
  v.cores = []; v.coreIdCounter = 0; v.spawnCooldown = 0; v.targetBodies = target;
  v.modeIndex = 0; v.paletteIndex = 0;
  return v;
}
const live = v => v._liveCores();
const roles = v => live(v).map(c => c.role).sort().join(',');
const settle = (v, seconds) => {   // run lifecycles + core updates + physics
  for (let f = 0; f < seconds * 60; f++) {
    v._updateCoreLifecycles(dt);
    v._updatePhysics(dt, audio);
    for (const c of v.cores) c.update(f * dt, dt, audio);
  }
};
const maxDist = v => Math.max(...v.cores.filter(c => c.alive).map(c => Math.hypot(c.position.x, c.position.y, c.position.z)));

// ── Locked spawns ──
for (let n = 1; n <= 5; n++) {
  const v = mkViz(n); v._spawnSystem(n);
  console.log(`spawn(${n}): ${roles(v)}`);
  check(live(v).length === n, `spawn(${n}) gives ${n} bodies`);
}
{
  const v = mkViz(1); v._spawnSystem(1); check(roles(v) === 'central', 'spawn(1) is a lone sun');
  const b = mkViz(2); b._spawnSystem(2); check(roles(b) === 'partner,partner', 'spawn(2) is a binary');
  const q = mkViz(5); q._spawnSystem(5); check(roles(q) === 'central,satellite,satellite,satellite,satellite', 'spawn(5) is a sun + 4 satellites');
  const counts = new Set();
  for (let i = 0; i < 60; i++) { const r = mkViz(0); r._spawnSystem(); counts.add(live(r).length); }
  check([...counts].every(c => c >= 2 && c <= 4) && counts.size >= 2, `random systems have 2-4 bodies (saw ${[...counts].sort()})`);
}

// ── Lock down: 4 -> 2 collapses the two lightest/outermost, never the sun ──
{
  const v = mkViz(0); v._spawnSystem(4);
  for (const c of v.cores) { c.phase = 'alive'; c.scaleT = 1; }
  v.targetBodies = 2; v._applyTargetBodies();
  const collapsing = v.cores.filter(c => c.phase === 'collapsing');
  check(collapsing.length === 2 && collapsing.every(c => c.role === 'satellite'), 'lock 4->2 collapses two satellites, sun stays');
  settle(v, 6);
  check(live(v).length === 2 && v.cores.length === 2, 'after the collapse only 2 bodies remain and the dead are destroyed');
}

// ── Lock up: 3 -> 5 adds two satellites on near-circular orbits outside ──
{
  const v = mkViz(0); v._spawnSystem(3);
  for (const c of v.cores) { c.phase = 'alive'; c.scaleT = 1; }
  const before = live(v).length;
  v.targetBodies = 5; v._applyTargetBodies();
  const added = v.cores.slice(before);
  check(live(v).length === 5 && added.length === 2 && added.every(c => c.role === 'satellite' && c.phase === 'spawning'), 'lock 3->5 adds two spawning satellites');
  const M = v.cores.reduce((m, c) => m + c.mass, 0);
  const ok = added.every(c => {
    const r = Math.hypot(c.position.x, c.position.y, c.position.z);
    const vel = Math.hypot(c.velocity.x, c.velocity.y, c.velocity.z);
    const vc = Math.sqrt(PHYSICS_G * M / r);
    return r > 4 && vel > vc * 0.8 && vel < vc * 1.4;
  });
  check(ok, 'added satellites sit outside at roughly circular speed');
  settle(v, 60);
  console.log('5-body lock after 60 s: live', live(v).length, 'max dist', maxDist(v).toFixed(1));
  check(live(v).length === 5 && maxDist(v) < 30, 'locked 5-body system stays together for 60 s');
}

// ── Refill: a satellite dies under a lock of 3, the system tops back up ──
{
  const v = mkViz(3); v._spawnSystem(3);
  for (const c of v.cores) { c.phase = 'alive'; c.scaleT = 1; c.lifeDuration = 1e9; }
  const sat = v.cores.find(c => c.role !== 'central') || v.cores[1];
  sat.lifeDuration = 0.5;
  settle(v, 8);
  check(live(v).length === 3 && !v.cores.includes(sat), 'dead satellite replaced, count back to 3');
}

// ── Sun dies under a lock: the refill is a new heavy body ──
{
  const v = mkViz(3); v._spawnSystem(4);
  for (const c of v.cores) { c.phase = 'alive'; c.scaleT = 1; c.lifeDuration = 1e9; }
  const sun = v.cores.find(c => c.role === 'central');
  check(!!sun, 'spawn(4) has a sun');
  sun.beginCollapse();
  settle(v, 8);
  const heavy = v.cores.filter(c => c.mass >= 2 && c.phase !== 'collapsing');
  console.log('after sun death: roles', roles(v), 'heavy', heavy.length);
  check(live(v).length === 3 && heavy.length === 1, 'a new sun replaces the dead one and the count holds at 3');
  settle(v, 30);
  console.log('30 s after sun swap: live', live(v).length, 'max dist', maxDist(v).toFixed(1));
  check(live(v).length === 3 && maxDist(v) < 30, 'system is stable 30 s after the sun swap');
}

// ── beginCollapse on a spawning body shrinks from where it is ──
{
  const v = mkViz(0); v._spawnSystem(1);
  const c = v.cores[0];
  for (let f = 0; f < 30; f++) c.update(f * dt, dt, audio);   // half a second into the spawn
  const s0 = c.scaleT;
  c.beginCollapse();
  let monotone = true, prev = s0 + 1e-6;
  for (let f = 0; f < 300 && c.alive; f++) { c.update(f * dt, dt, audio); if (c.scaleT > prev + 1e-6) monotone = false; prev = c.scaleT; }
  check(s0 > 0 && s0 < 1 && monotone, `collapsing a spawning body shrinks from ${s0.toFixed(2)} without popping`);
}

// ── Back to automatic: 0 lets the system die out and respawn randomly ──
{
  const v = mkViz(2); v._spawnSystem(2);
  for (const c of v.cores) { c.phase = 'alive'; c.scaleT = 1; c.lifeDuration = 0.5; }
  v.targetBodies = 0;
  settle(v, 10);
  check(live(v).length >= 2 && live(v).length <= 4, 'with the lock off a dead system respawns at a random size');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);

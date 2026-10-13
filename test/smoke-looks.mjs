// Looks schema and application, and the palette-from-image picker.
// Run: node test/smoke-looks.mjs   (or node test/run.mjs for all)
import { load } from './harness.mjs';
const { Core, MagneticParticles, PARTICLE_TUNING, LOOKS, makeLook, PALETTES, paletteFromPixels, THREE } = await load();

let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures++; };
const scene = { add() {}, remove() {} };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const audio = { frame: 0, getVolume: () => 0.5, getTreble: () => 0.2, getBass: () => 0.7, getMid: () => 0.2, getFreqAt: () => 0.5, getOnset: () => false, getHit: () => 0 };
const mkCore = (i, charge, radius, pos) => { const c = new Core(scene, i, { role: 'x', mass: 1, charge, radius, position: pos, velocity: V(0, 0, 0) }); c.phase = 'alive'; c.scaleT = 1; c.lifeDuration = 1e9; return c; };

// ── Schema ──
{
  const sections = ['planet', 'particles', 'trails', 'sim', 'scene', 'extras'];
  const names = LOOKS.map(l => l.name);
  check(LOOKS.length === 10 && names[0] === 'Classic' && names[7] === 'Dense' && names[8] === 'Comets' && names[9] === 'Anemone', `the original eight looks plus Comets and Anemone are present (${names.join(', ')})`);
  check(LOOKS.slice(0, 9).every(l => !l.trails.drain && l.sim.emission === 'spots' && l.sim.energy === 1 && l.sim.speed === 1 && l.sim.trickle === 1 && l.sim.poolQuiet === null && l.scene.nebulaGain === 1 && l.scene.stars === true), 'the new fields sit at their no-op defaults for the nine earlier looks');
  check(LOOKS.every(l => sections.every(k => k in l)), 'every look has every section');
  const custom = makeLook('x', { trails: { seconds: 2 }, sim: { charge: 'frequency' } });
  check(custom.trails.seconds === 2 && custom.trails.style === 'line' && custom.sim.charge === 'frequency' && custom.sim.coulomb === 0 && custom.planet.skin === 'nebula', 'makeLook merges overrides over the defaults');
  const points = LOOKS.find(l => l.name === 'Points');
  const dense = LOOKS.find(l => l.name === 'Dense');
  check(points.trails.style === 'none' && dense.particles.countMul === 2.5, 'Points has no trails, Dense has 2.5x particles');
}

// ── Every look applies to every subsystem, for every palette, and runs ──
{
  let threw = null;
  try {
    for (const look of LOOKS) {
      for (const palette of PALETTES) {
        const cores = [mkCore(0, 1, 2, V(0, 0, 0)), mkCore(1, -0.8, 0.6, V(5, 0, 0))];
        const p = new MagneticParticles(scene, cores, 300);
        for (const c of cores) c.applyLook(look, palette);
        p.applyLook(look, palette);
        const ctx = { barycenter: V(0, 0, 0), extent: 6, died: [], time: 0 };
        for (let f = 0; f < 30; f++) { ctx.time += 1 / 60; p.update(audio, 1 / 60, ctx); }
        if (look.planet.visible !== cores[0].mesh.visible) throw new Error(`${look.name}: planet visibility not applied`);
        if (look.planet.wireframe !== cores[0].material.wireframe) throw new Error(`${look.name}: wireframe not applied`);
        if ((look.trails.style === 'none') !== (p.trailGeo.drawRange.count === 0)) throw new Error(`${look.name}: trail style not applied`);
      }
    }
  } catch (e) { threw = e; }
  check(!threw, threw ? `looks apply: ${threw.message}` : `all ${LOOKS.length} looks apply across ${PALETTES.length} palettes and run`);
}

// ── Comets: landings register lingering spots (kind 2) in the comet's colour ──
{
  const look = LOOKS.find(l => l.name === 'Comets');
  const cores = [mkCore(0, 1, 2, V(0, 0, 0)), mkCore(1, -0.8, 0.6, V(5, 0, 0))];
  const p = new MagneticParticles(scene, cores, 500);
  for (const c of cores) c.applyLook(look, PALETTES[0]);
  p.applyLook(look, PALETTES[0]);
  const hitAudio = { ...audio, frame: 0, getOnset: () => hitAudio.frame % 30 === 0 };
  for (const c of cores) c.surfaceKinds.fill(-1);   // -1 = never written; 0 is a real kind
  const ctx = { barycenter: V(0, 0, 0), extent: 6, died: [], time: 0 };
  for (let f = 0; f < 360; f++) { hitAudio.frame = f; ctx.time += 1 / 60; p.update(hitAudio, 1 / 60, ctx); }
  const kinds = cores.flatMap(c => Array.from(c.surfaceKinds));
  check(cores[0].uniforms.uSkin.value === 1 && p.pointMat.uniforms.uSprite.value === 1 && p.trailMat.uniforms.uStyle.value === 1, 'Comets applies the glass skin, the comet sprite and the comet trail style');
  check(kinds.includes(2) && !kinds.includes(0) && !kinds.includes(1), `Comets registers spots only: no flare rings or ripples (kinds seen: ${[...new Set(kinds)].join(',')})`);
  const i = Array.from(cores[0].surfaceKinds).indexOf(2);
  check(i >= 0 && cores[0].surfaceColors.slice(i * 3, i * 3 + 3).some(v => v > 0 && v < 1), 'a spot carries the comet colour, not the default white');
  const classic = LOOKS[0];
  for (const c of cores) c.applyLook(classic, PALETTES[0]);
  check(cores[0].uniforms.uSkin.value === 0 && Array.from(cores[0].surfaceEvents).filter((v, k) => k % 4 === 3).every(t => t === -1000), 'switching skins clears the surface ring');
}

// ── Anemone: ring skin, hair trails that drain on landing, even emission ──
{
  const look = LOOKS.find(l => l.name === 'Anemone');
  const cores = [mkCore(0, 1, 2, V(0, 0, 0)), mkCore(1, -0.8, 0.6, V(5, 0, 0))];
  const p = new MagneticParticles(scene, cores, 2000);
  for (const c of cores) c.applyLook(look, PALETTES[0]);
  p.applyLook(look, PALETTES[0]);
  check(cores[0].uniforms.uSkin.value === 2 && p.trailMat.uniforms.uStyle.value === 2 && p.pointMat.uniforms.uSprite.value === 0, 'Anemone applies the ring skin, the hair trail style and the disc sprite');
  const hitAudio = { ...audio, frame: 0, getOnset: () => hitAudio.frame % 30 === 0 };
  const ctx = { barycenter: V(0, 0, 0), extent: 6, died: [], time: 0 };
  for (let f = 0; f < 120; f++) { hitAudio.frame = f; ctx.time += 1 / 60; p.update(hitAudio, 1 / 60, ctx); }
  check(p._spotsByCore.size === 0, 'even emission: a hit grows no flare spots');
  // One burst with the trickle off: under 'even' its launches spread over
  // the whole surface (octant chi-square well under 30); flare spots give 40+.
  {
    const T = PARTICLE_TUNING; const tb = T.trickleBase, tv = T.trickleVolume;
    try {
      T.trickleBase = 0; T.trickleVolume = 0;
      const q = new MagneticParticles(scene, [mkCore(0, 1, 2, V(0, 0, 0))], 2000); q.applyLook(look, PALETTES[0]);
      const one = { ...audio, frame: 0, getOnset: () => one.frame === 5 };
      const qctx = { barycenter: V(0, 0, 0), extent: 6, died: [], time: 0 };
      for (let f = 0; f < 6; f++) { one.frame = f; qctx.time += 1 / 60; q.update(one, 1 / 60, qctx); }
      const octs = new Array(8).fill(0); let n = 0;
      for (let i = 0; i < q.count; i++) if (q.active[i] && q.ages[i] <= 1 / 60 + 1e-9) { const i3 = i * 3; octs[(q.positions[i3] > 0 ? 4 : 0) + (q.positions[i3 + 1] > 0 ? 2 : 0) + (q.positions[i3 + 2] > 0 ? 1 : 0)]++; n++; }
      const chi = octs.reduce((s, c) => s + (c - n / 8) ** 2 / (n / 8), 0);
      check(n > 50 && chi < 30, `even emission: one burst leaves the whole surface (${n} launched, octant chi2 ${chi.toFixed(1)}; spots give 40+)`);
    } finally { T.trickleBase = tb; T.trickleVolume = tv; }
  }
  // Hot audio drives the uncapped energy to 1, so the look's cap is what binds.
  {
    const hot = { ...audio, frame: 0, getVolume: () => 1, getBass: () => 1, getFreqAt: () => 1, getOnset: () => hot.frame % 30 === 0 };
    const q = new MagneticParticles(scene, [mkCore(0, 1, 2, V(0, 0, 0)), mkCore(1, -0.8, 0.6, V(5, 0, 0))], 2000);
    q.applyLook(look, PALETTES[0]);
    const qctx = { barycenter: V(0, 0, 0), extent: 6, died: [], time: 0 };
    for (let f = 0; f < 120; f++) { hot.frame = f; qctx.time += 1 / 60; q.update(hot, 1 / 60, qctx); }
    let maxE = 0; for (let i = 0; i < q.count; i++) if (q.active[i] && q.energy[i] > maxE) maxE = q.energy[i];
    check(maxE > look.sim.energy - 0.05 && maxE <= look.sim.energy + 1e-6, `launch energy is capped by the look under hot audio (max ${maxE.toFixed(2)} of ${look.sim.energy})`);
  }
  let landed = -1;
  const orig = p._sleep.bind(p);
  p._sleep = (i) => { if (landed < 0 && p.active[i] && p.trailLen[i] > 10) landed = i; orig(i); };
  for (let f = 120; f < 400 && landed < 0; f++) { hitAudio.frame = f; ctx.time += 1 / 60; p.update(hitAudio, 1 / 60, ctx); }
  const lenAtLanding = landed >= 0 ? p.trailLen[landed] : 0;
  const inIndex = () => { const idx = p.trailIndex, n = p.maxCount; for (let k = 0; k < p.trailGeo.drawRange.count; k++) if (idx[k] % n === landed) return true; return false; };
  const drawnAtLanding = landed >= 0 && inIndex();
  for (let f = 0; f < 30; f++) { hitAudio.frame = 1000 + f; ctx.time += 1 / 60; p.update(hitAudio, 1 / 60, ctx); }
  const stillDormant = landed >= 0 && !p.active[landed];
  const drawnLater = landed >= 0 && inIndex();
  check(landed >= 0 && lenAtLanding > 10 && drawnAtLanding && drawnLater && stillDormant, `a landed strand keeps draining: ${lenAtLanding} points at landing, still drawn half a second later while its slot is held`);
  for (let f = 0; f < 200; f++) { hitAudio.frame = 2000 + f; ctx.time += 1 / 60; p.update(hitAudio, 1 / 60, ctx); }
  const stale = () => { const idx = p.trailIndex; let bad = 0; for (let k = 0; k < p.trailGeo.drawRange.count; k++) if (p.t - p.trailBirth[idx[k]] > p.trailSeconds + 1 / 60) bad++; return bad; };
  check(stale() === 0 && (p.active[landed] || !inIndex()), 'nothing drawn is older than the trail, and the faded strand has freed its slot');
  console.log(`anemone after ~10 s: ${p.activeCount} in flight, ${p.trailGeo.drawRange.count / 2} segments`);
  p.applyLook(LOOKS[0], PALETTES[0]);
  check(Array.from(p.trailLen).every((v, i) => p.active[i] || v === 0), 'switching to a look without draining drops the dormant strands');
}

// ── Palette from pixels ──
{
  const w = 64, h = 64, data = new Uint8ClampedArray(w * h * 4);
  const fill = (from, to, r, g, b) => { for (let i = from; i < to; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255; } };
  fill(0, 2048, 10, 10, 60);        // half: dark blue
  fill(2048, 3072, 250, 140, 30);   // quarter: bright orange
  fill(3072, 4096, 40, 160, 150);   // quarter: mid teal
  const pal = paletteFromPixels(data, 'test');
  const hex = n => '#' + n.toString(16).padStart(6, '0');
  console.log('palette from pixels:', JSON.stringify({ ...pal, core: hex(pal.core), rayInner: hex(pal.rayInner), rayOuter: hex(pal.rayOuter), bg: hex(pal.bg), bgLight: hex(pal.bgLight) }));
  check(pal.name === 'test' && pal.fromImage === true, 'palette is named and flagged');
  check(pal.bgLight === 0x0a0a3c, 'raw background is the darkest dominant colour');
  check(pal.rayInner === 0xfa8c1e, 'inner colour is the brightest saturated pick (orange)');
  check(pal.rayOuter === 0x28a096, 'outer colour is the darker saturated pick (teal)');
  const bgMax = Math.max(pal.bg >> 16, (pal.bg >> 8) & 255, pal.bg & 255);
  check(bgMax <= 11 && bgMax > 0, 'dark background is dimmed to near black but keeps its tint');
  check([pal.core, pal.rayInner, pal.rayOuter, pal.bg, pal.bgLight].every(Number.isInteger), 'all colours are integers');
  const empty = paletteFromPixels(new Uint8ClampedArray(16), 'blank');
  check([empty.core, empty.rayInner, empty.rayOuter, empty.bg].every(Number.isInteger), 'a blank image still yields a usable palette');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);

// Looks schema and application, and the palette-from-image picker.
// Run: node test/smoke-looks.mjs   (or node test/run.mjs for all)
import { load } from './harness.mjs';
const { Core, MagneticParticles, PARTICLE_TUNING, LOOKS, makeLook, PALETTES, paletteFromPixels, RAY_COUNT, LINK_MAX_PAIRS, THREE } = await load();

let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures++; };
const scene = { add() {}, remove() {} };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const audio = { frame: 0, getVolume: () => 0.5, getTreble: () => 0.2, getBass: () => 0.7, getMid: () => 0.2, getFreqAt: () => 0.5, getOnset: () => false, getHit: () => 0 };
const mkCore = (i, charge, radius, pos) => { const c = new Core(scene, i, { role: 'x', mass: 1, charge, radius, position: pos, velocity: V(0, 0, 0) }); c.phase = 'alive'; c.scaleT = 1; c.lifeDuration = 1e9; return c; };

// ── Schema ──
{
  const sections = ['planet', 'particles', 'trails', 'sim', 'scene', 'extras', 'links', 'rays'];
  const names = LOOKS.map(l => l.name);
  check(LOOKS.length === 11 && names[0] === 'Classic' && names[7] === 'Dense' && names[8] === 'Comets' && names[9] === 'Anemone' && names[10] === 'Starburst', `the original eight looks plus Comets, Anemone and Starburst are present (${names.join(', ')})`);
  check(LOOKS.slice(0, 9).every(l => !l.trails.drain && l.sim.emission === 'spots' && l.sim.energy === 1 && l.sim.speed === 1 && l.sim.trickle === 1 && l.sim.poolQuiet === null && l.scene.nebulaGain === 1 && l.scene.stars === true), 'the Anemone fields sit at their no-op defaults for the nine earlier looks');
  check(LOOKS.slice(0, 10).every(l => l.extras.length === 0 && l.scene.haze === 0 && l.planet.skin !== 'silhouette' && l.particles.sprite !== 'star'), 'no earlier look owns an extras pass, a haze, the silhouette skin or the star sprite');
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
        if (look.extras.includes('links') !== p.linkLines.visible) throw new Error(`${look.name}: links visibility not applied`);
        if (!look.extras.includes('links') && p.linkGeo.drawRange.count !== 0) throw new Error(`${look.name}: links drawn without the pass`);
        if (look.extras.includes('rays') !== cores[0].rays.visible) throw new Error(`${look.name}: rays visibility not applied`);
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

// ── Starburst: silhouette skin, star sprite, no trails, a web of links from the grid, a ray fan per body ──
{
  const look = LOOKS.find(l => l.name === 'Starburst');
  const cores = [mkCore(0, 1, 2, V(0, 0, 0)), mkCore(1, -0.8, 0.6, V(5, 0, 0))];
  const p = new MagneticParticles(scene, cores, 1500);
  for (const c of cores) c.applyLook(look, PALETTES[2]);
  p.applyLook(look, PALETTES[2]);
  check(cores[0].uniforms.uSkin.value === 3 && p.pointMat.uniforms.uSprite.value === 2 && !p._cometSprite && !p.trailLines.visible && p.linkLines.visible && cores[0].rays.visible, 'Starburst applies the silhouette skin, the star sprite (no velocity upload), no trails, the links and the rays');
  for (const c of cores) c.surfaceKinds.fill(-1);   // -1 = never written; 0 is a real kind
  const hitAudio = { ...audio, frame: 0, getOnset: () => hitAudio.frame % 30 === 0 };
  const ctx = { barycenter: V(0, 0, 0), extent: 6, died: [], time: 0 };
  let ms = 0, maxPairs = 0;
  for (let f = 0; f < 240; f++) {
    hitAudio.frame = f; ctx.time += 1 / 60;
    const t0 = performance.now(); p.update(hitAudio, 1 / 60, ctx); ms += performance.now() - t0;
    for (const c of cores) c.update(ctx.time, 1 / 60, hitAudio);
    if (p.linkPairs > maxPairs) maxPairs = p.linkPairs;
  }
  check(p._spotsByCore.size === 0, 'even emission: a hit grows no flare spots');
  const kinds = cores.flatMap(c => Array.from(c.surfaceKinds));
  check(kinds.includes(2) && !kinds.includes(0) && !kinds.includes(1), `landings register spots only, like Comets (kinds seen: ${[...new Set(kinds)].join(',')})`);
  // Links: every drawn pair joins two stars in flight within the radius,
  // no star carries more than perParticle, no pair is listed twice, and the
  // draw range and the upload range follow the count.
  const L = look.links, pairs = p.linkPairs, lp = p.linkPositions;
  check(pairs > 100 && pairs <= LINK_MAX_PAIRS && p.linkGeo.drawRange.count === pairs * 2 && p.linkPosAttr.updateRanges.at(-1).count === Math.max(3, pairs * 6), `links: ${pairs} pairs drawn after 4 s with ${p.activeCount} in flight (peak ${maxPairs}, cap ${LINK_MAX_PAIRS}); draw and upload ranges follow the count`);
  let longest = 0, maxDeg = 0, sumDeg = 0;
  for (let k = 0; k < pairs; k++) { const k6 = k * 6; longest = Math.max(longest, Math.hypot(lp[k6] - lp[k6 + 3], lp[k6 + 1] - lp[k6 + 4], lp[k6 + 2] - lp[k6 + 5])); }
  for (let i = 0; i < p.count; i++) { maxDeg = Math.max(maxDeg, p.linkDegree[i]); sumDeg += p.linkDegree[i]; }
  check(longest < L.radius && maxDeg <= L.perParticle && sumDeg === pairs * 2, `every link is under the radius (longest ${longest.toFixed(2)} of ${L.radius}) and no star carries more than ${L.perParticle} (max ${maxDeg})`);
  const seen = new Set(); let twice = 0;
  for (let k = 0; k < pairs; k++) { const a = lp.slice(k * 6, k * 6 + 3).join(','), b = lp.slice(k * 6 + 3, k * 6 + 6).join(','); const key = a < b ? a + '|' + b : b + '|' + a; if (seen.has(key)) twice++; else seen.add(key); }
  check(twice === 0, 'no pair is written twice in either direction (the hash-collision walk is caught, and ownership stays with the lower index)');
  const inFlight = (x, y, z) => { for (let i = 0; i < p.count; i++) { const i3 = i * 3; if (p.active[i] && p.positions[i3] === x && p.positions[i3 + 1] === y && p.positions[i3 + 2] === z) return true; } return false; };
  let dormant = 0;
  for (let k = 0; k < pairs; k += 7) { const k6 = k * 6; if (!inFlight(lp[k6], lp[k6 + 1], lp[k6 + 2]) || !inFlight(lp[k6 + 3], lp[k6 + 4], lp[k6 + 5])) dormant++; }
  check(dormant === 0, 'links join stars in flight only');
  // Rays: one fan per body, on the body, scaled by its radius, drawing the look's count; a dead body's fan goes with it.
  check(Math.abs(cores[0].rays.scale.x - 2) < 1e-6 && Math.abs(cores[1].rays.scale.x - 0.6) < 1e-6 && cores[1].rays.position.x === cores[1].position.x && cores[0].rays.geometry.drawRange.count === Math.min(RAY_COUNT, look.rays.count) * 2, "the ray fan sits on its body at radius x lifecycle scale and draws the look's count");
  check(cores[0].rays.rotation.y !== 0 && Math.sign(cores[0]._raySpin) !== Math.sign(cores[1]._raySpin) && cores[0].rayUniforms.uTime.value === ctx.time && Math.abs(cores[0].rayUniforms.uBass.value - 0.7) < 1e-9, 'the fans spin opposite ways on the sim time and read the bass');
  cores[1].beginCollapse(); cores[1].collapseDuration = 0.1;
  for (let f = 0; f < 12; f++) { ctx.time += 1 / 60; cores[1].update(ctx.time, 1 / 60, hitAudio); }
  check(!cores[1].alive && !cores[1].rays.visible && cores[0].rays.visible, 'a dead body hides its fan; the survivor keeps its own');
  console.log(`starburst after 4 s: ${p.activeCount} in flight, ${pairs} links, ${(ms / 240).toFixed(2)} ms per particle update (links included)`);
  p.applyLook(LOOKS[0], PALETTES[0]);
  for (const c of cores) c.applyLook(LOOKS[0], PALETTES[0]);
  p.update(hitAudio, 1 / 60, ctx);
  check(!p.linkLines.visible && p.linkGeo.drawRange.count === 0 && p.linkPairs === 0 && !cores[0].rays.visible, 'Classic hides the links and the rays and draws no pair');
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

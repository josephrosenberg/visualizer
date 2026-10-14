// Looks schema and application, and the palette-from-image picker.
// Run: node test/smoke-looks.mjs   (or node test/run.mjs for all)
import { load } from './harness.mjs';
const { Core, MagneticParticles, PARTICLE_TUNING, LOOKS, makeLook, PALETTES, paletteFromPixels, RAY_COUNT, LINK_MAX_PAIRS, PLANET_SKINS, SPRITES, FieldLines, ParticleLabels, ORBIT_DOTS, STREAM_MAX_LINES, LABEL_MAX_PARTICLES, LABEL_STRIDE, LABEL_WORDS, RIBBON_POINTS, RIBBON_NONE, SHARD_MAX, lightBackground, THREE } = await load();

let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures++; };
const scene = { add() {}, remove() {} };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const audio = { frame: 0, getVolume: () => 0.5, getTreble: () => 0.2, getBass: () => 0.7, getMid: () => 0.2, getFreqAt: () => 0.5, getOnset: () => false, getHit: () => 0 };
const mkCore = (i, charge, radius, pos) => { const c = new Core(scene, i, { role: 'x', mass: 1, charge, radius, position: pos, velocity: V(0, 0, 0) }); c.phase = 'alive'; c.scaleT = 1; c.lifeDuration = 1e9; return c; };

// ── Schema ──
{
  const sections = ['planet', 'particles', 'trails', 'sim', 'scene', 'extras', 'links', 'rays', 'orbits', 'streamlines', 'labels', 'ribbons', 'shards'];
  const names = LOOKS.map(l => l.name);
  check(names[0] === 'Classic' && names[7] === 'Dense' && names[8] === 'Comets' && names[9] === 'Anemone' && names[10] === 'Starburst' && ['Ribbons', 'Paper'].every(n => names.includes(n)), `the original eight looks plus Comets, Anemone, Starburst, Ribbons and Paper are present (${names.join(', ')})`);
  check(LOOKS.slice(0, 11).every(l => l.trails.style !== 'ribbon' && !l.extras.includes('shards') && l.planet.skin !== 'paper' && l.particles.sprite !== 'flat' && l.scene.background === 'dark' && l.scene.bloom > 0 && l.ribbons.shade === 'lit' && l.ribbons.width === 0.14 && l.shards.perHit === 6), 'no earlier look owns the ribbon style, the shards pass, the paper skin, the flat sprite, a light ground or a bloom of 0; the ribbons and shards sections sit at their defaults');
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
        const noLines = look.trails.style === 'none' || look.trails.style === 'ribbon';
        if (noLines !== (p.trailGeo.drawRange.count === 0)) throw new Error(`${look.name}: trail style not applied`);
        if ((look.trails.style === 'ribbon') !== !!(p.ribbonMesh && p.ribbonMesh.visible)) throw new Error(`${look.name}: ribbon style not applied`);
        if (look.extras.includes('shards') !== !!(p.shardMesh && p.shardMesh.visible)) throw new Error(`${look.name}: shards visibility not applied`);
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

// ── Ribbons: flat strips over a two-vertex ring (written once, expanded on the GPU through a static doubled index), links, shards ──
{
  const look = LOOKS.find(l => l.name === 'Ribbons');
  const cores = [mkCore(0, 1, 2, V(0, 0, 0)), mkCore(1, -0.8, 0.6, V(5, 0, 0))];
  const p = new MagneticParticles(scene, cores, 1500);
  check(p.ribbonGeo === null && p.shardGeo === null, 'ribbon and shard buffers are not built until a look asks for them');
  for (const c of cores) c.applyLook(look, PALETTES[7]);
  p.applyLook(look, PALETTES[7]);
  check(p.trailStyle === 'ribbon' && p.ribbonMesh.visible && !p.trailLines.visible && p.trailGeo.drawRange.count === 0 && p.linkLines.visible && p.shardMesh.visible && p.pointMat.uniforms.uSprite.value === 0 && p.ribbonMat.uniforms.uFlat.value === 0 && p.ribbonMat.blending === THREE.AdditiveBlending && p.pointMat.blending === THREE.AdditiveBlending && cores[0].uniforms.uSkin.value === 0, 'Ribbons draws the strip mesh instead of the line trails, with the links and the shards, lit and additive, on nebula planets');
  const n = p.maxCount, P = RIBBON_POINTS, secs = p.ribbonMat.uniforms.uSeconds.value;
  check(secs <= (P - 2) / 60 + 1e-9 && secs >= 1.5, `the strand lasts ${secs.toFixed(3)} s, within the ring`);
  const hitAudio = { ...audio, frame: 0, getOnset: () => hitAudio.frame % 30 === 0 };
  const ctx = { barycenter: V(0, 0, 0), extent: 6, died: [], time: 0 };
  let landed = -1, capBirth = 0, capSlot = -1;
  const orig = p._sleep.bind(p);
  p._sleep = (i) => { const was = p.active[i] && p.trailLen[i] > 10; const head = p.rbHead[i]; orig(i); if (landed < 0 && was) { landed = i; capSlot = head; capBirth = p.rbBirth[(head * n + i) * 2 + 1]; } };
  let ms = 0, thrownOffHit = 0, firsts = 0, badFirst = 0;
  for (let f = 0; f < 240; f++) {
    hitAudio.frame = f; ctx.time += 1 / 60;
    const before = p.shardCount;
    const t0 = performance.now(); p.update(hitAudio, 1 / 60, ctx); ms += performance.now() - t0;
    if (f % 30 !== 0 && p.shardCount !== before) thrownOffHit++;
    // Every launch's first point carries a width share of 0 (checked on the write frames across the run, since a launch on any one frame is luck).
    if (p._trailWrote) for (let j = 0; j < p.count; j++) if (p.active[j] && p.trailLen[j] === 1) { firsts++; if (p.rbSides[(p.rbSlot * p.maxCount + j) * 2 * 4 + 3] !== 0) badFirst++; }
  }
  // The static index: block s pairs slot s-1 with slot s per particle, both edges, and the second copy repeats the first.
  const B = p.count * 6, s = 37, pi = 1234, o = s - 1, k = s * B + pi * 6, idx = p.rbIndex;
  check(p._rbIndexCount === p.count && idx[k] === (o * n + pi) * 2 && idx[k + 1] === (o * n + pi) * 2 + 1 && idx[k + 2] === (s * n + pi) * 2 && idx[k + 3] === (o * n + pi) * 2 + 1 && idx[k + 4] === (s * n + pi) * 2 + 1 && idx[k + 5] === (s * n + pi) * 2 && idx[k + P * B] === idx[k] && idx[P * B - 6] === ((P - 2) * n + p.count - 1) * 2, 'the static index pairs each slot with the one before it per particle, both edges, and is written twice over');
  // The draw window: W blocks ending at the current slot, one contiguous range thanks to the doubled index.
  const W = Math.min(P - 1, Math.ceil(secs * 60) + 1), first = (p.rbSlot - W + 1 + P) % P;
  check(p.ribbonGeo.drawRange.start === first * B && p.ribbonGeo.drawRange.count === W * B && first + W - 1 < 2 * P && p.ribbonMat.uniforms.uNow.value === p.t, `the draw window is the last ${W} blocks ending at slot ${p.rbSlot} (${Math.round(W * B / 6 / 1000)}k quads), one range`);
  // This frame's slot block holds the live particles on both edge vertices, with the clock as birth and a width share.
  let live = -1; for (let j = 0; j < p.count; j++) if (p.active[j] && p.trailLen[j] > 1) { live = j; break; }
  const v = (p.rbSlot * n + live) * 2, v3 = v * 3, v4 = v * 4;
  check(live >= 0 && p.rbPositions[v3] === p.positions[live * 3] && p.rbPositions[v3 + 3] === p.positions[live * 3] && Math.abs(p.rbBirth[v] - p.t) < 1e-5 && p.rbBirth[v + 1] === p.rbBirth[v] && p.rbSides[v4 + 3] > 0 && p.rbSides[v4 + 7] === p.rbSides[v4 + 3] && p.rbSign[v] === -127 && p.rbSign[v + 1] === 127, 'a ribbon point is written to both edge vertices with the particle position, the clock, its width share and opposite signs');
  const rng = p.rbPosAttr.updateRanges.at(-1);
  check(rng.start === p.rbSlot * n * 6 && rng.count === p.count * 6 && p.rbSideAttr.updateRanges.at(-1).count === p.count * 8 && p.rbBirthAttr.updateRanges.at(-1).count === p.count * 2 && p.rbBirthAttr.updateRanges.length <= 1 + p.count, "uploads are this frame's slot block (both edges of every point) plus the caps");
  // The three rules of the static index, read back from the ring: no alive quad bridges two lives.
  let pairs = 0, bridges = 0, orphans = 0;
  for (let j = 0; j < p.count; j++) {
    for (let b = 1; b < W; b++) {
      const sl = (first + b) % P, ol = sl === 0 ? P - 1 : sl - 1;
      const vs = (sl * n + j) * 2, vo = (ol * n + j) * 2;
      const as = p.t - p.rbBirth[vs] <= secs, ao = p.t - p.rbBirth[vo] <= secs;
      if (as && ao) { pairs++; if (Math.hypot(p.rbPositions[vs * 3] - p.rbPositions[vo * 3], p.rbPositions[vs * 3 + 1] - p.rbPositions[vo * 3 + 1], p.rbPositions[vs * 3 + 2] - p.rbPositions[vo * 3 + 2]) > 0.6) bridges++; }
      else if (as && p.rbSides[vs * 4 + 3] !== 0 && p.rbBirth[vs] - p.rbBirth[vo] > 0.05) orphans++;   // a wide point whose older neighbour is not the write before it
    }
  }
  check(firsts > 0 && badFirst === 0, `the first point of a life carries a width share of 0 (${firsts} launches checked over the run)`);
  check(pairs > 10000 && bridges === 0 && orphans === 0, `${pairs} alive quads in the window: none bridges two lives (${bridges} long, ${orphans} wide points without their predecessor)`);
  check(landed >= 0 && capBirth === RIBBON_NONE, `a landed strand's newest point is blanked on sleep (particle ${landed}, slot ${capSlot})`);
  // The frame is orthonormal at every head, turns along a strand, and the width follows speed.
  const side = p.rbSides, nrm = p.rbNormals;
  let offAxis = 0, turned = 0, strands = 0;
  const bySpeed = [];
  for (let i = 0; i < p.count; i++) {
    if (!p.active[i] || p.trailLen[i] < 40) continue;
    const head = (p.rbHead[i] * n + i) * 2, root = (((p.rbHead[i] + P - 30) % P) * n + i) * 2;
    const sv = [side[head * 4] / 127, side[head * 4 + 1] / 127, side[head * 4 + 2] / 127];
    const nv = [nrm[head * 4] / 127, nrm[head * 4 + 1] / 127, nrm[head * 4 + 2] / 127];
    const rv = [side[root * 4] / 127, side[root * 4 + 1] / 127, side[root * 4 + 2] / 127];
    if (Math.abs(Math.hypot(...sv) - 1) > 0.03 || Math.abs(Math.hypot(...nv) - 1) > 0.03 || Math.abs(sv[0] * nv[0] + sv[1] * nv[1] + sv[2] * nv[2]) > 0.03) offAxis++;
    if (sv[0] * rv[0] + sv[1] * rv[1] + sv[2] * rv[2] < 0.999) turned++;
    const i3 = i * 3;
    bySpeed.push([Math.hypot(p.velocities[i3], p.velocities[i3 + 1], p.velocities[i3 + 2]), side[head * 4 + 3]]);
    strands++;
  }
  bySpeed.sort((x, y) => x[0] - y[0]);
  const third = Math.floor(bySpeed.length / 3);
  const meanW = arr => arr.reduce((s, x) => s + x[1], 0) / Math.max(1, arr.length) / 127;
  const slowW = meanW(bySpeed.slice(0, third)), fastW = meanW(bySpeed.slice(-third));
  check(strands > 50 && offAxis === 0 && turned > strands * 0.9 && fastW > slowW * 1.15, `${strands} strands of 40+ points: side and normal unit and at right angles at the head (${offAxis} off), ${turned} turned over 30 points, the fastest third ${fastW.toFixed(2)} wide against the slowest ${slowW.toFixed(2)}`);
  // Shards: thrown on hit frames only, scaled by the kick, flying along a unit direction with a unit side at right angles.
  const S = look.shards, thrown = p.shardCount, sources = cores.filter(c => c.charge > 0).length;
  check(thrown >= 8 * sources * S.perHit * 0.5 && thrown <= 8 * sources * S.perHit && thrownOffHit === 0, `${thrown} shards thrown over 8 hits from ${sources} source (perHit ${S.perHit}, scaled by the kick), none between hits`);
  let skew = 0;
  for (let u = 0; u < Math.min(thrown, SHARD_MAX) * 6; u++) { const u3 = u * 3, d = p.shardDirs, sd = p.shardSides; if (Math.abs(Math.hypot(d[u3], d[u3 + 1], d[u3 + 2]) - 1) > 1e-4 || Math.abs(Math.hypot(sd[u3], sd[u3 + 1], sd[u3 + 2]) - 1) > 1e-4 || Math.abs(d[u3] * sd[u3] + d[u3 + 1] * sd[u3 + 1] + d[u3 + 2] * sd[u3 + 2]) > 1e-4) skew++; }
  const last = ((p.shardHead + SHARD_MAX - 1) % SHARD_MAX) * 6;
  check(skew === 0 && p.shardBirth[last] > 0 && p.t - p.shardBirth[last] < 0.5 + 1e-6 && p.shardMat.uniforms.uNow.value === p.t, 'every shard flies along a unit direction with a unit side at right angles; the newest was born on the last hit');
  console.log(`ribbons after 4 s: ${p.activeCount} in flight, ${pairs} alive quads, ${thrown} shards, ${(ms / 240).toFixed(2)} ms per particle update (links and shards included)`);
  p.setCount(1000); p.update(hitAudio, 1 / 60, ctx);
  check(p._rbIndexCount === 1000 && p.ribbonGeo.drawRange.count === W * 1000 * 6, 'a new count rebuilds the index once and the window follows it');
  p.applyLook(LOOKS[0], PALETTES[0]);
  for (const c of cores) c.applyLook(LOOKS[0], PALETTES[0]);
  for (let f = 0; f < 2; f++) { hitAudio.frame = 1000 + f; ctx.time += 1 / 60; p.update(hitAudio, 1 / 60, ctx); }
  check(!p.ribbonMesh.visible && p.ribbonGeo.drawRange.count === 0 && !p.shardMesh.visible && p.trailLines.visible && p.trailGeo.drawRange.count > 0 && p.pointMat.blending === THREE.AdditiveBlending && !p._ribbons && !p._shards, 'Classic hides the ribbons and the shards and draws its line trails again');
  p.applyLook(look, PALETTES[7]);
  check(p._rbWipe === true && p.rbBirth.every(b => b === RIBBON_NONE) && Array.from(p.trailLen).every(v => v === 0), 'coming back blanks the ring and restarts every strand');
}

// ── Paper: flat ground, flat disc planets and particles, flat ribbons in three palette colours, hairline shards, no bloom ──
{
  const look = LOOKS.find(l => l.name === 'Paper');
  const cores = [mkCore(0, 1, 2, V(0, 0, 0)), mkCore(1, -0.8, 0.6, V(5, 0, 0))];
  const p = new MagneticParticles(scene, cores, 800);
  for (const c of cores) c.applyLook(look, PALETTES[0]);
  p.applyLook(look, PALETTES[0]);
  check(cores[0].uniforms.uSkin.value === 4 && p.pointMat.uniforms.uSprite.value === 3 && p.pointMat.blending === THREE.NormalBlending && p.ribbonMat.blending === THREE.NormalBlending && p.ribbonMat.uniforms.uFlat.value === 1 && p.ribbonMat.uniforms.uTaper.value === 1 && p.shardMat.blending === THREE.NormalBlending && p.shardMat.uniforms.uFlat.value === 1 && !p.linkLines.visible, 'Paper applies the paper skin, the flat sprite, normal blending on discs, ribbons and shards, flat shading and the bulge taper');
  check(look.scene.bloom === 0 && look.scene.fog === false && look.scene.stars === false && look.scene.nebula === 'off' && look.scene.background === 'light', 'Paper runs with no bloom, no fog, no stars, no nebula, on a light ground');
  const hitAudio = { ...audio, frame: 0, getOnset: () => hitAudio.frame % 30 === 0 };
  const ctx = { barycenter: V(0, 0, 0), extent: 6, died: [], time: 0 };
  for (let f = 0; f < 120; f++) { hitAudio.frame = f; ctx.time += 1 / 60; p.update(hitAudio, 1 / 60, ctx); }
  // Every disc in flight carries a palette colour as is (the accent is a hue shift; the stub's offsetHSL is a no-op, so it equals the inner here).
  const key = (r, g, b) => [r, g, b].map(v => Math.round(v * 255)).join(',');
  const toRgb = h => key(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255);
  const allowed = new Set([toRgb(PALETTES[0].rayInner), toRgb(PALETTES[0].rayOuter)]);
  const seen = new Map(); let other = 0, ribbonOff = 0, n = 0;
  for (let i = 0; i < p.count; i++) {
    if (!p.active[i] || p.ages[i] < PARTICLE_TUNING.fadeIn) continue;
    const i3 = i * 3, kp = key(p.pointColors[i3], p.pointColors[i3 + 1], p.pointColors[i3 + 2]);
    seen.set(kp, (seen.get(kp) || 0) + 1); n++;
    if (!allowed.has(kp)) other++;
    const v4 = (p.rbHead[i] * p.maxCount + i) * 2 * 4, rc = p.rbColors;
    if (!allowed.has([rc[v4], rc[v4 + 1], rc[v4 + 2]].join(','))) ribbonOff++;
  }
  check(n > 50 && other === 0 && ribbonOff === 0 && seen.size === 2 && Math.min(...seen.values()) > n * 0.2, `flat colours: ${n} discs in flight carry a palette colour as is (${[...seen.values()].join(' / ')} inner+accent / outer), the ribbon head the same, none lerped by level`);
  check(p.ribbonGeo.drawRange.count > 0 && p.shardCount > 0, 'Paper draws ribbons and throws shards through the same renderer');
  const lum = h => (0.2126 * ((h >> 16) & 255) + 0.7152 * ((h >> 8) & 255) + 0.0722 * (h & 255)) / 255;
  const bgs = PALETTES.filter(q => !q.fromImage).map(q => lightBackground(q));
  const sapphire = lightBackground(PALETTES[0]), mono = lightBackground(PALETTES[7]);
  check(bgs.length === 8 && bgs.every(h => lum(h) > 0.3 && lum(h) < 0.75) && (sapphire & 255) > ((sapphire >> 16) & 255) && ((mono >> 16) & 255) === (mono & 255) && ((mono >> 8) & 255) === (mono & 255) && lightBackground({ core: 0x8899cc, bgLight: 0x0a0a3c }) === 0x0a0a3c, `a built-in palette's light ground is a mid tint of its core colour, lifted by the tone mapping on screen (Sapphire #${sapphire.toString(16)}, Monochrome #${mono.toString(16)}); an image palette keeps its own`);
}
// ── Attractor: hot skin, streak sprite, a dot ring and circle per body, field lines from the summed field, tags on a fixed subset ──
{
  const look = LOOKS.find(l => l.name === 'Attractor');
  check(!!look && look.planet.skin === 'hot' && look.particles.sprite === 'streak' && look.trails.style === 'none' && look.sim.emission === 'even' && look.particles.countMul === 1 && ['orbits', 'streamlines', 'links'].every(x => look.extras.includes(x)) && !look.extras.includes('labels'), 'Attractor is present: hot skin, streak sprite, no trails, even emission, the chosen count; it owns the orbits, streamlines and links passes and leaves the labels off');
  // The labels pass is covered through a variant of the look that names it, so it stays one word away from being switched back on.
  const labelled = { ...look, extras: [...look.extras, 'labels'] };
  check(LOOKS.filter(l => l !== look).every(l => !['orbits', 'streamlines', 'labels'].some(x => l.extras.includes(x)) && l.planet.skin !== 'hot' && l.particles.sprite !== 'streak'), 'no other look owns the orbits, streamlines or labels passes, the hot skin or the streak sprite');
  check(LOOKS.every(l => 'orbits' in l && 'streamlines' in l && 'labels' in l), 'every look carries the orbits, streamlines and labels sections');
  const ember = PALETTES.find(pl => pl.name === 'Ember');
  const cores = [mkCore(0, 1, 2, V(0, 0, 0)), mkCore(1, -0.8, 0.6, V(5, 0, 0))];
  cores[0].role = 'central'; cores[1].role = 'satellite';
  const p = new MagneticParticles(scene, cores, 1000);
  const fl = new FieldLines(scene, cores);
  const lb = new ParticleLabels(scene, p);
  for (const c of cores) c.applyLook(look, ember);
  p.applyLook(look, ember); fl.applyLook(look, ember); lb.applyLook(labelled, ember, 2);
  check(cores[0].uniforms.uSkin.value === PLANET_SKINS.hot && p.pointMat.uniforms.uSprite.value === SPRITES.streak && p._cometSprite && !p.trailLines.visible && p.linkLines.visible && !cores[0].rays.visible && cores[0].orbitRing.visible && cores[0].orbitCircle.visible && fl.mesh.visible && lb.mesh.visible && lb.atlas === null, 'Attractor applies the hot skin, the streak sprite (velocity uploaded), no trails, the links, no rays, the orbits, the field lines and the labels (no atlas headless)');
  for (const c of cores) c.surfaceKinds.fill(-1);   // -1 = never written; 0 is a real kind
  const hitAudio = { ...audio, frame: 0, getOnset: () => hitAudio.frame % 30 === 0 };
  const ctx = { barycenter: V(0, 0, 0), extent: 6, died: [], time: 0 };
  let msP = 0, msF = 0, msL = 0;
  for (let f = 0; f < 240; f++) {
    hitAudio.frame = f; ctx.time += 1 / 60;
    let t0 = performance.now(); p.update(hitAudio, 1 / 60, ctx); msP += performance.now() - t0;
    t0 = performance.now(); fl.update(hitAudio, ctx); msF += performance.now() - t0;
    t0 = performance.now(); lb.update(1 / 60, cores, 2560, 1600); msL += performance.now() - t0;
    for (const c of cores) c.update(ctx.time, 1 / 60, hitAudio);
  }
  check(p._spotsByCore.size === 0, 'even emission: a hit grows no flare spots');
  const kinds = cores.flatMap(c => Array.from(c.surfaceKinds));
  check(kinds.includes(2) && !kinds.includes(0) && !kinds.includes(1), `landings register spots only, like Comets (kinds seen: ${[...new Set(kinds)].join(',')})`);
  // Orbits: the dot ring on its body in the world equatorial plane at radius x ringRadius, the circle outside it and leaning, both on the sim time, the look's dot count.
  const O = look.orbits;
  check(Math.abs(cores[0].orbitRing.scale.x - 2 * O.ringRadius) < 1e-6 && Math.abs(cores[1].orbitCircle.scale.x - 0.6 * O.circleRadius) < 1e-6 && cores[1].orbitRing.position.x === cores[1].position.x && cores[0].orbitRing.rotation.x === 0 && cores[0].orbitCircle.rotation.x !== 0 && Math.sign(cores[0].orbitCircle.rotation.x) !== Math.sign(cores[1].orbitCircle.rotation.x) && cores[0].orbitRing.geometry.drawRange.count === Math.min(ORBIT_DOTS, O.dots), "the dot ring sits on its body at radius x ringRadius in the world equatorial plane, the circle outside it leaning (neighbours opposite ways), drawing the look's dots");
  check(cores[0].orbitRing.rotation.y !== 0 && Math.sign(cores[0]._orbitSpin) !== Math.sign(cores[1]._orbitSpin) && cores[0].orbitUniforms.uTime.value === ctx.time && Math.abs(cores[0].orbitUniforms.uBass.value - 0.7) < 1e-9, 'the rings turn opposite ways on the sim time and read the bass');
  // Field lines: one per seed per body, rooted 1.08 radii off its body and leaving it, every segment `step` long, no interior vertex inside a body, the source's lines reach the sink, pulses signed by direction.
  const S = look.streamlines, pos = fl.positions, info = fl.info, st = fl.lineStart;
  check(fl.lines === 2 * S.perBody && fl.geo.drawRange.count === st[fl.lines] && fl.geo.drawRange.count <= fl.lines * S.steps * 2 && fl.posAttr.updateRanges.at(-1).count === Math.max(3, fl.geo.drawRange.count * 3), `streamlines: ${fl.lines} lines, ${fl.geo.drawRange.count / 2} segments, ${(msF / 240).toFixed(3)} ms a frame averaged over the cadence; draw and upload ranges follow the count`);
  let badRoot = 0, badStep = 0, inside = 0, landed = 0, toSink = 0, badPulse = 0;
  for (let l = 0; l < fl.lines; l++) {
    const c = fl.lineCore[l], a = st[l], b = st[l + 1], a3 = a * 3, sign = c.charge > 0 ? 1 : -1;
    if (Math.abs(Math.hypot(pos[a3] - c.position.x, pos[a3 + 1] - c.position.y, pos[a3 + 2] - c.position.z) - c.radius * 1.08) > 1e-4) badRoot++;
    if ((pos[a3 + 3] - pos[a3]) * (pos[a3] - c.position.x) + (pos[a3 + 4] - pos[a3 + 1]) * (pos[a3 + 1] - c.position.y) + (pos[a3 + 5] - pos[a3 + 2]) * (pos[a3 + 2] - c.position.z) <= 0) badRoot++;
    for (let v = a; v < b; v += 2) {
      const v3 = v * 3;
      if (Math.abs(Math.hypot(pos[v3 + 3] - pos[v3], pos[v3 + 4] - pos[v3 + 1], pos[v3 + 5] - pos[v3 + 2]) - S.step) > 1e-4) badStep++;
      if (v + 2 < b) for (const o of cores) if (Math.hypot(pos[v3 + 3] - o.position.x, pos[v3 + 4] - o.position.y, pos[v3 + 5] - o.position.z) < o.radius) inside++;
      if (info[v3 + 2] !== ((v - a) / 2) * sign || info[v3 + 5] !== ((v - a) / 2 + 1) * sign) badPulse++;
    }
    if (info[a3 + 1] === 1) { landed++; const e = (b - 1) * 3, o = cores.find(x => x !== c); if (Math.hypot(pos[e] - o.position.x, pos[e + 1] - o.position.y, pos[e + 2] - o.position.z) < o.radius) toSink++; }
  }
  check(badRoot === 0 && badStep === 0 && inside === 0, `every line roots 1.08 radii off its body and leaves it, every segment is ${S.step} long, no interior vertex is inside a body`);
  check(landed > 0 && toSink > 0, `${landed} lines land on a body, ${toSink} of them cross from one body to the other`);
  check(badPulse === 0, 'the pulse step is signed by direction: along +B off the source, along -B off the sink');
  // Cadence: a moved body's lines follow it on the next integration, not before.
  const rootX = () => pos[st[S.perBody] * 3], x0 = rootX();   // the first line of the second body (its start moves as the sun's lines change length)
  cores[1].position.x += 0.5; fl.frame = 1;
  fl.update(hitAudio, ctx); const x1 = rootX();
  fl.update(hitAudio, ctx); const x2 = rootX();
  check(x1 === x0 && Math.abs(x2 - x0 - 0.5) < 1e-6, `lines re-integrate every ${S.every} frames and follow their body`);
  cores[1].position.x -= 0.5;
  // Labels: a capped number of tags, each lit one on its own particle in flight (slot k = particle k * stride); a word per body on its body, stood off by its radius, at the body scale.
  const Lb = look.labels, kb = lb.particleLabels;
  check(lb.quads > 0 && kb > Lb.count / 2 && kb <= Lb.count && lb.quads === kb + 2 && lb.geo.drawRange.count === lb.quads * 6 && lb.attrs.position.updateRanges.at(-1).count === lb.quads * 12, `labels: ${kb} particle tags and 2 body words drawn (cap ${Lb.count}); draw and upload ranges follow the count`);
  let off = 0;
  for (let k = 0; k < kb; k++) {
    const i = lb.quadSlot[k] * LABEL_STRIDE, i3 = i * 3;
    if (lb.infos[k * 16 + 2] < 1) continue;   // a fading tag sits where its particle landed
    if (!(p.active[i] === 1 && lb.positions[k * 12] === p.positions[i3] && lb.positions[k * 12 + 1] === p.positions[i3 + 1] && lb.positions[k * 12 + 2] === p.positions[i3 + 2] && lb.infos[k * 16] === LABEL_WORDS.length + lb.quadSlot[k])) off++;
  }
  check(off === 0 && lb.positions[kb * 12] === cores[0].position.x && lb.infos[kb * 16 + 3] === cores[0].radius && Math.abs(lb.scales[kb * 4] - Lb.bodyScale) < 1e-6 && lb.infos[kb * 16] === 0 && lb.infos[(kb + 1) * 16] === 1 && lb.infos[0] >= LABEL_WORDS.length, 'every lit tag sits on its own particle in flight with its own atlas row; ATTRACTOR sits on the sun and SATELLITE on the satellite, stood off by the radius, at the body scale');
  check(Math.abs(lb.uniforms.uScale.value - Lb.scale * 2 / 2) < 1e-9 && lb.uniforms.uViewport.value[0] === 2560, "labels size by the look's scale x the pixel ratio over the atlas scale, and know the viewport");
  console.log(`attractor after 4 s: ${p.activeCount} in flight, ${p.linkPairs} links, ${fl.lines} field lines (${fl.geo.drawRange.count / 2} segments), ${lb.quads} labels; ${(msP / 240).toFixed(2)} ms particles (links included), ${(msF / 240).toFixed(3)} ms field lines, ${(msL / 240).toFixed(3)} ms labels per frame`);
  cores[1].beginCollapse(); cores[1].collapseDuration = 0.1;
  for (let f = 0; f < 12; f++) { ctx.time += 1 / 60; cores[1].update(ctx.time, 1 / 60, hitAudio); }
  fl.frame = 0; fl.update(hitAudio, ctx); lb.update(1 / 60, cores, 2560, 1600);
  check(!cores[1].alive && !cores[1].orbitRing.visible && !cores[1].orbitCircle.visible && cores[0].orbitRing.visible && fl.lines === S.perBody && lb.quads === lb.particleLabels + 1, 'a dead body hides its ring and circle, loses its field lines and its word; the survivor keeps its own');
  p.applyLook(LOOKS[0], PALETTES[0]); fl.applyLook(LOOKS[0], PALETTES[0]); lb.applyLook(LOOKS[0], PALETTES[0], 1);
  for (const c of cores) c.applyLook(LOOKS[0], PALETTES[0]);
  p.update(hitAudio, 1 / 60, ctx); fl.update(hitAudio, ctx); lb.update(1 / 60, cores, 2560, 1600);
  check(!cores[0].orbitRing.visible && !cores[0].orbitCircle.visible && !fl.mesh.visible && fl.geo.drawRange.count === 0 && !lb.mesh.visible && lb.geo.drawRange.count === 0 && !p.linkLines.visible && !p._cometSprite, 'Classic hides the orbits, the field lines, the labels and the links, draws none of them and stops the velocity upload');
}

// ── Sprite dispatch: every index past star is tested by equality in the fragment shader, so a new sprite can't be swallowed by an earlier range test ──
{
  const p = new MagneticParticles(scene, [mkCore(0, 1, 2, V(0, 0, 0))], 100);
  const src = p.pointMat.fragmentShader;
  const missing = Object.entries(SPRITES).filter(([, idx]) => idx >= 3 && !src.includes(`abs(uSprite - ${idx}.0) < 0.5`)).map(([name]) => name);
  const ranges = (src.match(/uSprite\s*>\s*([0-9.]+)/g) || []).filter(m => parseFloat(m.split('>')[1]) > 1.5);
  check(missing.length === 0 && ranges.length === 0, `sprite dispatch: ${Object.keys(SPRITES).length} sprites, every index past star tested by equality (missing: ${missing.join(',') || 'none'}; range tests above star: ${ranges.join(',') || 'none'})`);
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

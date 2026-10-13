// Looks schema and application, and the palette-from-image picker.
// Run: node test/smoke-looks.mjs   (or node test/run.mjs for all)
import { load } from './harness.mjs';
const { Core, MagneticParticles, LOOKS, makeLook, PALETTES, paletteFromPixels, THREE } = await load();

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
  check(LOOKS.length === 8 && names[0] === 'Classic' && names[7] === 'Dense', `the original eight looks are present (${names.join(', ')})`);
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

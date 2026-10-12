// Runs the real analysis pipeline (DemoAnalyzer -> _analyze) and checks
// that bands, the leveler, onsets and the particle hit-burst behave.
// Run: node test/smoke-audio.mjs   (or node test/run.mjs for all)
import { load } from './harness.mjs';
const { DemoAnalyzer, AudioAnalyzer, AUDIO_TUNING, MagneticParticles, Core, THREE } = await load();

let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failures++; };
const dt = 1 / 60;
const fin = (...v) => v.every(Number.isFinite);

// ── Band layout ──────────────────────────────────────────────────────────
{
  const a = new AudioAnalyzer();
  const b = JSON.parse(JSON.stringify(a.bandBins));
  console.log('bins @44.1k:', JSON.stringify(b), 'binHz', a.binHz.toFixed(2));
  check(b.bass[0] >= 1 && b.bass[1] <= 10, 'bass band is ~30-200 Hz (bins 1-9)');
  check(b.mid[0] === b.bass[1] && b.mid[1] <= 94, 'mid band is 200 Hz-2 kHz');
  check(b.treble[0] === b.mid[1] && b.treble[1] <= 465, 'treble band is 2-10 kHz');
  a.sampleRate = 48000; a._layoutBands();
  check(a.bandBins.treble[1] < b.treble[1], 'band layout follows sampleRate');
}

// ── Silence ──────────────────────────────────────────────────────────────
{
  const a = new AudioAnalyzer();
  a.active = true;
  a.dataArray.fill(0); a.timeData.fill(0);
  for (let f = 0; f < 180; f++) a._analyze(dt);
  check(a.getBass() === 0 && a.getMid() === 0 && a.getTreble() === 0, 'silence: bands read 0');
  check(a.getVolume() === 0, 'silence: loudness 0');
  check(a.getHit('bass') < 0.01, 'silence: no hits');
  check(a.getFreqAt(100) === 0 && a.getFreqAt(5000) === 0, 'silence: per-frequency reads 0');
  check(fin(a.getBass(), a.getVolume(), a.getHit('bass'), a.getFreqAt(60)), 'silence: no NaN');
}

// ── Demo track: 70 s = phrases 0..3, breakdown during 48-64 s ───────────
{
  const a = new DemoAnalyzer();
  let hits = 0, hitsBreak = 0, trebHits = 0, secNormal = 0, secBreak = 0;
  let bassMax = 0, bassMin = 1, loudMax = 0, loudMin = 1, midMax = 0, trebMax = 0;
  let lowAmp = 0, highAmp = 0, n = 0, nan = false;
  let loudBreakSum = 0, loudNormSum = 0, fb = 0, fnrm = 0;
  const accentSum = [0, 0, 0, 0], accentN = [0, 0, 0, 0];
  for (let f = 0; f < 60 * 70; f++) {
    a.update(dt);
    const t = a.t;
    const breakdown = (Math.floor(Math.floor(t / 0.5) / 32) % 4) === 3;
    const h = a.getHit('bass'), ht = a.getHit('treble');
    if (!fin(a.getBass(), a.getMid(), a.getTreble(), a.getVolume(), h, ht, a.getFreqAt(60), a.getFreqAt(6000))) nan = true;
    if (a.getOnset('bass')) { if (breakdown) hitsBreak++; else { hits++; const bib = Math.floor(t / 0.5) % 4; accentSum[bib] += h; accentN[bib]++; } }
    if (a.getOnset('treble') && !breakdown) trebHits++;
    if (breakdown) { secBreak += dt; loudBreakSum += a.getVolume(); fb++; }
    else { secNormal += dt; loudNormSum += a.getVolume(); fnrm++; }
    if (t > 5 && !breakdown) {
      bassMax = Math.max(bassMax, a.getBass()); bassMin = Math.min(bassMin, a.getBass());
      loudMax = Math.max(loudMax, a.getVolume()); loudMin = Math.min(loudMin, a.getVolume());
      midMax = Math.max(midMax, a.getMid()); trebMax = Math.max(trebMax, a.getTreble());
      lowAmp += a.getFreqAt(60); highAmp += a.getFreqAt(6000); n++;
    }
  }
  console.log(`demo: bass hits ${hits} in ${secNormal.toFixed(0)}s normal (${(hits / secNormal).toFixed(2)}/s), ${hitsBreak} in ${secBreak.toFixed(0)}s breakdown; treble hits ${trebHits} (${(trebHits / secNormal).toFixed(2)}/s)`);
  console.log(`demo: bass env ${bassMin.toFixed(2)}..${bassMax.toFixed(2)}, loud ${loudMin.toFixed(2)}..${loudMax.toFixed(2)}, mid max ${midMax.toFixed(2)}, treble max ${trebMax.toFixed(2)}; mean amp @60Hz ${(lowAmp / n).toFixed(2)} @6kHz ${(highAmp / n).toFixed(2)}; mean loud normal ${(loudNormSum / fnrm).toFixed(2)} breakdown ${(loudBreakSum / fb).toFixed(2)}`);
  check(!nan, 'demo: no NaN anywhere');
  const rate = hits / secNormal;
  check(rate > 1.6 && rate < 2.6, 'demo: bass hits land ~2/s (120 BPM kicks), not on every frame');
  check(hitsBreak <= 4, 'demo: almost no bass hits during the breakdown');
  const accents = accentSum.map((v, k) => accentN[k] ? v / accentN[k] : 0);
  console.log('demo: mean hit by beat in bar', accents.map(v => v.toFixed(2)).join(' '));
  check(accents[0] > accents[1] + 0.1, 'demo: accented kicks carry a bigger hit than soft ones');
  check(trebHits / secNormal > 2.5, 'demo: treble hits on the off-beat hats');
  check(bassMax > 0.75 && bassMin < 0.35, 'demo: bass envelope uses the full range');
  check(loudMax > 0.8 && loudMin < 0.6, 'demo: loudness has dynamic range');
  check(midMax > 0.6 && trebMax > 0.6, 'demo: mid and treble reach high (leveler)');
  check(lowAmp / n > 0.05 && highAmp / n > 0.05, 'demo: listeners at both 60 Hz and 6 kHz see signal');
  check(loudBreakSum / fb < loudNormSum / fnrm, 'demo: breakdown is quieter than the groove');
}

// ── Particles on the demo track: hit bursts fire ─────────────────────────
{
  const scene = { add() {}, remove() {} };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const mk = (i, charge, radius, pos) => {
    const c = new Core(scene, i, { role: 'x', mass: 1, charge, radius, position: pos, velocity: V(0, 0, 0) });
    c.phase = 'alive'; c.scaleT = 1; c.lifeDuration = 1e9; return c;
  };
  const cores = [mk(0, 1, 2, V(0, 0, 0)), mk(1, -0.8, 0.6, V(5, 0, 0)), mk(2, -0.8, 0.6, V(-6, 1, 0))];
  const a = new DemoAnalyzer();
  const p = new MagneticParticles(scene, cores, 1500);
  let emitsThisFrame = 0, maxEmits = 0, nan = false;
  const origEmit = p._emit.bind(p);
  p._emit = (...args) => { emitsThisFrame++; origEmit(...args); };
  const ctx = { barycenter: V(0, 0, 0), extent: 6, died: [], time: 0 };
  for (let f = 0; f < 60 * 20; f++) {
    a.update(dt);
    ctx.time = f * dt;
    emitsThisFrame = 0;
    p.update(a, dt, ctx);
    if (f > 120) maxEmits = Math.max(maxEmits, emitsThisFrame);
    for (let i = 0; i < p.count; i++) if (p.active[i]) for (let k = 0; k < 3; k++) if (!Number.isFinite(p.positions[i * 3 + k])) nan = true;
  }
  let active = 0; for (let i = 0; i < p.count; i++) active += p.active[i];
  console.log('particles on demo: active', active, 'max emits in one frame', maxEmits);
  check(!nan, 'particles on demo: no NaN');
  check(active > 300, 'particles on demo: streams in flight');
  check(maxEmits >= 50, 'particles on demo: bass hits release a burst');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);

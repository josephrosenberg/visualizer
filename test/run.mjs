// Runs every headless smoke suite in its own process and reports.
// Usage: node test/run.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const suites = ['smoke-particles.mjs', 'smoke-audio.mjs', 'smoke-planets.mjs', 'smoke-looks.mjs'];
let failed = 0;
for (const f of suites) {
  console.log(`\n=== ${f}`);
  const r = spawnSync(process.execPath, [path.join(here, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} suite(s) failed` : '\nall suites passed');
process.exit(failed ? 1 : 0);

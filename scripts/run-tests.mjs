/**
 * Run the engine test suite.
 *
 * Some of these need fixtures that are too large to commit (hundreds of MB of
 * raw frames), so a missing fixture is reported as "skipped" with the command
 * that regenerates it rather than as a failure.
 *
 * Two scripts alongside the tests are measuring tools rather than tests, so
 * they are named with a leading underscore and are not run here:
 *
 *   packages/core/test/_bench.ts       per-stage frame cost, for the three
 *                                      usage patterns the app actually sees
 *   packages/core/test/_signatures.ts  what each defect - blur, glare, a wrong
 *                                      crop, a card too small in the frame -
 *                                      does to the four section numbers the
 *                                      app prints on screen
 *
 * The second one is how a bad reading on a device gets diagnosed without
 * guessing; run it whenever those numbers need interpreting.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const testDir = join(root, 'packages', 'core', 'test');
const mobileTestDir = join(root, 'apps', 'mobile', 'test');
const fixtures = join(testDir, 'fixtures');

const SUITE = [
  {
    name: 'parity',
    needs: ['parity_input.bin', 'parity_expect.bin'],
    make: 'python tools/export_parity_fixtures.py',
  },
  {
    name: 'localise',
    needs: ['scan_frames.bin'],
    make: 'python tools/export_scan_fixtures.py',
  },
  {
    name: 'pipeline',
    needs: ['scan_frames.bin'],
    make: 'python tools/export_scan_fixtures.py',
  },
  {
    name: 'threshold',
    needs: ['scan_frames.bin'],
    make: 'python tools/export_scan_fixtures.py',
  },
  {
    name: 'reprint',
    needs: ['reprint_frames.bin'],
    make: 'python tools/export_reprint_fixtures.py',
  },
  {
    name: 'calibrate',
    needs: ['scan_frames.bin'],
    make: 'python tools/export_scan_fixtures.py',
  },
  {
    name: 'sections',
    needs: ['scan_frames.bin'],
    make: 'python tools/export_scan_fixtures.py',
  },
  {
    // No fixtures at all: the queries are the index's own rows.
    name: 'reachable',
    needs: [],
  },
  {
    // No fixtures: the surfaces are generated, so this runs everywhere.
    name: 'nocard',
    needs: ['scan_frames.bin', 'scan_meta.json'],
    make: 'python tools/make_scan_fixtures.py',
  },
  {
    name: 'sequence',
    needs: ['scan_frames.bin'],
    make: 'python tools/export_scan_fixtures.py',
  },
  {
    name: 'rotated',
    needs: ['scan_frames.bin'],
    make: 'python tools/export_scan_fixtures.py',
  },
  // The device-side tests. They need no fixtures, and they cover the two things
  // that were only ever wrong on a phone: how camera bytes are laid out, and
  // what may cross the worklet boundary.
  { name: 'frame', dir: mobileTestDir, needs: [] },
  { name: 'collection', dir: mobileTestDir, needs: [] },
  { name: 'history', dir: mobileTestDir, needs: [] },
  { name: 'workimage', dir: mobileTestDir, needs: [] },
  { name: 'worklet-payload', dir: mobileTestDir, needs: [] },
  { name: 'thumbs', dir: mobileTestDir, needs: [] },
  { name: 'entitlement', dir: mobileTestDir, needs: [] },
  { name: 'library', dir: mobileTestDir, needs: [] },
  { name: 'prices', dir: mobileTestDir, needs: [] },
  { name: 'merge', dir: mobileTestDir, needs: [] },
];

let failed = 0;
let skipped = 0;

for (const t of SUITE) {
  const missing = t.needs.filter((f) => !existsSync(join(fixtures, f)));
  if (missing.length) {
    console.log(`\n=== ${t.name} — SKIPPED (missing ${missing.join(', ')})`);
    console.log(`    regenerate with: ${t.make}`);
    skipped++;
    continue;
  }
  console.log(`\n=== ${t.name} ===`);
  const res = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', join(t.dir ?? testDir, `${t.name}.test.ts`)],
    { stdio: 'inherit', cwd: root },
  );
  if (res.status !== 0) failed++;
}

// The C++ core, compared against the TypeScript it was ported from. It skips
// itself when there is no compiler, so this stays runnable anywhere.
console.log('');
console.log('=== native parity ===');
{
  const res = spawnSync(
    process.execPath,
    [join(root, 'packages', 'core', 'native', 'check-parity.mjs')],
    { stdio: 'inherit', cwd: root },
  );
  if (res.status !== 0) failed++;
}

console.log(
  `
${SUITE.length + 1 - failed - skipped} passed, ${failed} failed, ${skipped} skipped`,
);
process.exit(failed ? 1 : 0);

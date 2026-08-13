/**
 * Build the C++ core and prove it still matches the TypeScript.
 *
 * Run this after touching either implementation. It is the whole reason the
 * native port is safe to have: the twelve test suites that exercise detection
 * keep running in Node against the TypeScript, and this shows the C++ produces
 * the same grid and the same components, exactly, on real frames.
 *
 * Skips with a message when no C++ compiler is present rather than failing - a
 * machine without one can still run everything else.
 *
 *   node packages/core/native/check-parity.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEP = String.fromCharCode(92);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const fixtures = join(root, 'packages', 'core', 'test', 'fixtures');

const frames = join(fixtures, 'scan_frames.bin');
if (!existsSync(frames)) {
  console.log('SKIPPED - no scan fixtures. Regenerate with:');
  console.log('  python tools/export_scan_fixtures.py');
  process.exit(0);
}

const VCVARS = join(
  'C:', 'Program Files (x86)', 'Microsoft Visual Studio', '2022', 'BuildTools',
  'VC', 'Auxiliary', 'Build', 'vcvars64.bat',
);
const hasMsvc = process.platform === 'win32' && existsSync(VCVARS);
const hasClang = spawnSync('clang++', ['--version'], { encoding: 'utf8' }).status === 0;

if (!hasMsvc && !hasClang) {
  console.log('SKIPPED - no C++ compiler found (MSVC build tools or clang++).');
  process.exit(0);
}

const exe = join(here, process.platform === 'win32' ? 'parity.exe' : 'parity');
console.log(hasClang ? 'building with clang++' : 'building with MSVC');

if (hasClang) {
  execFileSync('clang++', [
    '-std=c++17', '-O2', '-o', exe,
    join(here, 'bulksift_detect.cpp'), join(here, 'parity_main.cpp'),
  ], { stdio: 'inherit' });
} else {
  /*
   * Through a batch file rather than `cmd /c "..."`.
   *
   * cmd.exe has a rule where a command that *starts* with a quote needs the
   * whole line wrapped in another pair, and some shells rewrite tokens like
   * `>nul` on the way through. A four-line .bat has neither problem.
   */
  const dir = here.split('/').join(SEP);
  const bat = join(tmpdir(), 'bulksift-build.bat');
  writeFileSync(bat, [
    '@echo off',
    'call "' + VCVARS + '" >nul',
    'cd /d "' + dir + '" || exit /b 1',
    'cl /nologo /std:c++17 /O2 /EHsc /Fe:parity.exe bulksift_detect.cpp parity_main.cpp',
    '',
  ].join('\r\n'));
  execFileSync('cmd', ['/c', bat], { stdio: 'inherit' });
}

const meta = JSON.parse(readFileSync(join(fixtures, 'scan_meta.json'), 'utf8'));
const scratch = join(tmpdir(), 'bulksift-parity');
mkdirSync(scratch, { recursive: true });
const dump = join(scratch, 'stages.bin');

console.log('dumping the TypeScript reference...');
execFileSync(process.execPath, [
  '--experimental-strip-types', '--no-warnings',
  join(root, 'packages', 'core', 'test', '_dumpstages.ts'), dump,
], { stdio: 'inherit' });

const res = spawnSync(exe, [
  frames, String(meta.width), String(meta.height), String(meta.count), dump,
], { stdio: 'inherit' });
process.exit(res.status === null ? 1 : res.status);

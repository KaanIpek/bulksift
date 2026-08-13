/**
 * Proves the TypeScript descriptor is bit-for-bit identical to the Python
 * reference that builds the index. A single differing bit would not throw - it
 * would quietly shift Hamming distances and match the wrong card - so this runs
 * over real card art rather than a synthetic sample.
 *
 *   node --experimental-strip-types packages/core/test/parity.test.ts
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe as describeCard, N_BYTES, CANON_W, CANON_H } from '../src/descriptor.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');

const meta = JSON.parse(readFileSync(join(fixtures, 'parity_meta.json'), 'utf8')) as {
  count: number;
  width: number;
  height: number;
  bytesPerDescriptor: number;
  ids: string[];
};

if (meta.width !== CANON_W || meta.height !== CANON_H) {
  throw new Error(`fixture is ${meta.width}x${meta.height}, engine expects ${CANON_W}x${CANON_H}`);
}
if (meta.bytesPerDescriptor !== N_BYTES) {
  throw new Error(`fixture descriptors are ${meta.bytesPerDescriptor} bytes, engine emits ${N_BYTES}`);
}

const input = readFileSync(join(fixtures, 'parity_input.bin'));
const expect = readFileSync(join(fixtures, 'parity_expect.bin'));
const frameBytes = CANON_W * CANON_H * 4;

let pass = 0;
const failures: Array<{ id: string; diffBits: number; firstByte: number }> = [];

for (let i = 0; i < meta.count; i++) {
  const rgba = new Uint8ClampedArray(
    input.buffer,
    input.byteOffset + i * frameBytes,
    frameBytes,
  );
  const got = describeCard(rgba);

  let diffBits = 0;
  let firstByte = -1;
  for (let b = 0; b < N_BYTES; b++) {
    const x = got[b] ^ expect[i * N_BYTES + b];
    if (x) {
      if (firstByte < 0) firstByte = b;
      for (let k = 0; k < 8; k++) if (x & (1 << k)) diffBits++;
    }
  }
  if (diffBits === 0) pass++;
  else failures.push({ id: meta.ids[i], diffBits, firstByte });
}

console.log(`descriptor parity: ${pass}/${meta.count} cards bit-identical`);
if (failures.length) {
  console.log(`\n${failures.length} mismatches:`);
  for (const f of failures.slice(0, 10)) {
    console.log(`  ${f.id}: ${f.diffBits} bits differ, first at byte ${f.firstByte}`);
  }
  const total = failures.reduce((s, f) => s + f.diffBits, 0);
  console.log(`  mean ${(total / failures.length).toFixed(1)} differing bits per failure`);
  process.exit(1);
}
console.log('PASS - the index built in Python is searchable from TypeScript');

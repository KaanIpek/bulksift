/**
 * Dump the TypeScript detector's per-pixel stages, for the C++ port to be
 * checked against.
 *
 * The point of this file is that the native core is never trusted, only
 * compared. It writes the grid and every connected component, exactly as the
 * TypeScript produces them, and `native/parity_main.cpp` reproduces the same
 * work from the same frames and demands they match bit for bit.
 *
 *   node --experimental-strip-types packages/core/test/_dumpstages.ts <out.bin>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { __stagesForParity } from '../src/detect.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const meta = JSON.parse(readFileSync(join(fixtures, 'scan_meta.json'), 'utf8')) as {
  width: number; height: number; count: number;
};
const frames = readFileSync(join(fixtures, 'scan_frames.bin'));
const frameBytes = meta.width * meta.height * 4;

const out = process.argv[2];
if (!out) throw new Error('usage: _dumpstages.ts <out.bin>');

const chunks: Buffer[] = [];
const u32 = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const i32 = (v: number) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };

chunks.push(Buffer.from('BSST'), u32(meta.count));

for (let i = 0; i < meta.count; i++) {
  const rgba = new Uint8ClampedArray(
    frames.buffer, frames.byteOffset + i * frameBytes, frameBytes,
  );
  const s = __stagesForParity(rgba, meta.width, meta.height, 4, 320, 2);
  chunks.push(u32(s.grid.w), u32(s.grid.h), u32(s.grid.scale));
  chunks.push(Buffer.from(s.grid.gray.buffer, s.grid.gray.byteOffset, s.grid.gray.byteLength));
  chunks.push(u32(s.components.length));
  for (const c of s.components) {
    chunks.push(u32(c.size), u32(c.boundary.length));
    for (const p of c.boundary) chunks.push(i32(p.x), i32(p.y));
  }
}

writeFileSync(out, Buffer.concat(chunks));
console.log(`wrote ${out}: ${meta.count} frames`);

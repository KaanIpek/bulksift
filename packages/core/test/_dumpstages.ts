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

import { CANON_H, CANON_W, describe as describeCard, describeStrip } from '../src/descriptor.ts';
import { __stagesForParity, detectCard, rectify } from '../src/detect.ts';
import { CardIndex } from '../src/matcher.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const meta = JSON.parse(readFileSync(join(fixtures, 'scan_meta.json'), 'utf8')) as {
  width: number; height: number; count: number;
};
const frames = readFileSync(join(fixtures, 'scan_frames.bin'));
const frameBytes = meta.width * meta.height * 4;

const out = process.argv[2];
if (!out) throw new Error('usage: _dumpstages.ts <out.bin>');

const dataDir = join(here, '..', '..', '..', 'data');
const idxBuf = readFileSync(join(dataDir, 'index.bin'));
const index = CardIndex.parse(
  idxBuf.buffer.slice(idxBuf.byteOffset, idxBuf.byteOffset + idxBuf.byteLength) as ArrayBuffer,
);

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

/*
 * Searches, too.
 *
 * A real descriptor from every frame, with the answer the TypeScript gives, so
 * the C++ matcher is compared on the queries the app actually produces rather
 * than on random bytes - ties and near-ties are exactly where an index scan
 * would differ, and those only occur on real cards.
 */
chunks.push(Buffer.from('BSSQ'), u32(meta.count));
for (let i = 0; i < meta.count; i++) {
  const rgba = new Uint8ClampedArray(
    frames.buffer, frames.byteOffset + i * frameBytes, frameBytes,
  );
  const det = detectCard(rgba, meta.width, meta.height);
  const canonical = det
    ? rectify(rgba, meta.width, meta.height, det.quad, CANON_W, CANON_H)
    : new Uint8ClampedArray(CANON_W * CANON_H * 4);
  const q = describeCard(canonical);
  const strip = describeStrip(canonical);
  const r = index.search(q);
  const top = index.topK(q, 4);

  // The quad the descriptor came from, so the C++ can rectify the same region
  // from the same frame rather than being handed an already-canonical card.
  const quad = det ? det.quad : null;
  chunks.push(u32(quad ? 1 : 0));
  if (quad) {
    const qb = Buffer.alloc(64);
    for (let j = 0; j < 4; j++) {
      qb.writeDoubleLE(quad[j].x, j * 16);
      qb.writeDoubleLE(quad[j].y, j * 16 + 8);
    }
    chunks.push(qb);
  }
  chunks.push(u32(q.length), Buffer.from(q));
  chunks.push(u32(strip.length), Buffer.from(strip));
  chunks.push(i32(r.best.index), i32(r.best.distance));
  chunks.push(i32(r.runnerUp ? r.runnerUp.index : -1), i32(r.runnerUp ? r.runnerUp.distance : -1));
  chunks.push(u32(top.length));
  for (const c of top) chunks.push(i32(c.index), i32(c.distance));
  chunks.push(i32(r.best.index >= 0 ? index.stripDistance(r.best.index, strip) : -1));
}

writeFileSync(out, Buffer.concat(chunks));
console.log(`wrote ${out}: ${meta.count} frames and ${meta.count} searches`);

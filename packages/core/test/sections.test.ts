/**
 * What a good read looks like, section by section.
 *
 * The app prints the same four numbers on screen, so this is the reference to
 * compare a device against. Without it "colour 30%" means nothing; with it,
 * the shape of the disagreement names the cause:
 *   colour alone high   -> channel order or white balance
 *   art alone high      -> the quad is misaligned
 *   all four alike      -> optics, i.e. blur, glare or too few pixels
 *
 *   node --experimental-strip-types packages/core/test/sections.test.ts
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANON_H, CANON_W, describe as describeCard } from '../src/descriptor.ts';
import { detectCard, rectify } from '../src/detect.ts';
import { CardIndex } from '../src/matcher.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const dataDir = join(here, '..', '..', '..', 'data');

const meta = JSON.parse(readFileSync(join(fixtures, 'scan_meta.json'), 'utf8')) as {
  width: number; height: number; count: number;
  frames: Array<{ id: string; row: number; name: string }>;
};
const frames = readFileSync(join(fixtures, 'scan_frames.bin'));
const idxBuf = readFileSync(join(dataDir, 'index.bin'));
const index = CardIndex.parse(
  idxBuf.buffer.slice(idxBuf.byteOffset, idxBuf.byteOffset + idxBuf.byteLength) as ArrayBuffer,
);

const frameBytes = meta.width * meta.height * 4;
const totals = new Map<string, { sum: number; of: number; n: number }>();
let matched = 0;

for (let i = 0; i < meta.count; i++) {
  const rgba = new Uint8ClampedArray(
    frames.buffer, frames.byteOffset + i * frameBytes, frameBytes,
  );
  const det = detectCard(rgba, meta.width, meta.height);
  if (!det) continue;
  const up = rectify(rgba, meta.width, meta.height, det.quad, CANON_W, CANON_H);
  const q = describeCard(up);
  const r = index.search(q);
  // Only correct reads: this is a picture of what "right" looks like.
  if (r.best.index !== meta.frames[i].row) continue;
  matched++;
  for (const s of index.sections(q, r.best.index)) {
    const t = totals.get(s.name) ?? { sum: 0, of: s.of, n: 0 };
    t.sum += s.d;
    t.n++;
    totals.set(s.name, t);
  }
}

console.log(`${matched}/${meta.count} correctly matched fixture frames\n`);
console.log('section   disagreement on a CORRECT read');
let failed = 0;
for (const [name, t] of totals) {
  const pct = (t.sum / t.n / t.of) * 100;
  console.log(`${name.padEnd(8)}  ${(t.sum / t.n).toFixed(1).padStart(5)} of ${t.of}  (${pct.toFixed(0)}%)`);
  // A correct read should disagree on well under a third of any section.
  // Half would mean that section is carrying no information at all.
  if (pct > 33) {
    console.log(`FAIL  ${name} is at ${pct.toFixed(0)}%, which is not a working section`);
    failed++;
  }
}
console.log(
  '\nOn a device, compare against these. A section far above its number here is\n' +
  'the one to fix; all four raised together is the lens, not the descriptor.',
);
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);

/** Where does a live frame's time actually go? */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CardIndex } from '../src/matcher.ts';
import { Scanner } from '../src/scanner.ts';
import { expandCards } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const data = join(here, '..', '..', '..', 'data');

const meta = JSON.parse(readFileSync(join(fixtures, 'scan_meta.json'), 'utf8'));
const frames = readFileSync(join(fixtures, 'scan_frames.bin'));
const idxBuf = readFileSync(join(data, 'index.bin'));
const index = CardIndex.parse(
  idxBuf.buffer.slice(idxBuf.byteOffset, idxBuf.byteOffset + idxBuf.byteLength) as ArrayBuffer,
);
const compact = JSON.parse(readFileSync(join(data, 'cards.json'), 'utf8'));
const cards = expandCards(compact);
const book = JSON.parse(readFileSync(join(data, 'prices.json'), 'utf8'));

const scanner = new Scanner(index, cards, book);
const frameBytes = meta.width * meta.height * 4;

function frameAt(i: number) {
  return new Uint8ClampedArray(
    frames.buffer, frames.byteOffset + i * frameBytes, frameBytes,
  );
}

function run(label: string, pick: (k: number) => number, count: number) {
  scanner.reset();
  const t = { detect: 0, describe: 0, search: 0, reused: 0, n: 0 };
  for (let k = 0; k < count; k++) {
    const r = scanner.processFrame(frameAt(pick(k)), meta.width, meta.height, 4);
    t.detect += r.timings.detect;
    t.describe += r.timings.describe;
    t.search += r.timings.search;
    t.reused += r.timings.reused;
    t.n++;
  }
  const sum = t.detect + t.describe + t.search;
  const per = (v: number) => (v / t.n).toFixed(2);
  console.log(
    `${label.padEnd(22)} detect ${per(t.detect)}  describe ${per(t.describe)}  ` +
    `search ${per(t.search)}  =  ${per(sum)} ms  (${(1000 / (sum / t.n)).toFixed(0)} fps)  ` +
    `reused ${t.reused}/${t.n}`,
  );
}

console.log(`${meta.width}x${meta.height}, ${meta.count} distinct frames\n`);
// Every frame a different card - the hardest case, and what the fixtures are.
run('all cards different', (k) => k % meta.count, 300);
// One card held in front of a fixed lens, which is how the app is used.
run('one card held still', () => 7, 300);
// A card lingers for ~20 frames, then the next one arrives.
run('cards passing by', (k) => Math.floor(k / 20) % meta.count, 300);
console.log('');
run('all cards different', (k) => k % meta.count, 300);
run('one card held still', () => 7, 300);
run('cards passing by', (k) => Math.floor(k / 20) % meta.count, 300);

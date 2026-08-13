/**
 * Stage everything the mobile bundle needs that lives outside apps/mobile.
 *
 * Two things do: the built card index, and the recognition engine itself.
 * Both are deliberately kept out of this folder as sources of truth - the index
 * is a build artifact, the engine is shared with the web app - but EAS uploads
 * only the app directory, so a cloud build that cannot see them fails at
 * `expo export:embed` with nothing but "exited with non-zero code: 1".
 *
 * Run before any build. `npm run sync` at the repo root does this and the web
 * copy together.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

// ---------------------------------------------------------------- card data
const dataSrc = join(root, 'data');
const dataDst = join(here, '..', 'assets', 'data');
mkdirSync(dataDst, { recursive: true });

for (const f of ['index.bin', 'cards.json', 'prices.json']) {
  copyFileSync(join(dataSrc, f), join(dataDst, f));
  console.log(`  ${f}  ${(statSync(join(dataDst, f)).size / 1e6).toFixed(2)} MB`);
}

const parsed = JSON.parse(readFileSync(join(dataDst, 'cards.json'), 'utf8'));
// cards.json ships compact ({sets, cards}); older builds wrote a flat array.
const count = Array.isArray(parsed) ? parsed.length : parsed.cards.length;
const index = readFileSync(join(dataDst, 'index.bin'));
const rows = index.readUInt32LE(10);
if (rows !== count) {
  console.error(`\nMISMATCH: index has ${rows} rows, cards.json has ${count}`);
  process.exit(1);
}
console.log(`\n${rows.toLocaleString('en-US')} cards, index and metadata agree`);

// ------------------------------------------------------------------- engine
const coreSrc = join(root, 'packages', 'core', 'src');
const coreDst = join(here, '..', 'src', 'core');
rmSync(coreDst, { recursive: true, force: true });
mkdirSync(coreDst, { recursive: true });

let files = 0;
for (const f of readdirSync(coreSrc)) {
  if (!f.endsWith('.ts')) continue;
  copyFileSync(join(coreSrc, f), join(coreDst, f));
  files++;
}
console.log(`engine: ${files} files copied from packages/core/src`);

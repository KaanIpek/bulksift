/** Copy the built index and prices into the web app's public folder. */
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'data');
const dst = join(root, 'apps', 'web', 'public', 'data');
mkdirSync(dst, { recursive: true });

for (const f of ['index.bin', 'cards.json', 'prices.json']) {
  copyFileSync(join(src, f), join(dst, f));
  console.log(`  ${f}  ${(statSync(join(dst, f)).size / 1e6).toFixed(2)} MB`);
}

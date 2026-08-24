/** Drives the built game in a real browser and saves screenshots. Used to
 *  check the thing actually renders and plays, not just that it compiles. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.env.SHOT_DIR ?? 'shots';
mkdirSync(OUT, { recursive: true });

// This container ships a Chromium that predates the installed Playwright, so
// point at it rather than downloading a matching one.
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/01-title.png` });

await page.getByRole('button', { name: /How to play/ }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/02-howto.png` });
await page.getByRole('button', { name: /Back/ }).click();
await page.waitForTimeout(300);

await page.getByRole('button', { name: /Campaign/ }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/03-levels.png` });

await page.getByRole('button', { name: /First Light/ }).click();
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/04-battle-start.png` });

// Give a real order: drag from the player's own camp onto the neutral one.
const box = await page.locator('#game').boundingBox();
const at = async (id) => {
  const p = await page.evaluate((n) => window.frontline.baseAt(n), id);
  return { x: box.x + p.x, y: box.y + p.y };
};
const from = await at(0);
const to = await at(2);
await page.mouse.move(from.x, from.y);
await page.mouse.down();
await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 14 });
await page.waitForTimeout(120);
await page.screenshot({ path: `${OUT}/05-order-arrow.png` });
await page.mouse.move(to.x, to.y, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/06-marching.png` });
console.log('after order:', await page.evaluate(() => window.frontline.state()));

// Hold on a base to open its details.
await page.mouse.move(from.x, from.y);
await page.mouse.down();
await page.waitForTimeout(700);
await page.mouse.up();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/07-inspector.png` });

await page.waitForTimeout(7000);
await page.screenshot({ path: `${OUT}/08-later.png` });
console.log('later:', await page.evaluate(() => window.frontline.state()));

const report = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  return { w: canvas?.width, h: canvas?.height, ui: document.getElementById('ui')?.children.length };
});
console.log('canvas', report);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();

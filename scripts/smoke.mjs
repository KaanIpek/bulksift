/** Plays the built game in a real browser and checks it works.
 *
 *  The unit tests prove the rules are right; this proves the thing you can
 *  actually install does something when you touch it. It drives the real
 *  build through a real Chromium: menus, an order given by dragging, an
 *  upgrade bought, and a level played to a finish. Screenshots fall out of
 *  it as a side effect, which is how the art gets looked at.
 *
 *  Run with: npm run test:browser
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 4183;
const OUT = process.env.SHOT_DIR ?? 'shots';
mkdirSync(OUT, { recursive: true });

const failures = [];
const check = (ok, what) => {
  if (ok) console.log(`  ok   ${what}`);
  else {
    console.log(`  FAIL ${what}`);
    failures.push(what);
  }
};

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
});
process.on('exit', () => server.kill());

// Wait for the preview server rather than guessing at a delay.
let up = false;
for (let i = 0; i < 40 && !up; i++) {
  try {
    const res = await fetch(`http://localhost:${PORT}/`);
    up = res.ok;
  } catch {
    await sleep(250);
  }
}
if (!up) {
  console.error('preview server never came up');
  process.exit(1);
}

const browser = await chromium.launch({
  // This container ships a Chromium older than the installed Playwright.
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

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await sleep(2000);
await page.screenshot({ path: `${OUT}/01-title.png` });

console.log('menus');
check(await page.getByRole('button', { name: /Campaign/ }).isVisible(), 'title screen offers the campaign');
await page.getByRole('button', { name: /How to play/ }).click();
await sleep(350);
await page.screenshot({ path: `${OUT}/02-how-to-play.png` });
check(await page.getByText(/Drag to attack/).isVisible(), 'how to play explains the controls');
await page.getByRole('button', { name: /Back/ }).click();
await sleep(250);

await page.getByRole('button', { name: /Campaign/ }).click();
await sleep(400);
await page.screenshot({ path: `${OUT}/03-missions.png` });
check(await page.getByText('First Light').isVisible(), 'mission list shows the first mission');
check(await page.getByRole('button', { name: /Locked/ }).first().isDisabled(), 'later missions are locked');

console.log('a battle');
await page.getByRole('button', { name: /First Light/ }).click();
await sleep(1500);
await page.screenshot({ path: `${OUT}/04-battle.png` });

const box = await page.locator('#game').boundingBox();
const at = async (id) => {
  const p = await page.evaluate((n) => window.frontline.baseAt(n), id);
  return { x: box.x + p.x, y: box.y + p.y };
};

const before = await page.evaluate(() => window.frontline.state());
check(before.mode === 'playing', 'the mission started');
check(before.player === 2 && before.enemy === 1, 'both sides are on the board');

// Drag from a base we own onto the neutral one in the middle.
const from = await at(0);
const to = await at(2);
await page.mouse.move(from.x, from.y);
await page.mouse.down();
await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 14 });
await sleep(150);
await page.screenshot({ path: `${OUT}/05-order.png` });
await page.mouse.move(to.x, to.y, { steps: 10 });
await page.mouse.up();
await sleep(400);
const ordered = await page.evaluate(() => window.frontline.state());
check(ordered.squads > 0, 'dragging between bases sends a column');
await sleep(1200);
await page.screenshot({ path: `${OUT}/06-marching.png` });

// Hold on one of our bases to open it, then buy an upgrade.
const home = await at(1);
await page.mouse.move(home.x, home.y);
await page.mouse.down();
await sleep(700);
await page.mouse.up();
await sleep(300);
await page.screenshot({ path: `${OUT}/07-inspector.png` });
check(await page.locator('.inspector').isVisible(), 'holding a base opens its details');

// Wind the clock forward so the garrison can afford an upgrade. The speed
// control is addressed by its label, not its face, which changes as it cycles.
const speed = page.getByRole('button', { name: 'Change game speed' });
await speed.click();
await speed.click();
let upgraded = false;
for (let i = 0; i < 40 && !upgraded; i++) {
  const upgrade = page.getByRole('button', { name: /Upgrade/ });
  if ((await upgrade.count()) > 0 && (await upgrade.isEnabled())) {
    await upgrade.click();
    await sleep(250);
    const heading = (await page.locator('.inspector h3').textContent()) ?? '';
    upgraded = /L[23]/.test(heading);
  }
  await sleep(400);
}
check(upgraded, 'a base can be upgraded once its garrison affords it');
await page.screenshot({ path: `${OUT}/08-upgraded.png` });

console.log('playing it out');
/** Drag from a base onto another, the way a thumb would. */
async function order(fromBase, toBase) {
  await page.mouse.move(box.x + fromBase.x, box.y + fromBase.y);
  await page.mouse.down();
  await page.mouse.move(
    box.x + (fromBase.x + toBase.x) / 2,
    box.y + (fromBase.y + toBase.y) / 2,
    { steps: 6 },
  );
  await page.mouse.move(box.x + toBase.x, box.y + toBase.y, { steps: 6 });
  await page.mouse.up();
}

// Nobody wins a game of this by watching it, so actually play: throw the
// fullest base at the nearest thing it does not own, over and over.
let finished = null;
for (let round = 0; round < 90 && !finished; round++) {
  const state = await page.evaluate(() => window.frontline.state());
  if (state.mode === 'result') {
    finished = state;
    break;
  }
  const bases = await page.evaluate(() => window.frontline.bases());
  const mine = bases.filter((b) => b.owner === 'player').sort((a, b) => b.garrison - a.garrison);
  const theirs = bases.filter((b) => b.owner !== 'player');
  if (mine.length && theirs.length) {
    const attacker = mine[0];
    const target = theirs.sort(
      (a, b) => Math.hypot(a.x - attacker.x, a.y - attacker.y) - Math.hypot(b.x - attacker.x, b.y - attacker.y),
    )[0];
    if (attacker.garrison > 12) await order(attacker, target);
  }
  await sleep(900);
}
check(Boolean(finished), 'the mission reaches a result when it is actually played');
await sleep(500);
await page.screenshot({ path: `${OUT}/09-result.png` });
check(
  (await page.getByText(/Ground taken|Position lost/).count()) > 0,
  'the result screen says how it went',
);

console.log('rendering');
const painted = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, Math.floor(canvas.height * 0.75), canvas.width, 1);
  // A row three quarters down the screen must be terrain, not the blank
  // clear colour: that is what a mis-scaled world transform looks like.
  const tones = new Set();
  for (let i = 0; i < data.length; i += 4 * 16) tones.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  return { width: canvas.width, height: canvas.height, tones: tones.size };
});
check(painted.width > 0 && painted.height > 0, 'the canvas has a size');
check(painted.tones > 3, 'the lower half of the screen is drawn terrain, not blank');

check(errors.length === 0, `no console or page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);

await browser.close();
server.kill();

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);

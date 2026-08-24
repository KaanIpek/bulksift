/** Renders the app icon to PNG at the sizes stores and home screens want.
 *  The artwork is defined once as SVG here, so there is no binary asset in
 *  the repository to keep in step with the game's palette. */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="snow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f7fafd"/><stop offset="1" stop-color="#d7e2ec"/>
    </linearGradient>
    <linearGradient id="green" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5ce08a"/><stop offset="1" stop-color="#189544"/>
    </linearGradient>
    <linearGradient id="red" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff7a6b"/><stop offset="1" stop-color="#b9302c"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#snow)"/>
  <path d="M0 300 L150 190 L250 250 L380 150 L512 236 L512 512 L0 512 Z" fill="#e6edf4"/>
  <path d="M96 372 C 170 320, 210 300, 256 300 C 302 300, 342 320, 416 372"
        stroke="#c2a179" stroke-width="34" fill="none" stroke-linecap="round"/>
  <circle cx="150" cy="360" r="62" fill="url(#green)"/>
  <circle cx="362" cy="360" r="50" fill="url(#red)"/>
  <path d="M256 118 L296 196 L216 196 Z" fill="#a9cfbc"/>
  <path d="M256 158 L306 240 L206 240 Z" fill="#cfe6da"/>
  <path d="M256 200 L316 288 L196 288 Z" fill="#eef7f2"/>
</svg>`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
for (const size of [180, 192, 512]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0">${svg(size)}</body>`,
    { waitUntil: 'load' },
  );
  const shot = await page.screenshot({ omitBackground: true });
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), shot);
  console.log(`wrote public/icon-${size}.png`);
}
writeFileSync(new URL('../public/icon.svg', import.meta.url), svg(512).trim());
await browser.close();

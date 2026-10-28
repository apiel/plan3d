// The README screenshots, from the demo plan, with headless Chrome:
//   npx vite-node scripts/demo-plan.ts /tmp/demo.json
//   npm run build && npx vite preview --port 4180 &
//   npm i --no-save puppeteer-core && node scripts/screenshots.mjs /tmp/demo.json http://localhost:4180/
// Writes docs/screenshots/*.png. Set CHROME to the browser's path if it is not /usr/bin/google-chrome.
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const [planFile, url] = process.argv.slice(2);
const out = new URL('../docs/screenshots/', import.meta.url).pathname;
const plan = readFileSync(planFile, 'utf8');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(w, h) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
  await page.goto(url);
  await page.evaluate((p) => {
    localStorage.clear();
    localStorage.setItem('plan3d.plan', p);
  }, plan);
  await page.reload();
  await wait(800);
}

// screen position of a plan point, as the editor's fit() places the 8 x 6 m demo
const at = (x, y) =>
  page.evaluate(
    (x, y) => {
      const c = document.getElementById('canvas');
      const [w, h, bw, bh] = [c.clientWidth, c.clientHeight, 8, 6];
      const s = Math.min((w - 200) / bw, (h - 200) / bh, 200);
      return { x: (w - bw * s) / 2 + x * s, y: (h - bh * s) / 2 + y * s };
    },
    x,
    y
  );

await open(412, 870);
await page.screenshot({ path: `${out}phone-plan.png` });
const win = await at(3.2, -0.05); // the window open below, with the desk in its niche
await page.mouse.click(win.x, win.y);
await wait(400);
await page.screenshot({ path: `${out}phone-window.png` });
await page.click('#close').catch(() => {});
await wait(300);
await page.click('#open3d');
await wait(3000);
await page.screenshot({ path: `${out}phone-3d.png` });

await open(1280, 800);
await page.screenshot({ path: `${out}desktop-plan.png` });
await page.click('#open3d');
await wait(3000);
await page.screenshot({ path: `${out}desktop-3d.png` });
await browser.close();

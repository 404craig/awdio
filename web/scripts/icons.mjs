// Generates favicon + PWA icons from the brand mark (public/brand/mark.svg). Run: npm run icons
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const out = new URL("../public/icons/", import.meta.url);
const markPath = readFileSync(new URL("../public/brand/mark.svg", import.meta.url), "utf8").match(/ d="([^"]+)"/)[1];

const NEAR_BLACK = "#111214";
const IVORY = "#F3F1EB";

// The mark's viewBox is 100×60 with the wave centred on (50, 30); `scale` sets its size in a 512 canvas.
const svg = ({ rounded, scale }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" ${rounded ? 'rx="116"' : ""} fill="${NEAR_BLACK}"/>
  <g transform="translate(256 262) scale(${scale}) translate(-50 -30)">
    <path d="${markPath}" fill="none" stroke="${IVORY}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

writeFileSync(new URL("favicon.svg", out), svg({ rounded: true, scale: 3.9 }));

const browser = await chromium.launch();
const page = await browser.newPage();
const targets = [
  ["icon-192.png", 192, svg({ rounded: true, scale: 3.6 })],
  ["icon-512.png", 512, svg({ rounded: true, scale: 3.6 })],
  ["icon-maskable-512.png", 512, svg({ rounded: false, scale: 2.8 })], // inside the 80 % safe zone
  ["apple-touch-icon.png", 180, svg({ rounded: false, scale: 3.6 })],
];
for (const [name, size, markup] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: new URL(name, out).pathname, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log("icons written to public/icons/");

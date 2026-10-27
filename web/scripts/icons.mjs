// Generates the PWA icons (SVG + PNGs rasterised with Playwright). Run: npm run icons
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const out = new URL("../public/icons/", import.meta.url);

// A geometric single-storey "a": ring + stem, white on ember.
const glyph = (scale) => {
  const t = (v) => 256 + (v - 256) * scale;
  const w = 56 * scale;
  return `<circle cx="${t(256)}" cy="${t(260)}" r="${84 * scale}" fill="none" stroke="#fff" stroke-width="${w}"/>
  <path d="M${t(340)} ${t(148)}V${t(372)}" stroke="#fff" stroke-width="${w}"/>`;
};
const bg = (rounded) =>
  `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F06A22"/><stop offset="1" stop-color="#E04F06"/></linearGradient></defs>
  <rect width="512" height="512" ${rounded ? 'rx="114"' : ""} fill="url(#g)"/>`;
const svg = (rounded, scale) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg(rounded)}${glyph(scale)}</svg>`;

writeFileSync(new URL("favicon.svg", out), svg(true, 1));

const browser = await chromium.launch();
const page = await browser.newPage();
const targets = [
  ["icon-192.png", 192, svg(true, 1)],
  ["icon-512.png", 512, svg(true, 1)],
  ["icon-maskable-512.png", 512, svg(false, 0.72)],
  ["apple-touch-icon.png", 180, svg(false, 0.86)],
];
for (const [name, size, markup] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: new URL(name, out).pathname, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log("icons written to public/icons/");

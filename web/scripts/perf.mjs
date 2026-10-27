// Performance + behaviour checks against the mock's 25k-word document.
// Run: npm run perf   (exits non-zero if a budget is missed)
import { createRequire } from "node:module";
import { startMockServer } from "./serve-mock.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const server = await startMockServer(5197);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const failures = [];
const check = (ok, label, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(label);
};

await page.request.put(`${server.url}/api/documents/alice/progress`, { data: { blockIndex: 0, wordIndex: 0 } });
await page.goto(`${server.url}/d/alice`);
await page.waitForSelector(".w.is-active");
await page.waitForTimeout(500);

const doc = await (await page.request.get(`${server.url}/api/documents/alice`)).json();
const lastPage = doc.pages.length - 1;
const lastBlock = doc.blockCount - 1;
console.log(`document: ${doc.wordCount} words, ${doc.pageCount} pages, ${doc.blockCount} blocks`);

const dom = () =>
  page.evaluate(() => ({
    rendered: document.querySelectorAll("section[data-page]:not([data-placeholder])").length,
    words: document.querySelectorAll("[data-w]").length,
  }));
let d = await dom();
check(d.rendered <= 6, "only the page window is in the DOM", `${d.rendered} pages, ${d.words} word spans of ${doc.wordCount}`);

// Seek to the very end via the timeline and time until the last page is rendered + highlighted.
const track = await page.getByRole("slider", { name: "Position in document" }).boundingBox();
await page.evaluate(
  ({ lastPage }) => {
    window.__seek = new Promise((resolve) => {
      window.addEventListener(
        "pointerup",
        () => {
          const t0 = performance.now();
          const poll = () => {
            const section = document.querySelector(`section[data-page="${lastPage}"]:not([data-placeholder])`);
            if (section && section.querySelector(".w.is-active")) resolve(performance.now() - t0);
            else requestAnimationFrame(poll);
          };
          poll();
        },
        { capture: true, once: true },
      );
    });
  },
  { lastPage },
);
await page.mouse.click(track.x + track.width - 1, track.y + track.height / 2);
const seekMs = await page.evaluate(() => window.__seek);
check(seekMs < 100, "seek to last page renders within 100 ms", `${seekMs.toFixed(1)} ms`);
const activeBlock = await page.locator(".w.is-active").getAttribute("data-b");
check(Number(activeBlock) === lastBlock, "active word is in the last block", `block ${activeBlock}`);
const wordInView = await page.evaluate(() => {
  const r = document.querySelector(".w.is-active").getBoundingClientRect();
  return r.top > 0 && r.bottom < innerHeight;
});
check(wordInView, "scroll position follows the seek");
d = await dom();
check(d.rendered <= 6, "window still bounded after seek", `${d.rendered} pages`);

await page.waitForTimeout(300);
const progress = await (await page.request.get(`${server.url}/api/documents/alice/progress`)).json();
check(progress?.blockIndex === lastBlock, "progress saved immediately on seek", `blockIndex ${progress?.blockIndex}`);

// Back to the middle, play at 3x, and measure frame pacing while highlighting.
await page.mouse.click(track.x + track.width * 0.5, track.y + track.height / 2);
await page.waitForTimeout(300);
await page.request.put(`${server.url}/api/settings`, { data: { speed: 3 } });
await page.reload();
await page.waitForSelector(".w.is-active");
const before = await page.locator(".w.is-active").getAttribute("data-w");
await page.getByRole("button", { name: "Play" }).click();
const frames = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const times = [];
      let last = performance.now();
      const end = last + 3000;
      const step = (now) => {
        times.push(now - last);
        last = now;
        if (now < end) requestAnimationFrame(step);
        else resolve(times);
      };
      requestAnimationFrame(step);
    }),
);
const slow = frames.filter((t) => t > 50).length;
const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
check(slow <= 2, "highlighting at 3x keeps frames smooth", `${frames.length} frames, avg ${avg.toFixed(1)} ms, ${slow} over 50 ms`);
const after = await page.locator(".w.is-active").getAttribute("data-w");
check(after !== before, "active word advances while playing", `${before} → ${after}`);

// Scroll away: the chip appears; tapping it re-attaches and brings the word back.
await page.mouse.move(720, 400);
for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -1200);
await page.waitForTimeout(400);
const chip = page.getByRole("button", { name: "Back to reading" });
check(await chip.isVisible(), "“Back to reading” chip appears after scrolling away");
await chip.click();
await page.waitForTimeout(900);
const back = await page.evaluate(() => {
  const r = document.querySelector(".w.is-active").getBoundingClientRect();
  return r.top > 0 && r.bottom < innerHeight;
});
check(back, "chip scrolls the spoken word back into view");

// Tap a word to seek there.
const target = page.locator(".w").nth(40);
const targetPos = { b: await target.getAttribute("data-b"), w: await target.getAttribute("data-w") };
await target.click();
await page.waitForTimeout(150);
const active = { b: await page.locator(".w.is-active").getAttribute("data-b"), w: await page.locator(".w.is-active").getAttribute("data-w") };
check(active.b === targetPos.b && Math.abs(Number(active.w) - Number(targetPos.w)) <= 1, "tap a word seeks to it", `${targetPos.b}:${targetPos.w} → ${active.b}:${active.w}`);

await page.request.put(`${server.url}/api/settings`, { data: { speed: 1 } });
await browser.close();
await server.close();
if (failures.length) process.exitCode = 1;

// Visual check: renders key screens against the mock API at phone and desktop sizes.
// Run: npm run screenshots   → web/screenshots/*.png
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { startMockServer } from "./serve-mock.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const outDir = new URL("../screenshots/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

const VIEWPORTS = {
  mobile: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
};

const server = await startMockServer();
const browser = await chromium.launch();
const errors = [];

async function setSettings(page, body) {
  await page.request.put(`${server.url}/api/settings`, { data: body });
}

async function openReader(page, { play = true, waitToast = true } = {}) {
  await page.goto(`${server.url}/d/alice`);
  await page.waitForSelector(".w.is-active");
  await page.waitForTimeout(300);
  if (play) {
    await page.getByRole("button", { name: "Play" }).click();
    await page.waitForSelector('button[aria-label="Pause"]:not([aria-busy])');
    await page.waitForTimeout(1400);
  }
  if (waitToast) await page.waitForTimeout(2200); // let "Resumed at…" fade
}

for (const [name, options] of Object.entries(VIEWPORTS)) {
  const context = await browser.newContext({ ...options, colorScheme: "light", reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  const shot = (file) => page.screenshot({ path: `${outDir}${name}-${file}.png` });

  await setSettings(page, { theme: "light", font: "serif", textSize: 19, speed: 1 });

  // Library
  await page.goto(`${server.url}/`);
  await page.waitForSelector("article");
  await page.waitForTimeout(300);
  await shot("library");

  // Empty library (documents list intercepted)
  await page.route("**/api/documents", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: [] }) : route.continue(),
  );
  await page.goto(`${server.url}/`);
  await page.getByText("Your library is empty").waitFor();
  await shot("library-empty");
  await page.unroute("**/api/documents");

  // Access PIN screen (config intercepted so the mock needs no PIN)
  await page.route("**/api/config", (route) => route.fulfill({ json: { accessPinRequired: true, unlocked: false, version: "mock" } }));
  await page.goto(`${server.url}/`);
  await page.getByLabel("PIN").waitFor();
  await page.getByLabel("PIN").fill("12");
  await shot("unlock");
  await page.unroute("**/api/config");

  // Reader, light, while playing
  await openReader(page);
  await shot("reader-light");

  // Timeline drag (bubble visible), captured mid-drag
  const track = await page.getByRole("slider", { name: "Position in document" }).boundingBox();
  const y = track.y + track.height / 2;
  await page.mouse.move(track.x + track.width * 0.12, y);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * 0.4, y, { steps: 6 });
  await page.mouse.move(track.x + track.width * 0.62, y, { steps: 6 });
  await page.waitForTimeout(250);
  await shot("reader-scrub");
  await page.mouse.up();
  await page.waitForTimeout(600);

  // Press-and-hold scrub inside the text
  const words = page.locator(".w");
  const box = await words.nth(Math.floor((await words.count()) / 2)).boundingBox();
  await page.evaluate(() => window.scrollBy(0, 0));
  const target = await page.locator(".blk.is-current .w").nth(3).boundingBox();
  const start = target ?? box;
  await page.mouse.move(start.x + 4, start.y + 6);
  await page.mouse.down();
  await page.waitForTimeout(450);
  await page.mouse.move(start.x + 60, start.y + 120, { steps: 8 });
  await page.waitForTimeout(250);
  await shot("reader-text-scrub");
  await page.mouse.up();
  await page.waitForTimeout(400);

  // Settings sheet (listening + reading tabs)
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: /^Voice:/ }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("dialog").getByText("Heart").waitFor();
  await page.waitForTimeout(300);
  await shot("settings-listening");
  await page.getByRole("radio", { name: "Reading" }).click();
  await page.waitForTimeout(200);
  await shot("settings-reading");
  await page.keyboard.press("Escape");

  // Dark theme: the brand's primary mood
  await setSettings(page, { theme: "dark" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${server.url}/`);
  await page.waitForSelector("article");
  await page.waitForTimeout(300);
  await shot("library-dark");

  await openReader(page, { play: false });
  await shot("reader-dark");
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForSelector('button[aria-label="Pause"]:not([aria-busy])');
  await page.waitForTimeout(1400);
  await shot("reader-dark-playing");

  await page.getByRole("button", { name: /^Voice:/ }).click();
  await page.getByRole("dialog").getByText("Heart").waitFor();
  await page.waitForTimeout(300);
  await shot("settings-dark");
  await page.keyboard.press("Escape");

  // Sepia + sans, to check the other theme/font combination
  await setSettings(page, { theme: "sepia", font: "sans" });
  await openReader(page, { play: false });
  await shot("reader-sepia-sans");

  await setSettings(page, { theme: "system", font: "serif" });
  await context.close();
}

await browser.close();
await server.close();
if (errors.length) {
  console.error("Page errors:\n" + errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Screenshots written to ${outDir}`);
}

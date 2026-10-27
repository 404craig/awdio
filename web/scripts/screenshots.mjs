// Visual check of the key phone screens, on-device flows only: demo documents seeded into
// IndexedDB (?demo=1) and the fake speech engine (?fakeSpeech=1).
// Run: npm run screenshots   → web/screenshots/*.png (393×852 @2x)
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { chromium, patchSettings, PHONE, startPreview, watchErrors } from "./harness.mjs";

const outDir = new URL("../screenshots/", import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (f.endsWith(".png")) rmSync(outDir + f);

const server = await startPreview(5198);
const browser = await chromium.launch();
const errors = [];
const READING = { theme: "light", font: "serif", textSize: 19, speed: 1, voiceTipDismissed: false, homeScreenTipDismissed: true };

async function newPhone(name, { voices = "", hold = false } = {}) {
  const context = await browser.newContext({ ...PHONE, colorScheme: "light", reducedMotion: "reduce" });
  if (hold) {
    // Keep parsing results back so the "Analysing structure…" card can be captured.
    await context.addInitScript(() => {
      const Real = window.Worker;
      window.Worker = class extends Real {
        set onmessage(fn) {
          super.onmessage = (event) => event.data?.type !== "done" && fn(event);
        }
      };
    });
  }
  const page = await context.newPage();
  watchErrors(page, name, errors);
  const query = `fakeSpeech=1${voices ? `&fakeVoices=${voices}` : ""}`;
  const go = async (path, extra = "") => {
    await page.goto(`${server.url}${path}?${query}${extra}`);
  };
  const shot = (file) => page.screenshot({ path: `${outDir}${file}.png` });
  return { context, page, go, shot };
}

async function openAlice(phone, { play = true } = {}) {
  await phone.go("/d/demo-alice");
  await phone.page.waitForSelector(".w.is-active");
  await phone.page.waitForTimeout(3600); // let "Resumed at…" fade
  if (play) {
    await phone.page.getByRole("button", { name: "Play" }).click();
    await phone.page.waitForSelector('button[aria-label="Pause"]');
    await phone.page.waitForTimeout(1800);
  }
}

// ---- Library with the three demo documents, then the reader ----------------------------
{
  const phone = await newPhone("main");
  const { page } = phone;
  await phone.go("/", "&demo=1");
  await page.waitForSelector("article");
  await patchSettings(page, READING);
  await phone.go("/");
  await page.waitForSelector("article");
  await page.waitForTimeout(400);
  await phone.shot("library");

  await openAlice(phone);
  await phone.shot("reader-light");

  // Timeline drag (bubble visible), captured mid-drag
  const track = await page.getByRole("slider", { name: "Position in document" }).boundingBox();
  const y = track.y + track.height / 2;
  await page.mouse.move(track.x + track.width * 0.2, y);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * 0.4, y, { steps: 6 });
  await page.mouse.move(track.x + track.width * 0.55, y, { steps: 6 });
  await page.waitForTimeout(250);
  await phone.shot("reader-scrub");
  await page.mouse.up();
  await page.waitForTimeout(900);

  // Press-and-hold scrub inside the text
  const start = await page.locator(".blk.is-current .w").nth(3).boundingBox();
  await page.mouse.move(start.x + 4, start.y + 6);
  await page.mouse.down();
  await page.waitForTimeout(450);
  await page.mouse.move(start.x + 60, start.y + 140, { steps: 8 });
  await page.waitForTimeout(250);
  await phone.shot("reader-text-scrub");
  await page.mouse.up();
  await page.waitForTimeout(400);

  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Reading settings" }).click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(300);
  await phone.shot("settings-reading");
  await page.keyboard.press("Escape");

  await patchSettings(page, { theme: "dark" });
  await page.emulateMedia({ colorScheme: "dark" });
  await openAlice(phone);
  await phone.shot("reader-dark-playing");

  await page.emulateMedia({ colorScheme: "light" });
  await patchSettings(page, { theme: "sepia", font: "sans" });
  await openAlice(phone, { play: false });
  await phone.shot("reader-sepia-sans");
  await phone.context.close();
}

// ---- A phone with only standard voices: the voice tip ------------------------------------
{
  const phone = await newPhone("standard-voices", { voices: "standard" });
  const { page } = phone;
  await phone.go("/", "&demo=1");
  await page.waitForSelector("article");
  await patchSettings(page, READING);
  await openAlice(phone, { play: false });
  await phone.shot("voice-tip-banner");

  await page.getByRole("button", { name: /^Voice:/ }).click();
  await page.getByRole("dialog").getByText("Best available").waitFor();
  await page.waitForTimeout(300);
  await phone.shot("settings-listening");
  await phone.context.close();
}

// ---- First run: empty library, then a file being analysed ----------------------------
{
  const phone = await newPhone("empty", { hold: true });
  const { page } = phone;
  await phone.go("/");
  await page.getByText("Your library is empty").waitFor();
  await patchSettings(page, { ...READING, homeScreenTipDismissed: false }); // first run in Safari: suggest Add to Home Screen
  await phone.go("/");
  await page.getByText("Your library is empty").waitFor();
  await page.waitForTimeout(300);
  await phone.shot("library-empty");

  const text = Array.from({ length: 40 }, (_, i) => `## Section ${i + 1}\n\nSome words to read aloud in section ${i + 1}.\n`).join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "Quarterly report.md", mimeType: "text/markdown", buffer: Buffer.from(text) });
  await page.getByText("Analysing structure…").waitFor();
  await page.waitForTimeout(300);
  await phone.shot("library-upload");
  await phone.context.close();
}

await browser.close();
await server.close();
if (errors.length) {
  console.error("Page errors:\n" + errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Screenshots written to ${outDir}: ${readdirSync(outDir).filter((f) => f.endsWith(".png")).sort().join(", ")}`);
}

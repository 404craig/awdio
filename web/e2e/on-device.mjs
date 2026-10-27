// End-to-end, on a phone-sized Chromium against the production build:
//  1. with the fake speech engine: upload a generated PDF through the UI, open it, play,
//     check the spoken word advances and crosses into the next block, scrub, reload, resume;
//  2. without it (headless Chromium has no voices): the no-voices state renders, no errors.
// Run: npm run e2e
import { createRequire } from "node:module";
import { checker, chromium, idb, PHONE, startPreview, watchErrors } from "../scripts/harness.mjs";

const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts } = require("pdf-lib");

const TITLE = "The Lighthouse Keeper";
const PARAGRAPHS = [
  "The lighthouse stood at the end of a long stone pier, and every evening the keeper climbed its spiral stair to light the lamp.",
  "He had done this for thirty years. The ships that passed in the night never saw him, but they saw the light, and that was enough.",
  "One winter the storms came early. The sea rose over the pier and the wind tore at the windows, yet the lamp burned on until morning.",
  "When the weather cleared, a small boat arrived with letters from the harbour town, thanking him for the ships he had kept safe.",
];

async function makePdf() {
  const pdf = await PDFDocument.create();
  pdf.setTitle(TITLE);
  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const page = pdf.addPage([420, 600]);
  let y = 540;
  page.drawText(TITLE, { x: 50, y, size: 22, font: bold });
  y -= 44;
  for (const text of PARAGRAPHS) {
    let line = "";
    for (const word of text.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (regular.widthOfTextAtSize(next, 11) > 320) {
        page.drawText(line, { x: 50, y, size: 11, font: regular });
        y -= 14.5;
        line = word;
      } else line = next;
    }
    page.drawText(line, { x: 50, y, size: 11, font: regular });
    y -= 26;
  }
  return Buffer.from(await pdf.save());
}

const activeWord = (page) =>
  page.evaluate(() => {
    const el = document.querySelector(".w.is-active");
    return el ? { b: Number(el.dataset.b), w: Number(el.dataset.w) } : null;
  });

const server = await startPreview(5199);
const browser = await chromium.launch();
const { check, failures } = checker();
const errors = [];

// ---- 1. Fake speech: upload → listen → scrub → resume --------------------------------------
{
  const context = await browser.newContext({ ...PHONE, reducedMotion: "reduce" });
  const page = await context.newPage();
  watchErrors(page, "fake", errors);
  const url = (path) => `${server.url}${path}?fakeSpeech=1&fakeCps=40`;

  await page.goto(url("/"));
  await page.getByText("Your library is empty").waitFor();
  await page.locator('input[type="file"]').setInputFiles({ name: "lighthouse.pdf", mimeType: "application/pdf", buffer: await makePdf() });
  await page.locator("article", { hasText: TITLE }).waitFor({ timeout: 20000 });
  check(true, "PDF uploaded through the file picker and parsed on the device");

  const stored = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open("awdio");
        open.onsuccess = () => {
          const req = open.result.transaction("documents").objectStore("documents").getAll();
          req.onsuccess = () => resolve(req.result);
        };
      }),
  );
  check(stored.length === 1 && stored[0].title === TITLE, "document stored in IndexedDB", `${stored.length} stored, “${stored[0]?.title}”`);
  const docId = stored[0].id;

  await page.getByRole("button", { name: "Start listening" }).click();
  await page.waitForSelector(".w.is-active");
  const blocks = await page.locator("[data-block]").count();
  check(blocks >= 5, "reader shows title and paragraphs", `${blocks} blocks`);

  const start = await activeWord(page);
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForSelector('button[aria-label="Pause"]');
  await page.waitForTimeout(400);
  const early = await activeWord(page);
  let crossed = null;
  for (let i = 0; i < 40 && !crossed; i++) {
    await page.waitForTimeout(250);
    const now = await activeWord(page);
    if (now && now.b > early.b) crossed = now;
  }
  check(
    early.b > start.b || early.w > start.w || crossed !== null,
    "active word advances while playing",
    `${start.b}:${start.w} → ${early.b}:${early.w}`,
  );
  check(crossed !== null, "playback crosses into the next block", crossed ? `now ${crossed.b}:${crossed.w}` : "stuck");

  // Scrub with the timeline to ~75 % and check the position moved there.
  const track = await page.getByRole("slider", { name: "Position in document" }).boundingBox();
  await page.mouse.click(track.x + track.width * 0.75, track.y + track.height / 2);
  await page.waitForTimeout(300);
  const scrubbed = await activeWord(page);
  check(scrubbed.b >= blocks - 2, "timeline scrub moves playback", `now ${scrubbed.b}:${scrubbed.w}`);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(300);
  const paused = await activeWord(page);
  const saved = await idb(page, "get", "progress", docId);
  check(saved?.blockIndex === paused.b && saved?.wordIndex === paused.w, "position saved on pause", JSON.stringify(saved));

  await page.reload();
  await page.waitForSelector(".w.is-active");
  const resumed = await activeWord(page);
  check(resumed.b === paused.b && resumed.w === paused.w, "reload resumes at the saved word", `${paused.b}:${paused.w} → ${resumed.b}:${resumed.w}`);
  await page.getByText(/^Resumed at/).waitFor();
  check(true, "“Resumed at…” toast shown");
  await context.close();
}

// ---- 2. Real (absent) speech: headless Chromium has zero voices ------------------------------
{
  const context = await browser.newContext({ ...PHONE, reducedMotion: "reduce" });
  const page = await context.newPage();
  const before = errors.length;
  watchErrors(page, "no-voices", errors);
  await page.goto(`${server.url}/?demo=1`);
  await page.waitForSelector("article");
  await page.goto(`${server.url}/d/demo-notes`);
  await page.waitForSelector(".w.is-active");
  await page.getByRole("button", { name: "Voice settings" }).click();
  await page.getByText("No voices available on this device").waitFor({ timeout: 6000 });
  check(true, "settings show “No voices available on this device”");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Play" }).click();
  await page.getByText("No voices available on this device.").waitFor();
  check(true, "play explains there are no voices instead of failing");
  check(errors.length === before, "no console or page errors without voices", errors.slice(before).join(" | "));
  await context.close();
}

check(errors.length === 0, "no console or page errors overall", errors.join(" | "));
await browser.close();
await server.close();
if (failures.length) process.exitCode = 1;

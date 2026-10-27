// Shared by perf, screenshots and e2e: serves the production build and drives a phone-sized
// Chromium. Run `npm run build` first (the npm scripts do).
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { preview } from "vite";

const require = createRequire(import.meta.url);
export const { chromium } = require("playwright");

const root = fileURLToPath(new URL("..", import.meta.url));

/** iPhone 15-sized viewport: the only form factor awdio is designed for. */
export const PHONE = {
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
};

export async function startPreview(port) {
  if (!existsSync(`${root}dist/index.html`)) throw new Error("No build found: run `npm run build` first.");
  const server = await preview({ root, logLevel: "warn", preview: { port, strictPort: true } });
  const url = server.resolvedUrls.local[0].replace(/\/$/, "");
  return { url, close: () => new Promise((resolve) => server.httpServer.close(resolve)) };
}

/** Collects page errors and console errors so a run fails loudly. */
export function watchErrors(page, label, errors) {
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${label}: ${m.text()}`));
}

/** Reads or writes one IndexedDB record in the page (the app's own database). */
export function idb(page, op, store, key, value) {
  return page.evaluate(
    ([op, store, key, value]) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("awdio");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(store, op === "get" ? "readonly" : "readwrite");
          const os = tx.objectStore(store);
          const req = op === "get" ? os.get(key) : os.keyPath ? os.put(value) : os.put(value, key);
          req.onsuccess = () => {
            db.close();
            resolve(req.result ?? null);
          };
          req.onerror = () => reject(req.error);
        };
      }),
    [op, store, key, value],
  );
}

/** Merges into the stored settings (and the localStorage mirror the first paint reads). */
export async function patchSettings(page, patch) {
  const current = (await idb(page, "get", "settings", "settings")) ?? {};
  const next = { ...current, ...patch };
  await idb(page, "put", "settings", "settings", next);
  await page.evaluate((s) => localStorage.setItem("awdio.settings", JSON.stringify(s)), next);
}

export function checker() {
  const failures = [];
  const check = (ok, label, detail) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
    if (!ok) failures.push(label);
  };
  return { check, failures };
}

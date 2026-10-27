/// <reference types="vitest" />
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/** GitHub Pages serves 404.html for unknown paths; make it the app so deep links work on first load. */
function spaFallback(): Plugin {
  let outDir = "dist";
  return {
    name: "awdio-spa-fallback",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      copyFileSync(resolve(outDir, "index.html"), resolve(outDir, "404.html"));
    },
  };
}

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "script-defer",
      includeAssets: ["icons/*.png", "icons/favicon.svg", "brand/*.svg"],
      manifest: {
        name: "awdio",
        short_name: "awdio",
        description: "Listen to your documents. Private, on your phone.",
        display: "standalone",
        orientation: "portrait",
        background_color: "#111214",
        theme_color: "#111214",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell, parser chunks (pdf.js and its worker, mammoth) and fonts: everything works offline.
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,woff2,webmanifest}"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
    spaFallback(),
  ],
  worker: { format: "es" },
  server: { port: 5173 },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
  },
});

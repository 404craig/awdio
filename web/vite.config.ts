/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { mockApi } from "./mock/plugin";

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "mock" ? [mockApi()] : [])],
  server: {
    port: 5173,
    proxy: mode === "mock" ? undefined : { "/api": "http://localhost:8000" },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 600,
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
}));

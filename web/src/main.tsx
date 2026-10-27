import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/outfit/300.css";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/literata/400.css";
import "@fontsource/literata/400-italic.css";
import "@fontsource/literata/600.css";
import "./styles/index.css";
import { App } from "./App";
import { installFakeSpeechIfRequested } from "./audio/fakeSpeech";

// Before anything looks up voices: tests, screenshots and e2e run with ?fakeSpeech=1.
installFakeSpeechIfRequested();

const demo = new URLSearchParams(window.location.search).get("demo") === "1";
const seeded = demo ? import("./demo/seed").then((m) => m.seedDemo()) : Promise.resolve();

seeded
  .catch((e: unknown) => console.warn("Demo documents could not be added", e))
  .finally(() => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });

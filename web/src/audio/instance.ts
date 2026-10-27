import { getAudioFile, getBlockAudio, getHealth } from "../api";
import { AudioEngine } from "./engine";

const HEALTH_POLL_MS = 2000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

async function waitForEngine(engine: string, signal: AbortSignal): Promise<void> {
  for (;;) {
    await sleep(HEALTH_POLL_MS, signal);
    try {
      const health = await getHealth(signal);
      if (health.engines.find((e) => e.id === engine)?.ready) return;
    } catch (e) {
      if (signal.aborted) throw e;
    }
  }
}

/** The app owns exactly one audio element, so the engine is a module singleton. */
export const engine = new AudioEngine({
  fetchBlockAudio: (docId, blockIndex, engineId, voiceId, opts) => getBlockAudio(docId, blockIndex, engineId, voiceId, opts),
  fetchAudioFile: (url, signal) => getAudioFile(url, signal),
  waitForEngine,
});

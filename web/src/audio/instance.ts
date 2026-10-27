/** The app's single speech engine, wired to the browser. */
import { RateEstimator } from "./estimator";
import { browserLockScreen } from "./lockScreen";
import { SpeechEngine } from "./speech";

/** The platform synthesiser, looked up on use so the fake (?fakeSpeech=1) can be installed first. */
export function systemSynth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
}

export const rateEstimator = new RateEstimator();

export const speech = new SpeechEngine({
  synth: systemSynth,
  createUtterance: (text) => new window.SpeechSynthesisUtterance(text),
  estimator: rateEstimator,
  lockScreen: browserLockScreen(import.meta.env.BASE_URL),
  hidden: () => document.hidden,
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") speech.resync();
});
